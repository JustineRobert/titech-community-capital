/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Legal Document Service
 * ============================================================================
 *
 * File:
 *   backend/legal/services/legalDocumentService.js
 *
 * Purpose:
 *   Enterprise service layer for managing TITech Community Capital legal
 *   document metadata, document versions, publication lifecycle, effective
 *   dates, supersession, retrieval, and audit events.
 *
 * Architectural position:
 *
 *   Controller / Route
 *          ↓
 *   legalDocumentService
 *          ↓
 *   ┌───────────────────────────────┐
 *   │ LegalDocument                 │
 *   │ LegalDocumentVersion          │
 *   │ LegalAuditEvent               │
 *   └───────────────────────────────┘
 *          ↓
 *   Legal Acceptance / Compliance
 *
 * Design principles:
 *   ✓ Single service boundary for legal-document operations
 *   ✓ Explicit document lifecycle
 *   ✓ Immutable published versions
 *   ✓ Version-aware document retrieval
 *   ✓ Effective-date enforcement
 *   ✓ Safe publication workflow
 *   ✓ Supersession support
 *   ✓ Audit-event generation
 *   ✓ MongoDB transaction/session compatibility
 *   ✓ Idempotent-safe lifecycle operations
 *   ✓ Defensive input normalization
 *   ✓ Controlled query construction
 *   ✓ Pagination safeguards
 *   ✓ No substantive legal wording embedded here
 *   ✓ Suitable for REST/API controllers
 *   ✓ Suitable for administrative workflows
 *   ✓ Suitable for CMS/API integration
 *   ✓ Suitable for compliance automation
 *   ✓ Suitable for future event-driven architecture
 *   ✓ TITech terminology consistency
 *
 * IMPORTANT LEGAL NOTICE:
 * ----------------------------------------------------------------------------
 * This service is an application-layer implementation mechanism.
 *
 * It does NOT constitute:
 *   - legal advice
 *   - regulatory approval
 *   - licensing
 *   - authorization
 *   - legal representation
 *   - a determination that TITech may perform regulated financial activity
 *
 * All legal, contractual, privacy, financial and regulatory content must be
 * reviewed and approved by appropriately qualified legal, compliance and/or
 * regulatory professionals before publication or reliance.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const LegalDocument = require('../models/LegalDocument');
const LegalDocumentVersion = require('../models/LegalDocumentVersion');
const LegalAuditEvent = require('../models/LegalAuditEvent');

/* ============================================================================
 * Service metadata
 * ========================================================================== */

const SERVICE_NAME = 'titech-legal-document-service';

const SERVICE_VERSION = '1.0.0';

/* ============================================================================
 * Document lifecycle
 * ========================================================================== */

const LEGAL_STATUS = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  SUPERSEDED: 'superseded',
  RETIRED: 'retired',
});

/* ============================================================================
 * Audit events
 * ========================================================================== */

const AUDIT_EVENT = Object.freeze({
  DOCUMENT_CREATED:
    'legal.document.created',

  DOCUMENT_UPDATED:
    'legal.document.updated',

  VERSION_CREATED:
    'legal.document.version.created',

  VERSION_SUBMITTED_FOR_REVIEW:
    'legal.document.version.submitted',

  VERSION_APPROVED:
    'legal.document.version.approved',

  DOCUMENT_SCHEDULED:
    'legal.document.scheduled',

  DOCUMENT_PUBLISHED:
    'legal.document.published',

  DOCUMENT_SUPERSEDED:
    'legal.document.superseded',

  DOCUMENT_RETIRED:
    'legal.document.retired',

  DOCUMENT_RETRIEVED:
    'legal.document.retrieved',
});

/* ============================================================================
 * Error class
 * ========================================================================== */

class LegalDocumentServiceError extends Error {
  constructor(
    message,
    code = 'LEGAL_DOCUMENT_ERROR',
    details = {}
  ) {
    super(message);

    this.name =
      'LegalDocumentServiceError';

    this.code = code;

    this.details = details;

    this.service = SERVICE_NAME;

    Error.captureStackTrace?.(
      this,
      LegalDocumentServiceError
    );
  }
}

/* ============================================================================
 * Generic helpers
 * ========================================================================== */

function normalizeString(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  return normalized.length
    ? normalized
    : null;
}

function normalizeId(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const normalized =
    normalizeString(String(value));

  return normalized || null;
}

function normalizeBoolean(
  value,
  fallback = false
) {
  if (typeof value === 'boolean') {
    return value;
  }

  return fallback;
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function normalizeTags(tags) {
  if (!Array.isArray(tags)) {
    return [];
  }

  return [
    ...new Set(
      tags
        .map(normalizeString)
        .filter(Boolean)
        .map((tag) => tag.toLowerCase())
    ),
  ].slice(0, 100);
}

function normalizeAudience(audience) {
  if (!Array.isArray(audience)) {
    return [];
  }

  return [
    ...new Set(
      audience
        .map(normalizeString)
        .filter(Boolean)
    ),
  ];
}

function normalizeMetadata(metadata) {
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata)
  ) {
    return {};
  }

  return {
    ...metadata,
  };
}

function getSessionOptions(options = {}) {
  if (
    options &&
    options.session
  ) {
    return {
      session: options.session,
    };
  }

  return {};
}

function getLeanOptions(options = {}) {
  return {
    ...getSessionOptions(options),
    lean: true,
  };
}

function generateDocumentReference() {
  return `LDO-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(6)
    .toString('hex')
    .toUpperCase()}`;
}

function generateVersionReference() {
  return `LDV-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(6)
    .toString('hex')
    .toUpperCase()}`;
}

function getDocumentId(document) {
  return normalizeId(
    document?.id ||
    document?.documentId ||
    document?._id
  );
}

function getVersionId(version) {
  return normalizeId(
    version?.id ||
    version?.versionId ||
    version?._id
  );
}

function getVersionNumber(version) {
  return normalizeString(
    version?.version ||
    version?.versionNumber ||
    version?.documentVersion
  );
}

/* ============================================================================
 * Validation helpers
 * ========================================================================== */

function assertRequired(
  value,
  fieldName
) {
  if (!normalizeString(String(value || ''))) {
    throw new LegalDocumentServiceError(
      `${fieldName} is required.`,
      'LEGAL_DOCUMENT_REQUIRED_FIELD',
      {
        field: fieldName,
      }
    );
  }
}

function validateStatus(status) {
  const normalized =
    normalizeString(status)?.toLowerCase();

  if (
    !normalized ||
    !Object.values(LEGAL_STATUS).includes(
      normalized
    )
  ) {
    throw new LegalDocumentServiceError(
      'Invalid legal document status.',
      'LEGAL_DOCUMENT_INVALID_STATUS',
      {
        status,
        allowedStatuses:
          Object.values(LEGAL_STATUS),
      }
    );
  }

  return normalized;
}

function validateVersionNumber(version) {
  const normalized =
    normalizeString(version);

  if (!normalized) {
    throw new LegalDocumentServiceError(
      'Legal document version is required.',
      'LEGAL_DOCUMENT_VERSION_REQUIRED'
    );
  }

  /**
   * Semantic-version-compatible format.
   *
   * Examples:
   *   1.0.0
   *   1.1.0
   *   2.0.0
   *
   * A controlled legal version can also contain a release suffix such as:
   *   1.0.0-beta
   */
  if (
    !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(
      normalized
    )
  ) {
    throw new LegalDocumentServiceError(
      'Legal document version must use semantic-version-compatible notation.',
      'LEGAL_DOCUMENT_INVALID_VERSION',
      {
        version: normalized,
      }
    );
  }

  return normalized;
}

function assertValidEffectiveDate(
  effectiveDate
) {
  if (!effectiveDate) {
    return;
  }

  const date =
    normalizeDate(effectiveDate);

  if (!date) {
    throw new LegalDocumentServiceError(
      'Invalid legal document effective date.',
      'LEGAL_DOCUMENT_INVALID_EFFECTIVE_DATE',
      {
        effectiveDate,
      }
    );
  }
}

function assertPublicationDateConsistency({
  effectiveDate,
  publishedAt,
}) {
  const effective =
    normalizeDate(effectiveDate);

  const published =
    normalizeDate(publishedAt);

  if (
    effective &&
    published &&
    effective.getTime() >
      published.getTime()
  ) {
    throw new LegalDocumentServiceError(
      'Effective date cannot be later than publication date.',
      'LEGAL_DOCUMENT_INVALID_DATE_ORDER',
      {
        effectiveDate,
        publishedAt,
      }
    );
  }
}

/* ============================================================================
 * Query helpers
 * ========================================================================== */

function buildDocumentIdentityQuery(
  identifier
) {
  const normalized =
    normalizeId(identifier);

  assertRequired(
    normalized,
    'documentId'
  );

  return {
    $or: [
      {
        id: normalized,
      },
      {
        documentId: normalized,
      },
      {
        slug: normalized,
      },
      {
        documentReference: normalized,
      },
    ],
  };
}

function buildVersionQuery(
  document,
  version
) {
  const documentId =
    getDocumentId(document);

  const normalizedVersion =
    validateVersionNumber(version);

  const conditions = [
    {
      documentId,
      version: normalizedVersion,
    },
    {
      legalDocumentId: documentId,
      version: normalizedVersion,
    },
  ];

  if (document?._id) {
    conditions.push({
      document: document._id,
      version: normalizedVersion,
    });
  }

  return {
    $or: conditions,
  };
}

/* ============================================================================
 * Document retrieval
 * ========================================================================== */

async function findDocument(
  identifier,
  options = {}
) {
  const document =
    await LegalDocument.findOne(
      buildDocumentIdentityQuery(
        identifier
      ),
      null,
      getSessionOptions(options)
    );

  if (!document) {
    throw new LegalDocumentServiceError(
      'Legal document was not found.',
      'LEGAL_DOCUMENT_NOT_FOUND',
      {
        identifier:
          normalizeId(identifier),
      }
    );
  }

  return document;
}

/* ============================================================================
 * Version retrieval
 * ========================================================================== */

async function findVersion(
  document,
  version,
  options = {}
) {
  const normalizedVersion =
    validateVersionNumber(version);

  const documentVersion =
    await LegalDocumentVersion.findOne(
      buildVersionQuery(
        document,
        normalizedVersion
      ),
      null,
      getSessionOptions(options)
    );

  if (!documentVersion) {
    throw new LegalDocumentServiceError(
      'Legal document version was not found.',
      'LEGAL_DOCUMENT_VERSION_NOT_FOUND',
      {
        documentId:
          getDocumentId(document),

        version:
          normalizedVersion,
      }
    );
  }

  return documentVersion;
}

/* ============================================================================
 * Public-document validation
 * ========================================================================== */

function assertDocumentCanBePublished(
  document
) {
  const status =
    normalizeString(
      document?.status
    )?.toLowerCase();

  if (
    [
      LEGAL_STATUS.RETIRED,
      LEGAL_STATUS.SUPERSEDED,
    ].includes(status)
  ) {
    throw new LegalDocumentServiceError(
      'A retired or superseded legal document cannot be published.',
      'LEGAL_DOCUMENT_CANNOT_PUBLISH',
      {
        documentId:
          getDocumentId(document),

        status,
      }
    );
  }
}

function assertVersionCanBePublished(
  version
) {
  const status =
    normalizeString(
      version?.status
    )?.toLowerCase();

  if (
    [
      LEGAL_STATUS.RETIRED,
      LEGAL_STATUS.SUPERSEDED,
    ].includes(status)
  ) {
    throw new LegalDocumentServiceError(
      'A retired or superseded legal document version cannot be published.',
      'LEGAL_VERSION_CANNOT_PUBLISH',
      {
        versionId:
          getVersionId(version),

        status,
      }
    );
  }

  const effectiveDate =
    version?.effectiveDate ||
    version?.effectiveFrom;

  assertValidEffectiveDate(
    effectiveDate
  );
}

/* ============================================================================
 * Audit logging
 * ========================================================================== */

async function createAuditEvent({
  eventType,
  document = null,
  version = null,
  actor = {},
  metadata = {},
  options = {},
}) {
  if (!LegalAuditEvent) {
    return null;
  }

  const payload = {
    eventType,

    action: eventType,

    service:
      SERVICE_NAME,

    entityType:
      version
        ? 'LegalDocumentVersion'
        : 'LegalDocument',

    entityId:
      version
        ? getVersionId(version)
        : getDocumentId(document),

    legalDocumentId:
      getDocumentId(document),

    legalDocumentVersionId:
      getVersionId(version),

    actorUserId:
      normalizeId(actor?.userId),

    tenantId:
      normalizeId(actor?.tenantId),

    organizationId:
      normalizeId(actor?.organizationId),

    requestId:
      normalizeString(metadata?.requestId),

    ipAddress:
      normalizeString(metadata?.ipAddress),

    userAgent:
      normalizeString(metadata?.userAgent),

    metadata: {
      ...normalizeMetadata(metadata),

      documentId:
        getDocumentId(document),

      version:
        getVersionNumber(version),
    },
  };

  try {
    const result =
      await LegalAuditEvent.create(
        [payload],
        getSessionOptions(options)
      );

    return result?.[0] || null;
  } catch (error) {
    throw new LegalDocumentServiceError(
      'Legal audit event could not be recorded.',
      'LEGAL_AUDIT_WRITE_FAILED',
      {
        cause: error.message,
        eventType,
      }
    );
  }
}

/* ============================================================================
 * Create legal document
 * ========================================================================== */

async function createLegalDocument({
  id,
  documentId,
  slug,
  documentReference,
  title,
  shortTitle,
  category,
  audience,
  jurisdiction,
  language = 'en',
  contentSource = 'api',
  searchable = true,
  printable = true,
  downloadable = true,
  public: isPublic = false,
  requiresAcceptance = false,
  acceptanceScope = null,
  acceptanceRequiredBeforeUse = false,
  acceptanceRequiredBeforeTransaction = false,
  priority = 'medium',
  legalOwner = 'TITech Community Capital',
  complianceOwner = null,
  legalReviewRequired = true,
  regulatoryReviewRequired = false,
  securityReviewRequired = false,
  privacyReviewRequired = false,
  tags = [],
  actor = {},
  metadata = {},
  options = {},
}) {
  assertRequired(
    title,
    'title'
  );

  assertRequired(
    slug,
    'slug'
  );

  assertRequired(
    category,
    'category'
  );

  const normalizedSlug =
    normalizeString(slug)
      .toLowerCase();

  const existing =
    await LegalDocument.findOne(
      {
        $or: [
          {
            slug:
              normalizedSlug,
          },
          ...(id
            ? [
                {
                  id:
                    normalizeId(id),
                },
              ]
            : []),
          ...(documentId
            ? [
                {
                  documentId:
                    normalizeId(
                      documentId
                    ),
                },
              ]
            : []),
        ],
      },
      null,
      getSessionOptions(options)
    );

  if (existing) {
    throw new LegalDocumentServiceError(
      'A legal document with the same identity already exists.',
      'LEGAL_DOCUMENT_ALREADY_EXISTS',
      {
        slug:
          normalizedSlug,
      }
    );
  }

  const payload = {
    id:
      normalizeId(id) ||
      normalizeId(documentId) ||
      normalizedSlug,

    documentId:
      normalizeId(documentId) ||
      normalizeId(id) ||
      normalizedSlug,

    documentReference:
      normalizeString(
        documentReference
      ) ||
      generateDocumentReference(),

    slug:
      normalizedSlug,

    title:
      normalizeString(title),

    shortTitle:
      normalizeString(shortTitle) ||
      normalizeString(title),

    category:
      normalizeString(category),

    audience:
      normalizeAudience(audience),

    jurisdiction:
      normalizeString(jurisdiction) ||
      'UG',

    language:
      normalizeString(language) ||
      'en',

    contentSource:
      normalizeString(
        contentSource
      ) || 'api',

    searchable:
      normalizeBoolean(
        searchable,
        true
      ),

    printable:
      normalizeBoolean(
        printable,
        true
      ),

    downloadable:
      normalizeBoolean(
        downloadable,
        true
      ),

    public:
      normalizeBoolean(
        isPublic,
        false
      ),

    requiresAcceptance:
      normalizeBoolean(
        requiresAcceptance,
        false
      ),

    acceptanceScope:
      normalizeString(
        acceptanceScope
      ),

    acceptanceRequiredBeforeUse:
      normalizeBoolean(
        acceptanceRequiredBeforeUse,
        false
      ),

    acceptanceRequiredBeforeTransaction:
      normalizeBoolean(
        acceptanceRequiredBeforeTransaction,
        false
      ),

    priority:
      normalizeString(priority) ||
      'medium',

    legalOwner:
      normalizeString(
        legalOwner
      ) ||
      'TITech Community Capital',

    complianceOwner:
      normalizeString(
        complianceOwner
      ),

    legalReviewRequired:
      normalizeBoolean(
        legalReviewRequired,
        true
      ),

    regulatoryReviewRequired:
      normalizeBoolean(
        regulatoryReviewRequired,
        false
      ),

    securityReviewRequired:
      normalizeBoolean(
        securityReviewRequired,
        false
      ),

    privacyReviewRequired:
      normalizeBoolean(
        privacyReviewRequired,
        false
      ),

    status:
      LEGAL_STATUS.DRAFT,

    tags:
      normalizeTags(tags),
  };

  const created =
    await LegalDocument.create(
      [payload],
      getSessionOptions(options)
    );

  const document =
    created?.[0];

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.DOCUMENT_CREATED,

    document,

    actor,

    metadata,

    options,
  });

  return document;
}

/* ============================================================================
 * Update document metadata
 *
 * Published legal content is not modified through this operation.
 * ========================================================================== */

async function updateLegalDocument({
  documentId,
  updates = {},
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  if (
    document.status ===
      LEGAL_STATUS.PUBLISHED &&
    (
      Object.prototype.hasOwnProperty.call(
        updates,
        'title'
      ) ||
      Object.prototype.hasOwnProperty.call(
        updates,
        'slug'
      ) ||
      Object.prototype.hasOwnProperty.call(
        updates,
        'currentVersion'
      )
    )
  ) {
    throw new LegalDocumentServiceError(
      'Published legal document identity/version metadata cannot be changed directly.',
      'LEGAL_DOCUMENT_PUBLISHED_IMMUTABLE'
    );
  }

  const allowedFields = [
    'title',
    'shortTitle',
    'category',
    'audience',
    'jurisdiction',
    'language',
    'contentSource',
    'searchable',
    'printable',
    'downloadable',
    'public',
    'requiresAcceptance',
    'acceptanceScope',
    'acceptanceRequiredBeforeUse',
    'acceptanceRequiredBeforeTransaction',
    'priority',
    'legalOwner',
    'complianceOwner',
    'legalReviewRequired',
    'regulatoryReviewRequired',
    'securityReviewRequired',
    'privacyReviewRequired',
    'tags',
    'route',
    'apiPath',
  ];

  for (const field of allowedFields) {
    if (
      Object.prototype.hasOwnProperty.call(
        updates,
        field
      )
    ) {
      let value =
        updates[field];

      if (field === 'audience') {
        value =
          normalizeAudience(value);
      }

      if (field === 'tags') {
        value =
          normalizeTags(value);
      }

      if (
        [
          'title',
          'shortTitle',
          'category',
          'jurisdiction',
          'language',
          'contentSource',
          'acceptanceScope',
          'priority',
          'legalOwner',
          'complianceOwner',
          'route',
          'apiPath',
        ].includes(field)
      ) {
        value =
          normalizeString(value);
      }

      document[field] =
        value;
    }
  }

  await document.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.DOCUMENT_UPDATED,

    document,

    actor,

    metadata,

    options,
  });

  return document;
}

/* ============================================================================
 * Create document version
 * ========================================================================== */

async function createLegalDocumentVersion({
  documentId,
  version,
  content,
  contentHash,
  effectiveDate,
  status = LEGAL_STATUS.DRAFT,
  changeSummary,
  authorId,
  reviewerId,
  legalReviewedAt,
  regulatoryReviewedAt,
  metadata = {},
  actor = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const normalizedVersion =
    validateVersionNumber(version);

  const existing =
    await LegalDocumentVersion.findOne(
      buildVersionQuery(
        document,
        normalizedVersion
      ),
      null,
      getSessionOptions(options)
    );

  if (existing) {
    throw new LegalDocumentServiceError(
      'That legal document version already exists.',
      'LEGAL_DOCUMENT_VERSION_ALREADY_EXISTS',
      {
        documentId:
          getDocumentId(document),

        version:
          normalizedVersion,
      }
    );
  }

  assertValidEffectiveDate(
    effectiveDate
  );

  const payload = {
    id:
      generateVersionReference(),

    version:
      normalizedVersion,

    versionNumber:
      normalizedVersion,

    documentId:
      getDocumentId(document),

    legalDocumentId:
      getDocumentId(document),

    document:
      document._id,

    content:
      content ?? null,

    contentHash:
      normalizeString(contentHash) ||
      (
        typeof content === 'string'
          ? crypto
              .createHash('sha256')
              .update(content, 'utf8')
              .digest('hex')
          : null
      ),

    effectiveDate:
      normalizeDate(effectiveDate),

    status:
      validateStatus(status),

    changeSummary:
      normalizeString(
        changeSummary
      ),

    authorId:
      normalizeId(authorId) ||
      normalizeId(actor?.userId),

    reviewerId:
      normalizeId(reviewerId),

    legalReviewedAt:
      normalizeDate(
        legalReviewedAt
      ),

    regulatoryReviewedAt:
      normalizeDate(
        regulatoryReviewedAt
      ),
  };

  const created =
    await LegalDocumentVersion.create(
      [payload],
      getSessionOptions(options)
    );

  const documentVersion =
    created?.[0];

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.VERSION_CREATED,

    document,

    version:
      documentVersion,

    actor,

    metadata,

    options,
  });

  return documentVersion;
}

/* ============================================================================
 * Submit version for review
 * ========================================================================== */

async function submitVersionForReview({
  documentId,
  version,
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const documentVersion =
    await findVersion(
      document,
      version,
      options
    );

  if (
    documentVersion.status !==
    LEGAL_STATUS.DRAFT
  ) {
    throw new LegalDocumentServiceError(
      'Only draft legal document versions can be submitted for review.',
      'LEGAL_VERSION_INVALID_REVIEW_TRANSITION',
      {
        status:
          documentVersion.status,
      }
    );
  }

  documentVersion.status =
    LEGAL_STATUS.REVIEW;

  await documentVersion.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.VERSION_SUBMITTED_FOR_REVIEW,

    document,

    version:
      documentVersion,

    actor,

    metadata,

    options,
  });

  return documentVersion;
}

/* ============================================================================
 * Approve version
 * ========================================================================== */

async function approveLegalDocumentVersion({
  documentId,
  version,
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const documentVersion =
    await findVersion(
      document,
      version,
      options
    );

  if (
    ![
      LEGAL_STATUS.REVIEW,
      LEGAL_STATUS.DRAFT,
    ].includes(
      documentVersion.status
    )
  ) {
    throw new LegalDocumentServiceError(
      'Only draft or review legal document versions can be approved.',
      'LEGAL_VERSION_INVALID_APPROVAL_TRANSITION',
      {
        status:
          documentVersion.status,
      }
    );
  }

  documentVersion.status =
    LEGAL_STATUS.APPROVED;

  documentVersion.approvedAt =
    new Date();

  documentVersion.approvedBy =
    normalizeId(
      actor?.userId
    );

  await documentVersion.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.VERSION_APPROVED,

    document,

    version:
      documentVersion,

    actor,

    metadata,

    options,
  });

  return documentVersion;
}

/* ============================================================================
 * Publish version
 *
 * Publication is the most sensitive lifecycle operation in this service.
 * ========================================================================== */

async function publishLegalDocumentVersion({
  documentId,
  version,
  effectiveDate,
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  assertDocumentCanBePublished(
    document
  );

  const documentVersion =
    await findVersion(
      document,
      version,
      options
    );

  if (
    ![
      LEGAL_STATUS.APPROVED,
      LEGAL_STATUS.SCHEDULED,
      LEGAL_STATUS.REVIEW,
    ].includes(
      documentVersion.status
    )
  ) {
    throw new LegalDocumentServiceError(
      'The legal document version has not reached an acceptable publication state.',
      'LEGAL_VERSION_NOT_READY_FOR_PUBLICATION',
      {
        status:
          documentVersion.status,
      }
    );
  }

  const finalEffectiveDate =
    normalizeDate(
      effectiveDate
    ) ||
    normalizeDate(
      documentVersion.effectiveDate
    );

  if (!finalEffectiveDate) {
    throw new LegalDocumentServiceError(
      'An effective date is required before publication.',
      'LEGAL_PUBLICATION_EFFECTIVE_DATE_REQUIRED'
    );
  }

  documentVersion.effectiveDate =
    finalEffectiveDate;

  documentVersion.status =
    LEGAL_STATUS.PUBLISHED;

  documentVersion.publishedAt =
    new Date();

  documentVersion.publishedBy =
    normalizeId(
      actor?.userId
    );

  /**
   * A published version is immutable.
   */
  if (
    !documentVersion.contentHash &&
    typeof documentVersion.content ===
      'string'
  ) {
    documentVersion.contentHash =
      crypto
        .createHash('sha256')
        .update(
          documentVersion.content,
          'utf8'
        )
        .digest('hex');
  }

  await documentVersion.save(
    getSessionOptions(options)
  );

  /**
   * Supersede the previously current version.
   */
  const previousVersionNumber =
    document.currentVersion;

  if (
    previousVersionNumber &&
    previousVersionNumber !==
      getVersionNumber(
        documentVersion
      )
  ) {
    const previousVersion =
      await findVersion(
        document,
        previousVersionNumber,
        options
      ).catch(() => null);

    if (previousVersion) {
      previousVersion.status =
        LEGAL_STATUS.SUPERSEDED;

      previousVersion.supersededAt =
        new Date();

      previousVersion.supersededByVersion =
        getVersionNumber(
          documentVersion
        );

      await previousVersion.save(
        getSessionOptions(options)
      );
    }
  }

  document.currentVersion =
    getVersionNumber(
      documentVersion
    );

  document.status =
    LEGAL_STATUS.PUBLISHED;

  document.effectiveDate =
    finalEffectiveDate;

  document.publishedAt =
    documentVersion.publishedAt;

  document.publishedBy =
    documentVersion.publishedBy;

  await document.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.DOCUMENT_PUBLISHED,

    document,

    version:
      documentVersion,

    actor,

    metadata: {
      previousVersion:
        previousVersionNumber ||
        null,

      effectiveDate:
        finalEffectiveDate,

      ...metadata,
    },

    options,
  });

  return {
    document,
    version:
      documentVersion,
  };
}

/* ============================================================================
 * Schedule version
 * ========================================================================== */

async function scheduleLegalDocumentVersion({
  documentId,
  version,
  scheduledAt,
  effectiveDate,
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const documentVersion =
    await findVersion(
      document,
      version,
      options
    );

  if (
    ![
      LEGAL_STATUS.APPROVED,
      LEGAL_STATUS.DRAFT,
      LEGAL_STATUS.REVIEW,
    ].includes(
      documentVersion.status
    )
  ) {
    throw new LegalDocumentServiceError(
      'This legal document version cannot be scheduled.',
      'LEGAL_VERSION_CANNOT_BE_SCHEDULED',
      {
        status:
          documentVersion.status,
      }
    );
  }

  const scheduledDate =
    normalizeDate(scheduledAt);

  const finalEffectiveDate =
    normalizeDate(
      effectiveDate
    );

  if (!scheduledDate) {
    throw new LegalDocumentServiceError(
      'scheduledAt is required.',
      'LEGAL_SCHEDULED_DATE_REQUIRED'
    );
  }

  if (
    scheduledDate.getTime() <=
    Date.now()
  ) {
    throw new LegalDocumentServiceError(
      'scheduledAt must be in the future.',
      'LEGAL_SCHEDULED_DATE_INVALID'
    );
  }

  if (!finalEffectiveDate) {
    throw new LegalDocumentServiceError(
      'effectiveDate is required.',
      'LEGAL_EFFECTIVE_DATE_REQUIRED'
    );
  }

  if (
    finalEffectiveDate.getTime() <
    scheduledDate.getTime()
  ) {
    throw new LegalDocumentServiceError(
      'effectiveDate cannot be earlier than scheduledAt.',
      'LEGAL_DATE_ORDER_INVALID'
    );
  }

  documentVersion.status =
    LEGAL_STATUS.SCHEDULED;

  documentVersion.scheduledAt =
    scheduledDate;

  documentVersion.effectiveDate =
    finalEffectiveDate;

  documentVersion.scheduledBy =
    normalizeId(
      actor?.userId
    );

  await documentVersion.save(
    getSessionOptions(options)
  );

  document.status =
    LEGAL_STATUS.SCHEDULED;

  document.scheduledAt =
    scheduledDate;

  document.effectiveDate =
    finalEffectiveDate;

  await document.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.DOCUMENT_SCHEDULED,

    document,

    version:
      documentVersion,

    actor,

    metadata,

    options,
  });

  return {
    document,
    version:
      documentVersion,
  };
}

/* ============================================================================
 * Supersede document version
 * ========================================================================== */

async function supersedeLegalDocumentVersion({
  documentId,
  version,
  replacementVersion,
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const documentVersion =
    await findVersion(
      document,
      version,
      options
    );

  if (
    documentVersion.status ===
    LEGAL_STATUS.SUPERSEDED
  ) {
    return {
      document,
      version:
        documentVersion,
    };
  }

  documentVersion.status =
    LEGAL_STATUS.SUPERSEDED;

  documentVersion.supersededAt =
    new Date();

  documentVersion.supersededByVersion =
    replacementVersion
      ? validateVersionNumber(
          replacementVersion
        )
      : null;

  await documentVersion.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.DOCUMENT_SUPERSEDED,

    document,

    version:
      documentVersion,

    actor,

    metadata: {
      replacementVersion:
        documentVersion.supersededByVersion,

      ...metadata,
    },

    options,
  });

  return {
    document,
    version:
      documentVersion,
  };
}

/* ============================================================================
 * Retire document
 * ========================================================================== */

async function retireLegalDocument({
  documentId,
  reason,
  actor = {},
  metadata = {},
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  if (
    document.status ===
    LEGAL_STATUS.RETIRED
  ) {
    return document;
  }

  document.status =
    LEGAL_STATUS.RETIRED;

  document.retiredAt =
    new Date();

  document.retiredBy =
    normalizeId(
      actor?.userId
    );

  document.retirementReason =
    normalizeString(reason);

  await document.save(
    getSessionOptions(options)
  );

  await createAuditEvent({
    eventType:
      AUDIT_EVENT.DOCUMENT_RETIRED,

    document,

    actor,

    metadata: {
      reason:
        normalizeString(reason),

      ...metadata,
    },

    options,
  });

  return document;
}

/* ============================================================================
 * Get current published document
 * ========================================================================== */

async function getCurrentLegalDocument(
  identifier,
  options = {}
) {
  const document =
    await findDocument(
      identifier,
      options
    );

  if (
    document.status !==
    LEGAL_STATUS.PUBLISHED
  ) {
    return null;
  }

  if (
    !document.currentVersion
  ) {
    return null;
  }

  const version =
    await findVersion(
      document,
      document.currentVersion,
      options
    );

  if (
    version.status !==
    LEGAL_STATUS.PUBLISHED
  ) {
    return null;
  }

  const effectiveDate =
    version.effectiveDate ||
    document.effectiveDate;

  if (
    effectiveDate &&
    normalizeDate(
      effectiveDate
    ).getTime() >
      Date.now()
  ) {
    return null;
  }

  return {
    document,
    version,
  };
}

/* ============================================================================
 * Get legal document version
 * ========================================================================== */

async function getLegalDocumentVersion({
  documentId,
  version,
  options = {},
}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const documentVersion =
    await findVersion(
      document,
      version,
      options
    );

  return {
    document,
    version:
      documentVersion,
  };
}

/* ============================================================================
 * List published public documents
 * ========================================================================== */

async function listPublicLegalDocuments({
  category,
  jurisdiction,
  audience,
  limit = 100,
  skip = 0,
  options = {},
} = {}) {
  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      500
    );

  const safeSkip =
    Math.max(
      Number(skip) || 0,
      0
    );

  const query = {
    status:
      LEGAL_STATUS.PUBLISHED,

    public: true,
  };

  if (category) {
    query.category =
      normalizeString(category);
  }

  if (jurisdiction) {
    query.jurisdiction =
      normalizeString(jurisdiction);
  }

  if (audience) {
    query.audience =
      normalizeString(audience);
  }

  return LegalDocument
    .find(
      query,
      null,
      getLeanOptions(options)
    )
    .sort({
      priority: 1,
      title: 1,
    })
    .skip(safeSkip)
    .limit(safeLimit);
}

/* ============================================================================
 * List documents by lifecycle status
 * ========================================================================== */

async function listLegalDocumentsByStatus({
  status,
  category,
  limit = 100,
  skip = 0,
  options = {},
} = {}) {
  const normalizedStatus =
    validateStatus(status);

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      500
    );

  const safeSkip =
    Math.max(
      Number(skip) || 0,
      0
    );

  const query = {
    status:
      normalizedStatus,
  };

  if (category) {
    query.category =
      normalizeString(category);
  }

  return LegalDocument
    .find(
      query,
      null,
      getLeanOptions(options)
    )
    .sort({
      updatedAt: -1,
      title: 1,
    })
    .skip(safeSkip)
    .limit(safeLimit);
}

/* ============================================================================
 * Search legal documents
 * ========================================================================== */

async function searchLegalDocuments({
  search,
  category,
  status,
  publicOnly = false,
  limit = 50,
  skip = 0,
  options = {},
} = {}) {
  const query = {};

  const normalizedSearch =
    normalizeString(search);

  if (normalizedSearch) {
    const escaped =
      normalizedSearch.replace(
        /[.*+?^${}()|[\]\\]/g,
        '\\$&'
      );

    query.$or = [
      {
        title: {
          $regex:
            escaped,
          $options: 'i',
        },
      },
      {
        shortTitle: {
          $regex:
            escaped,
          $options: 'i',
        },
      },
      {
        slug: {
          $regex:
            escaped,
          $options: 'i',
        },
      },
      {
        tags: {
          $regex:
            escaped,
          $options: 'i',
        },
      },
    ];
  }

  if (category) {
    query.category =
      normalizeString(category);
  }

  if (status) {
    query.status =
      validateStatus(status);
  }

  if (publicOnly) {
    query.public = true;
    query.status =
      LEGAL_STATUS.PUBLISHED;
  }

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 50,
        1
      ),
      200
    );

  const safeSkip =
    Math.max(
      Number(skip) || 0,
      0
    );

  return LegalDocument
    .find(
      query,
      null,
      getLeanOptions(options)
    )
    .sort({
      title: 1,
    })
    .skip(safeSkip)
    .limit(safeLimit);
}

/* ============================================================================
 * Get document history
 * ========================================================================== */

async function getLegalDocumentHistory({
  documentId,
  limit = 100,
  skip = 0,
  options = {},
} = {}) {
  const document =
    await findDocument(
      documentId,
      options
    );

  const safeLimit =
    Math.min(
      Math.max(
        Number(limit) || 100,
        1
      ),
      500
    );

  const safeSkip =
    Math.max(
      Number(skip) || 0,
      0
    );

  const versions =
    await LegalDocumentVersion
      .find(
        {
          $or: [
            {
              documentId:
                getDocumentId(
                  document
                ),
            },
            {
              legalDocumentId:
                getDocumentId(
                  document
                ),
            },
            ...(document._id
              ? [
                  {
                    document:
                      document._id,
                  },
                ]
              : []),
          ],
        },
        null,
        getLeanOptions(options)
      )
      .sort({
        version: -1,
        createdAt: -1,
      })
      .skip(safeSkip)
      .limit(safeLimit);

  return {
    document,
    versions,
  };
}

/* ============================================================================
 * Check whether document is publicly available
 * ========================================================================== */

function isPubliclyAvailable(
  document,
  version = null
) {
  if (!document) {
    return false;
  }

  if (
    document.public !== true ||
    document.status !==
      LEGAL_STATUS.PUBLISHED
  ) {
    return false;
  }

  if (
    version &&
    version.status !==
      LEGAL_STATUS.PUBLISHED
  ) {
    return false;
  }

  const effectiveDate =
    version?.effectiveDate ||
    document.effectiveDate;

  if (!effectiveDate) {
    return true;
  }

  const date =
    normalizeDate(
      effectiveDate
    );

  if (!date) {
    return false;
  }

  return (
    date.getTime() <=
    Date.now()
  );
}

/* ============================================================================
 * Service metadata
 * ========================================================================== */

function getServiceMetadata() {
  return Object.freeze({
    service:
      SERVICE_NAME,

    version:
      SERVICE_VERSION,

    statuses:
      LEGAL_STATUS,

    auditEvents:
      AUDIT_EVENT,
  });
}

/* ============================================================================
 * Public service API
 * ========================================================================== */

module.exports = {
  SERVICE_NAME,

  SERVICE_VERSION,

  LEGAL_STATUS,

  AUDIT_EVENT,

  LegalDocumentServiceError,

  createLegalDocument,

  updateLegalDocument,

  createLegalDocumentVersion,

  submitVersionForReview,

  approveLegalDocumentVersion,

  publishLegalDocumentVersion,

  scheduleLegalDocumentVersion,

  supersedeLegalDocumentVersion,

  retireLegalDocument,

  getCurrentLegalDocument,

  getLegalDocumentVersion,

  listPublicLegalDocuments,

  listLegalDocumentsByStatus,

  searchLegalDocuments,

  getLegalDocumentHistory,

  isPubliclyAvailable,

  getServiceMetadata,
};