/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Legal Acceptance Service
 * ============================================================================
 *
 * File:
 *   backend/legal/services/legalAcceptanceService.js
 *
 * Purpose:
 *   Enterprise service layer responsible for recording, validating, querying,
 *   and enforcing acceptance of TITech Community Capital legal documents.
 *
 * Architectural position:
 *   Controller
 *       ↓
 *   legalAcceptanceService
 *       ↓
 *   LegalDocument / LegalDocumentVersion
 *   LegalAcceptance
 *   LegalAuditEvent
 *
 * Design principles:
 *   ✓ Explicit legal-document/version validation
 *   ✓ Immutable acceptance semantics
 *   ✓ Version-aware acceptance
 *   ✓ Scope-aware acceptance
 *   ✓ User / tenant / organization / transaction support
 *   ✓ Idempotent acceptance handling
 *   ✓ Duplicate-acceptance protection
 *   ✓ Effective-date validation
 *   ✓ Published-version enforcement
 *   ✓ Transaction/session compatibility
 *   ✓ Audit-event integration
 *   ✓ Safe error semantics
 *   ✓ No substantive legal wording
 *   ✓ No authorization decisions hidden in the model
 *   ✓ Suitable for REST/API controllers
 *   ✓ Suitable for future event-driven architecture
 *   ✓ TITech terminology consistency
 *
 * IMPORTANT:
 *   This service implements application-level legal acceptance mechanics.
 *   It does not constitute legal advice, regulatory approval, licensing,
 *   authorization, or a determination that TITech may provide any regulated
 *   financial service.
 *
 *   Legal and compliance requirements must be reviewed by appropriately
 *   qualified professionals before production use.
 *
 * ============================================================================
 */

'use strict';

const crypto = require('crypto');

const LegalAcceptance = require('../models/LegalAcceptance');
const LegalDocument = require('../models/LegalDocument');
const LegalDocumentVersion = require('../models/LegalDocumentVersion');
const LegalAuditEvent = require('../models/LegalAuditEvent');

/* ============================================================================
 * Constants
 * ========================================================================== */

const SERVICE_NAME = 'titech-legal-acceptance-service';

const ACCEPTANCE_STATUSES = Object.freeze({
  ACCEPTED: 'accepted',
  REVOKED: 'revoked',
  SUPERSEDED: 'superseded',
});

const ACCEPTANCE_SCOPES = Object.freeze({
  USER: 'user',
  TENANT: 'tenant',
  ORGANIZATION: 'organization',
  TRANSACTION: 'transaction',
});

const LEGAL_STATUSES = Object.freeze({
  PUBLISHED: 'published',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  SUPERSEDED: 'superseded',
  RETIRED: 'retired',
  DRAFT: 'draft',
  REVIEW: 'review',
});

const AUDIT_EVENTS = Object.freeze({
  ACCEPTED: 'legal.acceptance.accepted',
  ACCEPTANCE_ALREADY_EXISTS: 'legal.acceptance.idempotent',
  ACCEPTANCE_CHECKED: 'legal.acceptance.checked',
  ACCEPTANCE_REJECTED: 'legal.acceptance.rejected',
});

/**
 * ============================================================================
 * Error type
 * ============================================================================
 */

class LegalAcceptanceServiceError extends Error {
  constructor(message, code = 'LEGAL_ACCEPTANCE_ERROR', details = {}) {
    super(message);

    this.name = 'LegalAcceptanceServiceError';
    this.code = code;
    this.details = details;
    this.service = SERVICE_NAME;

    Error.captureStackTrace?.(
      this,
      LegalAcceptanceServiceError
    );
  }
}

/* ============================================================================
 * Utility helpers
 * ========================================================================== */

function normalizeString(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}

function normalizeId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  return normalizeString(String(value));
}

function normalizeScope(scope) {
  const normalized = normalizeString(scope)?.toLowerCase();

  if (!normalized) {
    return null;
  }

  return Object.values(ACCEPTANCE_SCOPES).includes(normalized)
    ? normalized
    : null;
}

function normalizeIpAddress(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 128);
}

function normalizeUserAgent(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 1024);
}

function normalizeRequestId(value) {
  const normalized = normalizeString(value);

  if (!normalized) {
    return null;
  }

  return normalized.slice(0, 256);
}

function generateAcceptanceReference() {
  return `LAC-${Date.now().toString(36).toUpperCase()}-${crypto
    .randomBytes(6)
    .toString('hex')
    .toUpperCase()}`;
}

function getDocumentId(document) {
  return normalizeId(
    document?.id ||
    document?._id ||
    document?.documentId
  );
}

function getVersionId(version) {
  return normalizeId(
    version?.id ||
    version?._id ||
    version?.versionId
  );
}

function getVersionNumber(version) {
  return normalizeString(
    version?.version ||
    version?.versionNumber ||
    version?.documentVersion
  );
}

function getDocumentStatus(document) {
  return normalizeString(
    document?.status
  )?.toLowerCase();
}

function getVersionStatus(version) {
  return normalizeString(
    version?.status
  )?.toLowerCase();
}

function isPublishedStatus(status) {
  return status === LEGAL_STATUSES.PUBLISHED;
}

function isApprovedStatus(status) {
  return status === LEGAL_STATUSES.APPROVED;
}

function isFutureDate(date) {
  if (!date) {
    return false;
  }

  const timestamp = new Date(date).getTime();

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp > Date.now();
}

function isEffectiveDateValid(date) {
  if (!date) {
    return false;
  }

  const timestamp = new Date(date).getTime();

  if (Number.isNaN(timestamp)) {
    return false;
  }

  return timestamp <= Date.now();
}

function getSessionOptions(options = {}) {
  if (!options || typeof options !== 'object') {
    return {};
  }

  return options.session
    ? { session: options.session }
    : {};
}

/* ============================================================================
 * Validation
 * ========================================================================== */

function assertRequired(value, fieldName) {
  if (!normalizeId(value)) {
    throw new LegalAcceptanceServiceError(
      `${fieldName} is required.`,
      'LEGAL_ACCEPTANCE_REQUIRED_FIELD',
      { field: fieldName }
    );
  }
}

function validateAcceptanceScope({
  scope,
  userId,
  tenantId,
  organizationId,
  transactionId,
}) {
  const normalizedScope = normalizeScope(scope);

  if (!normalizedScope) {
    throw new LegalAcceptanceServiceError(
      'A valid legal acceptance scope is required.',
      'LEGAL_ACCEPTANCE_INVALID_SCOPE',
      {
        scope,
        allowedScopes: Object.values(ACCEPTANCE_SCOPES),
      }
    );
  }

  const scopeRequirements = {
    [ACCEPTANCE_SCOPES.USER]: userId,
    [ACCEPTANCE_SCOPES.TENANT]: tenantId,
    [ACCEPTANCE_SCOPES.ORGANIZATION]: organizationId,
    [ACCEPTANCE_SCOPES.TRANSACTION]: transactionId,
  };

  assertRequired(
    scopeRequirements[normalizedScope],
    `${normalizedScope} scope identifier`
  );

  return normalizedScope;
}

/* ============================================================================
 * Document lookup
 * ========================================================================== */

async function findLegalDocument(documentId, options = {}) {
  assertRequired(documentId, 'documentId');

  const normalizedDocumentId = normalizeId(documentId);

  const query = {
    $or: [
      { id: normalizedDocumentId },
      { documentId: normalizedDocumentId },
      { slug: normalizedDocumentId },
    ],
  };

  const document = await LegalDocument.findOne(
    query,
    null,
    getSessionOptions(options)
  );

  if (!document) {
    throw new LegalAcceptanceServiceError(
      'Legal document was not found.',
      'LEGAL_DOCUMENT_NOT_FOUND',
      {
        documentId: normalizedDocumentId,
      }
    );
  }

  return document;
}

/* ============================================================================
 * Version lookup
 * ========================================================================== */

async function findLegalDocumentVersion(
  document,
  version,
  options = {}
) {
  const documentId = getDocumentId(document);

  assertRequired(documentId, 'documentId');

  const normalizedVersion = normalizeString(version);

  const query = {
    $or: [
      {
        documentId,
        version: normalizedVersion,
      },
      {
        legalDocumentId: documentId,
        version: normalizedVersion,
      },
      {
        document: document._id,
        version: normalizedVersion,
      },
    ],
  };

  const documentVersion = await LegalDocumentVersion.findOne(
    query,
    null,
    getSessionOptions(options)
  );

  if (!documentVersion) {
    throw new LegalAcceptanceServiceError(
      'The requested legal document version was not found.',
      'LEGAL_DOCUMENT_VERSION_NOT_FOUND',
      {
        documentId,
        version: normalizedVersion,
      }
    );
  }

  return documentVersion;
}

/* ============================================================================
 * Published/current version validation
 * ========================================================================== */

function validatePublishedDocument(document) {
  const status = getDocumentStatus(document);

  if (
    !isPublishedStatus(status) &&
    !isApprovedStatus(status)
  ) {
    throw new LegalAcceptanceServiceError(
      'The legal document is not available for acceptance.',
      'LEGAL_DOCUMENT_NOT_ACCEPTABLE',
      {
        documentId: getDocumentId(document),
        status,
      }
    );
  }
}

function validatePublishedVersion(version) {
  const status = getVersionStatus(version);

  /**
   * Some deployments store publication state on the parent document rather
   * than on the version. Therefore an absent version status is permitted,
   * while an explicitly non-published terminal status is rejected.
   */
  if (
    status &&
    ![
      LEGAL_STATUSES.PUBLISHED,
      LEGAL_STATUSES.APPROVED,
    ].includes(status)
  ) {
    throw new LegalAcceptanceServiceError(
      'The legal document version is not available for acceptance.',
      'LEGAL_VERSION_NOT_ACCEPTABLE',
      {
        versionId: getVersionId(version),
        version: getVersionNumber(version),
        status,
      }
    );
  }

  const effectiveDate =
    version.effectiveDate ||
    version.effectiveFrom;

  if (effectiveDate && !isEffectiveDateValid(effectiveDate)) {
    throw new LegalAcceptanceServiceError(
      'The legal document version is not yet effective.',
      'LEGAL_VERSION_NOT_EFFECTIVE',
      {
        version: getVersionNumber(version),
        effectiveDate,
      }
    );
  }
}

/* ============================================================================
 * Acceptance identity
 * ========================================================================== */

function buildAcceptanceQuery({
  document,
  version,
  scope,
  userId,
  tenantId,
  organizationId,
  transactionId,
}) {
  const documentId = getDocumentId(document);
  const versionId = getVersionId(version);
  const versionNumber = getVersionNumber(version);

  const query = {
    documentId,
    scope,
    status: ACCEPTANCE_STATUSES.ACCEPTED,
  };

  if (versionId) {
    query.versionId = versionId;
  }

  if (versionNumber) {
    query.version = versionNumber;
  }

  if (scope === ACCEPTANCE_SCOPES.USER) {
    query.userId = normalizeId(userId);
  }

  if (scope === ACCEPTANCE_SCOPES.TENANT) {
    query.tenantId = normalizeId(tenantId);
  }

  if (scope === ACCEPTANCE_SCOPES.ORGANIZATION) {
    query.organizationId = normalizeId(organizationId);
  }

  if (scope === ACCEPTANCE_SCOPES.TRANSACTION) {
    query.transactionId = normalizeId(transactionId);
  }

  return query;
}

/* ============================================================================
 * Audit logging
 * ========================================================================== */

async function createAuditEvent({
  eventType,
  acceptance,
  document,
  version,
  actor,
  metadata = {},
  options = {},
}) {
  if (!LegalAuditEvent) {
    return null;
  }

  const acceptanceId = normalizeId(
    acceptance?.id ||
    acceptance?._id
  );

  const documentId = getDocumentId(document);
  const versionId = getVersionId(version);

  const auditPayload = {
    eventType,

    action: eventType,

    service: SERVICE_NAME,

    entityType: 'LegalAcceptance',

    entityId: acceptanceId,

    legalDocumentId: documentId,

    legalDocumentVersionId: versionId,

    actorUserId: normalizeId(actor?.userId),

    tenantId: normalizeId(actor?.tenantId),

    organizationId: normalizeId(actor?.organizationId),

    requestId: normalizeRequestId(metadata.requestId),

    ipAddress: normalizeIpAddress(metadata.ipAddress),

    userAgent: normalizeUserAgent(metadata.userAgent),

    metadata: {
      acceptanceReference:
        acceptance?.acceptanceReference || null,

      version:
        getVersionNumber(version),

      scope:
        acceptance?.scope || null,

      ...metadata,
    },
  };

  try {
    return await LegalAuditEvent.create(
      [auditPayload],
      getSessionOptions(options)
    ).then((result) => result[0]);
  } catch (error) {
    /**
     * Audit failures must never silently corrupt an acceptance transaction.
     *
     * The acceptance operation should normally be executed in the same
     * database transaction as the audit event. If the caller supplied a
     * MongoDB session, throwing here allows the transaction to roll back.
     */
    throw new LegalAcceptanceServiceError(
      'Legal acceptance audit event could not be recorded.',
      'LEGAL_AUDIT_WRITE_FAILED',
      {
        cause: error.message,
      }
    );
  }
}

/* ============================================================================
 * Accept legal document
 * ========================================================================== */

async function acceptLegalDocument({
  documentId,
  version,
  userId,
  tenantId,
  organizationId,
  transactionId,
  scope,
  actor = {},
  metadata = {},
  options = {},
}) {
  assertRequired(documentId, 'documentId');

  const normalizedScope = validateAcceptanceScope({
    scope,
    userId,
    tenantId,
    organizationId,
    transactionId,
  });

  const document = await findLegalDocument(
    documentId,
    options
  );

  validatePublishedDocument(document);

  const documentVersion = await findLegalDocumentVersion(
    document,
    version || document.currentVersion,
    options
  );

  validatePublishedVersion(documentVersion);

  const documentAcceptanceRequired =
    document.requiresAcceptance !== false;

  if (!documentAcceptanceRequired) {
    throw new LegalAcceptanceServiceError(
      'This legal document does not require acceptance.',
      'LEGAL_ACCEPTANCE_NOT_REQUIRED',
      {
        documentId: getDocumentId(document),
      }
    );
  }

  const acceptanceQuery = buildAcceptanceQuery({
    document,
    version: documentVersion,
    scope: normalizedScope,
    userId,
    tenantId,
    organizationId,
    transactionId,
  });

  const existingAcceptance =
    await LegalAcceptance.findOne(
      acceptanceQuery,
      null,
      getSessionOptions(options)
    );

  if (existingAcceptance) {
    return Object.freeze({
      created: false,
      idempotent: true,
      acceptance: existingAcceptance,
      document,
      version: documentVersion,
    });
  }

  const acceptancePayload = {
    acceptanceReference:
      generateAcceptanceReference(),

    documentId:
      getDocumentId(document),

    versionId:
      getVersionId(documentVersion),

    version:
      getVersionNumber(documentVersion),

    scope:
      normalizedScope,

    status:
      ACCEPTANCE_STATUSES.ACCEPTED,

    userId:
      normalizeId(userId),

    tenantId:
      normalizeId(tenantId),

    organizationId:
      normalizeId(organizationId),

    transactionId:
      normalizeId(transactionId),

    acceptedAt:
      new Date(),

    ipAddress:
      normalizeIpAddress(metadata.ipAddress),

    userAgent:
      normalizeUserAgent(metadata.userAgent),

    requestId:
      normalizeRequestId(metadata.requestId),

    acceptanceMethod:
      normalizeString(
        metadata.acceptanceMethod
      ) || 'explicit',

    metadata: {
      source:
        normalizeString(metadata.source) ||
        'titech-web-application',

      ...metadata,
    },
  };

  let acceptance;

  try {
    const created = await LegalAcceptance.create(
      [acceptancePayload],
      getSessionOptions(options)
    );

    acceptance = created[0];
  } catch (error) {
    /**
     * Unique indexes may race under concurrent requests. Re-query before
     * exposing a duplicate-key failure to the caller.
     */
    if (error?.code === 11000) {
      const concurrentAcceptance =
        await LegalAcceptance.findOne(
          acceptanceQuery,
          null,
          getSessionOptions(options)
        );

      if (concurrentAcceptance) {
        return Object.freeze({
          created: false,
          idempotent: true,
          acceptance: concurrentAcceptance,
          document,
          version: documentVersion,
        });
      }
    }

    throw new LegalAcceptanceServiceError(
      'Legal document acceptance could not be recorded.',
      'LEGAL_ACCEPTANCE_CREATE_FAILED',
      {
        cause: error.message,
      }
    );
  }

  await createAuditEvent({
    eventType: AUDIT_EVENTS.ACCEPTED,
    acceptance,
    document,
    version: documentVersion,
    actor,
    metadata,
    options,
  });

  return Object.freeze({
    created: true,
    idempotent: false,
    acceptance,
    document,
    version: documentVersion,
  });
}

/* ============================================================================
 * Check acceptance
 * ========================================================================== */

async function hasAcceptedLegalDocument({
  documentId,
  version,
  userId,
  tenantId,
  organizationId,
  transactionId,
  scope,
  options = {},
}) {
  assertRequired(documentId, 'documentId');

  const normalizedScope = validateAcceptanceScope({
    scope,
    userId,
    tenantId,
    organizationId,
    transactionId,
  });

  const document = await findLegalDocument(
    documentId,
    options
  );

  const requestedVersion =
    version ||
    document.currentVersion;

  const documentVersion =
    await findLegalDocumentVersion(
      document,
      requestedVersion,
      options
    );

  const query = buildAcceptanceQuery({
    document,
    version: documentVersion,
    scope: normalizedScope,
    userId,
    tenantId,
    organizationId,
    transactionId,
  });

  const acceptance =
    await LegalAcceptance.findOne(
      query,
      null,
      getSessionOptions(options)
    );

  return Boolean(acceptance);
}

/* ============================================================================
 * Get acceptance record
 * ========================================================================== */

async function getLegalAcceptance({
  documentId,
  version,
  userId,
  tenantId,
  organizationId,
  transactionId,
  scope,
  options = {},
}) {
  assertRequired(documentId, 'documentId');

  const normalizedScope = validateAcceptanceScope({
    scope,
    userId,
    tenantId,
    organizationId,
    transactionId,
  });

  const document = await findLegalDocument(
    documentId,
    options
  );

  const documentVersion =
    await findLegalDocumentVersion(
      document,
      version || document.currentVersion,
      options
    );

  const query = buildAcceptanceQuery({
    document,
    version: documentVersion,
    scope: normalizedScope,
    userId,
    tenantId,
    organizationId,
    transactionId,
  });

  return LegalAcceptance.findOne(
    query,
    null,
    getSessionOptions(options)
  );
}

/* ============================================================================
 * Determine documents requiring acceptance
 * ========================================================================== */

async function getRequiredAcceptances({
  documentIds = [],
  userId,
  tenantId,
  organizationId,
  transactionId,
  scope,
  options = {},
}) {
  const normalizedScope = normalizeScope(scope);

  if (!normalizedScope) {
    throw new LegalAcceptanceServiceError(
      'A valid legal acceptance scope is required.',
      'LEGAL_ACCEPTANCE_INVALID_SCOPE'
    );
  }

  const documentsQuery = {
    status: {
      $in: [
        LEGAL_STATUSES.PUBLISHED,
        LEGAL_STATUSES.APPROVED,
      ],
    },

    requiresAcceptance: true,
  };

  if (Array.isArray(documentIds) && documentIds.length > 0) {
    documentsQuery.$or = [
      {
        id: {
          $in: documentIds.map(normalizeId).filter(Boolean),
        },
      },
      {
        documentId: {
          $in: documentIds.map(normalizeId).filter(Boolean),
        },
      },
    ];
  }

  const documents =
    await LegalDocument.find(
      documentsQuery,
      null,
      getSessionOptions(options)
    ).lean();

  const required = [];

  for (const document of documents) {
    const acceptanceScope =
      normalizeScope(
        document.acceptanceScope
      );

    if (acceptanceScope !== normalizedScope) {
      continue;
    }

    const currentVersion =
      document.currentVersion;

    if (!currentVersion) {
      continue;
    }

    const documentVersion =
      await findLegalDocumentVersion(
        document,
        currentVersion,
        options
      );

    try {
      validatePublishedVersion(documentVersion);
    } catch {
      continue;
    }

    const accepted =
      await hasAcceptedLegalDocument({
        documentId:
          getDocumentId(document),

        version:
          getVersionNumber(documentVersion),

        userId,
        tenantId,
        organizationId,
        transactionId,

        scope:
          normalizedScope,

        options,
      });

    if (!accepted) {
      required.push({
        document,
        version: documentVersion,
      });
    }
  }

  return required;
}

/* ============================================================================
 * Enforce acceptance
 *
 * Intended for controllers/services performing protected legal or financial
 * workflows.
 * ========================================================================== */

async function enforceLegalAcceptance({
  documentId,
  version,
  userId,
  tenantId,
  organizationId,
  transactionId,
  scope,
  options = {},
}) {
  const accepted =
    await hasAcceptedLegalDocument({
      documentId,
      version,
      userId,
      tenantId,
      organizationId,
      transactionId,
      scope,
      options,
    });

  if (!accepted) {
    throw new LegalAcceptanceServiceError(
      'Required legal acceptance has not been completed.',
      'LEGAL_ACCEPTANCE_REQUIRED',
      {
        documentId,
        version: version || null,
        scope,
      }
    );
  }

  return true;
}

/* ============================================================================
 * User acceptance history
 * ========================================================================== */

async function getUserAcceptanceHistory({
  userId,
  tenantId,
  limit = 100,
  skip = 0,
  options = {},
}) {
  assertRequired(userId, 'userId');

  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    500
  );

  const safeSkip = Math.max(
    Number(skip) || 0,
    0
  );

  const query = {
    userId: normalizeId(userId),
  };

  if (tenantId) {
    query.tenantId = normalizeId(tenantId);
  }

  return LegalAcceptance
    .find(
      query,
      null,
      getSessionOptions(options)
    )
    .sort({
      acceptedAt: -1,
      createdAt: -1,
    })
    .skip(safeSkip)
    .limit(safeLimit)
    .lean();
}

/* ============================================================================
 * Tenant acceptance history
 * ========================================================================== */

async function getTenantAcceptanceHistory({
  tenantId,
  limit = 100,
  skip = 0,
  options = {},
}) {
  assertRequired(tenantId, 'tenantId');

  const safeLimit = Math.min(
    Math.max(Number(limit) || 100, 1),
    500
  );

  const safeSkip = Math.max(
    Number(skip) || 0,
    0
  );

  return LegalAcceptance
    .find(
      {
        tenantId: normalizeId(tenantId),
      },
      null,
      getSessionOptions(options)
    )
    .sort({
      acceptedAt: -1,
      createdAt: -1,
    })
    .skip(safeSkip)
    .limit(safeLimit)
    .lean();
}

/* ============================================================================
 * Revoke acceptance
 *
 * This should only be used where legally/operationally appropriate.
 * Existing acceptance records remain immutable historical evidence; the
 * service changes state rather than deleting the record.
 * ========================================================================== */

async function revokeAcceptance({
  acceptanceId,
  actor = {},
  reason,
  metadata = {},
  options = {},
}) {
  assertRequired(
    acceptanceId,
    'acceptanceId'
  );

  const acceptance =
    await LegalAcceptance.findOne(
      {
        $or: [
          {
            _id: acceptanceId,
          },
          {
            id: acceptanceId,
          },
          {
            acceptanceReference: acceptanceId,
          },
        ],
      },
      null,
      getSessionOptions(options)
    );

  if (!acceptance) {
    throw new LegalAcceptanceServiceError(
      'Legal acceptance record was not found.',
      'LEGAL_ACCEPTANCE_NOT_FOUND',
      {
        acceptanceId,
      }
    );
  }

  if (
    acceptance.status ===
    ACCEPTANCE_STATUSES.REVOKED
  ) {
    return acceptance;
  }

  acceptance.status =
    ACCEPTANCE_STATUSES.REVOKED;

  acceptance.revokedAt =
    new Date();

  acceptance.revokedBy =
    normalizeId(actor.userId);

  acceptance.revocationReason =
    normalizeString(reason);

  await acceptance.save(
    getSessionOptions(options)
  );

  const document =
    await LegalDocument.findOne(
      {
        $or: [
          {
            id: acceptance.documentId,
          },
          {
            documentId: acceptance.documentId,
          },
        ],
      },
      null,
      getSessionOptions(options)
    );

  const version =
    document
      ? await LegalDocumentVersion.findOne(
          {
            $or: [
              {
                id: acceptance.versionId,
              },
              {
                _id: acceptance.versionId,
              },
            ],
          },
          null,
          getSessionOptions(options)
        )
      : null;

  await createAuditEvent({
    eventType:
      'legal.acceptance.revoked',

    acceptance,

    document,

    version,

    actor,

    metadata: {
      reason,
      ...metadata,
    },

    options,
  });

  return acceptance;
}

/* ============================================================================
 * Service health / capability information
 * ========================================================================== */

function getServiceMetadata() {
  return Object.freeze({
    service: SERVICE_NAME,

    version: '1.0.0',

    acceptanceStatuses:
      ACCEPTANCE_STATUSES,

    acceptanceScopes:
      ACCEPTANCE_SCOPES,

    auditEvents:
      AUDIT_EVENTS,
  });
}

/* ============================================================================
 * Public API
 * ========================================================================== */

module.exports = {
  SERVICE_NAME,

  ACCEPTANCE_STATUSES,

  ACCEPTANCE_SCOPES,

  AUDIT_EVENTS,

  LegalAcceptanceServiceError,

  acceptLegalDocument,

  hasAcceptedLegalDocument,

  getLegalAcceptance,

  getRequiredAcceptances,

  enforceLegalAcceptance,

  getUserAcceptanceHistory,

  getTenantAcceptanceHistory,

  revokeAcceptance,

  getServiceMetadata,
};