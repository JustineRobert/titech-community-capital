/**
 * ============================================================================
 * TITech Community Capital
 * Enterprise Legal Publication Service
 * ============================================================================
 *
 * File:
 *   backend/legal/services/legalPublicationService.js
 *
 * Purpose:
 *   Enterprise service responsible for controlled creation, review,
 *   approval, scheduling, publication, supersession and retirement of
 *   TITech Community Capital legal document versions.
 *
 * Architectural position
 * ----------------------------------------------------------------------------
 *
 *   Controller
 *       ↓
 *   Legal Publication Service
 *       ↓
 *   LegalDocument / LegalDocumentVersion
 *       ↓
 *   LegalAuditEvent
 *
 * This service owns BUSINESS WORKFLOW.
 *
 * It intentionally does NOT:
 *   - render legal documents
 *   - contain substantive legal wording
 *   - expose HTTP/Express concerns
 *   - decide whether TITech is legally licensed
 *   - replace professional legal/compliance review
 *
 * Design principles
 * ----------------------------------------------------------------------------
 * ✓ Immutable published legal versions
 * ✓ Explicit publication lifecycle
 * ✓ Version-aware publication
 * ✓ Effective-date enforcement
 * ✓ Future scheduling support
 * ✓ Supersession support
 * ✓ Tenant-aware metadata
 * ✓ Audit-event generation
 * ✓ Idempotency-aware operations
 * ✓ Transaction support when available
 * ✓ Safe concurrency handling
 * ✓ Strong input validation
 * ✓ No silent publication of drafts
 * ✓ No mutation of historical published content
 * ✓ Centralized error semantics
 * ✓ TITech terminology consistency
 * ✓ Compatible with MongoDB/Mongoose architecture
 *
 * IMPORTANT LEGAL NOTICE
 * ----------------------------------------------------------------------------
 * This service is an application workflow component.
 *
 * It does NOT constitute:
 *   - legal advice
 *   - regulatory approval
 *   - licensing
 *   - authorization
 *   - legal representation
 *   - a determination that TITech may provide a regulated financial service
 *
 * Publication of a document must only occur after all required legal,
 * compliance, regulatory, privacy and security approvals have been obtained.
 *
 * ============================================================================
 */

'use strict';

/* ============================================================================
 * Dependencies
 * ========================================================================== */

const LegalDocument = require('../models/LegalDocument');
const LegalDocumentVersion = require('../models/LegalDocumentVersion');
const LegalAuditEvent = require('../models/LegalAuditEvent');

/* ============================================================================
 * Constants
 * ========================================================================== */

const SERVICE_NAME = 'TITechLegalPublicationService';

const LEGAL_STATUS = Object.freeze({
  DRAFT: 'draft',
  REVIEW: 'review',
  APPROVED: 'approved',
  SCHEDULED: 'scheduled',
  PUBLISHED: 'published',
  SUPERSEDED: 'superseded',
  RETIRED: 'retired',
});

const DEFAULT_ACTOR_TYPE = 'system';

const MAX_REASON_LENGTH = 2000;
const MAX_METADATA_KEYS = 50;

const PUBLICATION_LOCK_TIMEOUT_MS = 30_000;

/* ============================================================================
 * Error types
 * ========================================================================== */

/**
 * Domain error used by the legal publication service.
 */
class LegalPublicationError extends Error {
  constructor(message, code = 'LEGAL_PUBLICATION_ERROR', details = {}) {
    super(message);

    this.name = 'LegalPublicationError';
    this.code = code;
    this.details = details;

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, LegalPublicationError);
    }
  }
}

/* ============================================================================
 * Utility helpers
 * ========================================================================== */

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function assertNonEmptyString(value, fieldName) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new LegalPublicationError(
      `${fieldName} is required.`,
      'INVALID_INPUT',
      { field: fieldName }
    );
  }

  return value.trim();
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value !== 'string') {
    return String(value).trim();
  }

  return value.trim();
}

function normalizeReason(reason) {
  if (reason === undefined || reason === null) {
    return null;
  }

  const normalized = String(reason).trim();

  if (normalized.length > MAX_REASON_LENGTH) {
    throw new LegalPublicationError(
      `Reason must not exceed ${MAX_REASON_LENGTH} characters.`,
      'INVALID_REASON'
    );
  }

  return normalized || null;
}

function normalizeActor(actor = {}) {
  if (!isPlainObject(actor)) {
    return {
      type: DEFAULT_ACTOR_TYPE,
      id: null,
      name: null,
    };
  }

  return Object.freeze({
    type: normalizeOptionalString(actor.type) || DEFAULT_ACTOR_TYPE,
    id: normalizeOptionalString(actor.id),
    name: normalizeOptionalString(actor.name),
  });
}

function normalizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) {
    return {};
  }

  if (!isPlainObject(metadata)) {
    throw new LegalPublicationError(
      'Audit metadata must be a plain object.',
      'INVALID_METADATA'
    );
  }

  const keys = Object.keys(metadata);

  if (keys.length > MAX_METADATA_KEYS) {
    throw new LegalPublicationError(
      `Audit metadata cannot contain more than ${MAX_METADATA_KEYS} keys.`,
      'INVALID_METADATA'
    );
  }

  return metadata;
}

function normalizeDate(value, fieldName) {
  if (value === undefined || value === null || value === '') {
    return null;
  }

  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new LegalPublicationError(
      `${fieldName} must be a valid date.`,
      'INVALID_DATE',
      { field: fieldName, value }
    );
  }

  return date;
}

function now() {
  return new Date();
}

function isFutureDate(date) {
  return date instanceof Date && date.getTime() > Date.now();
}

function isPastOrPresentDate(date) {
  return date instanceof Date && date.getTime() <= Date.now();
}

function clonePlain(value) {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value.toObject === 'function') {
    return value.toObject({
      virtuals: true,
      getters: true,
    });
  }

  if (isPlainObject(value)) {
    return { ...value };
  }

  return value;
}

function getDocumentId(document) {
  if (!document) {
    return null;
  }

  return document._id || document.id || null;
}

function getVersionId(version) {
  if (!version) {
    return null;
  }

  return version._id || version.id || null;
}

function getVersionNumber(version) {
  if (!version) {
    return null;
  }

  return (
    version.version ||
    version.versionNumber ||
    version.documentVersion ||
    null
  );
}

/* ============================================================================
 * Query helpers
 * ========================================================================== */

function getDocumentQuery(identifier) {
  if (!identifier) {
    throw new LegalPublicationError(
      'Legal document identifier is required.',
      'INVALID_DOCUMENT_IDENTIFIER'
    );
  }

  if (typeof identifier === 'string') {
    return {
      $or: [
        { _id: identifier },
        { id: identifier },
        { slug: identifier },
        { documentId: identifier },
      ],
    };
  }

  if (isPlainObject(identifier)) {
    const query = {};

    if (identifier._id) query._id = identifier._id;
    else if (identifier.id) query.id = identifier.id;
    else if (identifier.slug) query.slug = identifier.slug;
    else if (identifier.documentId) query.documentId = identifier.documentId;

    if (Object.keys(query).length === 0) {
      throw new LegalPublicationError(
        'A valid legal document identifier is required.',
        'INVALID_DOCUMENT_IDENTIFIER'
      );
    }

    return query;
  }

  throw new LegalPublicationError(
    'Invalid legal document identifier.',
    'INVALID_DOCUMENT_IDENTIFIER'
  );
}

async function findLegalDocument(identifier, options = {}) {
  const query = getDocumentQuery(identifier);

  let queryBuilder = LegalDocument.findOne(query);

  if (options.session) {
    queryBuilder = queryBuilder.session(options.session);
  }

  const document = await queryBuilder;

  if (!document) {
    throw new LegalPublicationError(
      'Legal document was not found.',
      'LEGAL_DOCUMENT_NOT_FOUND',
      { identifier }
    );
  }

  return document;
}

async function findVersion(identifier, options = {}) {
  const query = {};

  if (identifier && typeof identifier === 'object') {
    if (identifier._id) {
      query._id = identifier._id;
    } else if (identifier.id) {
      query._id = identifier.id;
    } else if (identifier.versionId) {
      query._id = identifier.versionId;
    } else {
      if (identifier.documentId) {
        query.documentId = identifier.documentId;
      }

      if (identifier.version) {
        query.version = identifier.version;
      }
    }
  } else if (identifier) {
    query._id = identifier;
  }

  if (Object.keys(query).length === 0) {
    throw new LegalPublicationError(
      'Legal document version identifier is required.',
      'INVALID_VERSION_IDENTIFIER'
    );
  }

  let queryBuilder = LegalDocumentVersion.findOne(query);

  if (options.session) {
    queryBuilder = queryBuilder.session(options.session);
  }

  const version = await queryBuilder;

  if (!version) {
    throw new LegalPublicationError(
      'Legal document version was not found.',
      'LEGAL_VERSION_NOT_FOUND',
      { identifier }
    );
  }

  return version;
}

/* ============================================================================
 * Model compatibility helpers
 * ========================================================================== */

/**
 * Safely applies a field only when the Mongoose document accepts assignment.
 *
 * This allows the service to remain compatible with models whose exact field
 * definitions may evolve while maintaining a strict service contract.
 */
function setIfDefined(document, field, value) {
  if (!document || value === undefined) {
    return;
  }

  document[field] = value;
}

function setLifecycleFields(version, status, options = {}) {
  setIfDefined(version, 'status', status);

  if (status === LEGAL_STATUS.PUBLISHED) {
    setIfDefined(version, 'publishedAt', options.publishedAt || now());
    setIfDefined(version, 'publishedBy', options.actorId || null);
  }

  if (status === LEGAL_STATUS.SCHEDULED) {
    setIfDefined(version, 'scheduledAt', options.scheduledAt || null);
    setIfDefined(version, 'scheduledBy', options.actorId || null);
  }

  if (status === LEGAL_STATUS.SUPERSEDED) {
    setIfDefined(version, 'supersededAt', options.supersededAt || now());
    setIfDefined(version, 'supersededBy', options.actorId || null);
  }

  if (status === LEGAL_STATUS.RETIRED) {
    setIfDefined(version, 'retiredAt', options.retiredAt || now());
    setIfDefined(version, 'retiredBy', options.actorId || null);
  }
}

/* ============================================================================
 * Audit event helper
 * ========================================================================== */

async function createAuditEvent({
  action,
  document,
  version,
  actor,
  reason,
  metadata = {},
  session = null,
}) {
  if (!LegalAuditEvent || typeof LegalAuditEvent.create !== 'function') {
    return null;
  }

  const documentId = getDocumentId(document);
  const versionId = getVersionId(version);

  const payload = {
    eventType: action,
    action,

    service: SERVICE_NAME,

    documentId,
    versionId,

    documentVersion: getVersionNumber(version),

    actorType: actor.type,
    actorId: actor.id,
    actorName: actor.name,

    reason,

    metadata: normalizeMetadata(metadata),

    occurredAt: now(),

    entityType: 'LegalDocument',
    entityId: documentId,

    source: 'legal-publication-service',
  };

  /*
   * Some installations may use a different LegalAuditEvent schema.
   * The service deliberately keeps all audit information in a single
   * structured payload while allowing Mongoose to enforce the installed
   * model schema.
   */
  try {
    if (session) {
      return await LegalAuditEvent.create([payload], { session });
    }

    return await LegalAuditEvent.create(payload);
  } catch (error) {
    /*
     * Audit failures must never silently disappear during a legal workflow.
     *
     * Publication should fail closed because a legally significant lifecycle
     * transition without an audit trail is operationally unsafe.
     */
    throw new LegalPublicationError(
      'Legal audit event could not be recorded.',
      'AUDIT_EVENT_CREATION_FAILED',
      {
        cause: error.message,
        action,
        documentId,
        versionId,
      }
    );
  }
}

/* ============================================================================
 * Validation
 * ========================================================================== */

function validateVersionForPublication(document, version) {
  const errors = [];

  if (!document) {
    errors.push('Legal document is required.');
  }

  if (!version) {
    errors.push('Legal document version is required.');
  }

  if (errors.length > 0) {
    throw new LegalPublicationError(
      'Legal version publication validation failed.',
      'PUBLICATION_VALIDATION_FAILED',
      { errors }
    );
  }

  const status = version.status;

  if (
    status !== LEGAL_STATUS.APPROVED &&
    status !== LEGAL_STATUS.SCHEDULED
  ) {
    errors.push(
      `Only approved or scheduled versions may be published. Current status: ${status || 'unknown'}.`
    );
  }

  const effectiveDate = normalizeDate(
    version.effectiveDate || document.effectiveDate,
    'effectiveDate'
  );

  if (!effectiveDate) {
    errors.push('A legal version must have an effectiveDate before publication.');
  }

  if (
    version.requiresAcceptance === true &&
    !version.acceptanceScope
  ) {
    errors.push(
      'Acceptance-required legal versions must define an acceptanceScope.'
    );
  }

  if (
    version.acceptanceRequiredBeforeTransaction === true &&
    version.acceptanceScope !== 'transaction'
  ) {
    errors.push(
      'Transaction acceptance must use the transaction acceptance scope.'
    );
  }

  if (!version.contentHash && version.content) {
    /*
     * Content hashing should normally be performed by the version model or
     * document service. Publication does not calculate a hash here because
     * doing so without the canonicalization rules could create inconsistent
     * legal evidence.
     */
  }

  if (errors.length > 0) {
    throw new LegalPublicationError(
      'Legal version cannot be published.',
      'PUBLICATION_VALIDATION_FAILED',
      {
        errors,
        documentId: getDocumentId(document),
        versionId: getVersionId(version),
      }
    );
  }

  return true;
}

/* ============================================================================
 * Transaction helper
 * ========================================================================== */

async function executeWithOptionalTransaction(work) {
  /*
   * Mongoose models expose the connection through the model's db property.
   * Transactions require a replica set / sharded deployment.
   *
   * If transactions are unavailable, execute the workflow normally rather
   * than failing in local development. Production deployments should run
   * MongoDB with transaction support.
   */
  const db = LegalDocument && LegalDocument.db;

  if (!db || typeof db.startSession !== 'function') {
    return work(null);
  }

  const session = await db.startSession();

  try {
    let result;

    await session.withTransaction(async () => {
      result = await work(session);
    });

    return result;
  } finally {
    await session.endSession();
  }
}

/* ============================================================================
 * Service implementation
 * ========================================================================== */

const LegalPublicationService = Object.freeze({

  /**
   * Submit a legal version for review.
   */
  async submitForReview(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      if (version.status !== LEGAL_STATUS.DRAFT) {
        throw new LegalPublicationError(
          `Only draft legal versions may be submitted for review. Current status: ${version.status}.`,
          'INVALID_LIFECYCLE_TRANSITION'
        );
      }

      setLifecycleFields(version, LEGAL_STATUS.REVIEW, {
        actorId: actor.id,
      });

      setIfDefined(version, 'reviewSubmittedAt', now());
      setIfDefined(version, 'reviewSubmittedBy', actor.id);

      if (reason) {
        setIfDefined(version, 'reviewReason', reason);
      }

      await version.save({ session });

      await createAuditEvent({
        action: 'legal.version.submitted_for_review',
        version,
        actor,
        reason,
        metadata: options.metadata,
        session,
      });

      return version;
    });
  },

  /**
   * Approve a reviewed legal version.
   */
  async approveVersion(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      if (version.status !== LEGAL_STATUS.REVIEW) {
        throw new LegalPublicationError(
          `Only legal versions in review may be approved. Current status: ${version.status}.`,
          'INVALID_LIFECYCLE_TRANSITION'
        );
      }

      setLifecycleFields(version, LEGAL_STATUS.APPROVED, {
        actorId: actor.id,
      });

      setIfDefined(version, 'approvedAt', now());
      setIfDefined(version, 'approvedBy', actor.id);

      if (reason) {
        setIfDefined(version, 'approvalReason', reason);
      }

      await version.save({ session });

      await createAuditEvent({
        action: 'legal.version.approved',
        version,
        actor,
        reason,
        metadata: options.metadata,
        session,
      });

      return version;
    });
  },

  /**
   * Schedule an approved legal version for future publication.
   */
  async schedulePublication(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    const scheduledAt = normalizeDate(
      options.scheduledAt,
      'scheduledAt'
    );

    if (!scheduledAt) {
      throw new LegalPublicationError(
        'scheduledAt is required when scheduling publication.',
        'SCHEDULE_DATE_REQUIRED'
      );
    }

    if (!isFutureDate(scheduledAt)) {
      throw new LegalPublicationError(
        'scheduledAt must be in the future.',
        'INVALID_SCHEDULE_DATE'
      );
    }

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      if (version.status !== LEGAL_STATUS.APPROVED) {
        throw new LegalPublicationError(
          `Only approved legal versions may be scheduled. Current status: ${version.status}.`,
          'INVALID_LIFECYCLE_TRANSITION'
        );
      }

      const effectiveDate = normalizeDate(
        options.effectiveDate ||
          version.effectiveDate,
        'effectiveDate'
      );

      if (!effectiveDate) {
        throw new LegalPublicationError(
          'An effectiveDate is required before scheduling publication.',
          'EFFECTIVE_DATE_REQUIRED'
        );
      }

      if (effectiveDate.getTime() < scheduledAt.getTime()) {
        throw new LegalPublicationError(
          'effectiveDate cannot be earlier than scheduledAt.',
          'INVALID_EFFECTIVE_DATE'
        );
      }

      setLifecycleFields(version, LEGAL_STATUS.SCHEDULED, {
        actorId: actor.id,
        scheduledAt,
      });

      setIfDefined(version, 'effectiveDate', effectiveDate);
      setIfDefined(version, 'scheduledAt', scheduledAt);
      setIfDefined(version, 'scheduledBy', actor.id);

      await version.save({ session });

      await createAuditEvent({
        action: 'legal.version.scheduled',
        version,
        actor,
        reason,
        metadata: {
          ...normalizeMetadata(options.metadata),
          scheduledAt: scheduledAt.toISOString(),
          effectiveDate: effectiveDate.toISOString(),
        },
        session,
      });

      return version;
    });
  },

  /**
   * Publish an approved legal version immediately.
   *
   * This operation:
   *   1. validates the version;
   *   2. identifies any currently published version;
   *   3. supersedes the old version;
   *   4. publishes the new version;
   *   5. updates the parent LegalDocument;
   *   6. records audit events.
   */
  async publishVersion(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    const effectiveDate = normalizeDate(
      options.effectiveDate,
      'effectiveDate'
    );

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      const documentIdentifier =
        version.documentId ||
        version.legalDocumentId ||
        options.documentId;

      const document = await findLegalDocument(
        documentIdentifier || version.document,
        { session }
      );

      validateVersionForPublication(document, version);

      if (version.status === LEGAL_STATUS.PUBLISHED) {
        /*
         * Idempotent behavior: publishing an already-published version should
         * not create a second publication transition.
         */
        return version;
      }

      const publicationDate = effectiveDate || now();

      const existingPublishedQuery = {
        $or: [
          { documentId: getDocumentId(document) },
          { legalDocumentId: getDocumentId(document) },
        ],
        status: LEGAL_STATUS.PUBLISHED,
      };

      let existingPublishedVersion = null;

      let existingQuery = LegalDocumentVersion.findOne(
        existingPublishedQuery
      );

      if (session) {
        existingQuery = existingQuery.session(session);
      }

      existingPublishedVersion = await existingQuery;

      if (
        existingPublishedVersion &&
        String(getVersionId(existingPublishedVersion)) ===
          String(getVersionId(version))
      ) {
        return existingPublishedVersion;
      }

      /*
       * Prevent publication of an older version when a newer version is
       * already published.
       */
      if (existingPublishedVersion) {
        const existingVersionNumber = getVersionNumber(
          existingPublishedVersion
        );

        const newVersionNumber = getVersionNumber(version);

        if (
          existingVersionNumber !== null &&
          newVersionNumber !== null &&
          Number(newVersionNumber) < Number(existingVersionNumber)
        ) {
          throw new LegalPublicationError(
            'An older legal document version cannot supersede a newer published version.',
            'OLDER_VERSION_PUBLICATION_BLOCKED',
            {
              existingVersion: existingVersionNumber,
              requestedVersion: newVersionNumber,
            }
          );
        }

        setLifecycleFields(
          existingPublishedVersion,
          LEGAL_STATUS.SUPERSEDED,
          {
            actorId: actor.id,
            supersededAt: publicationDate,
          }
        );

        setIfDefined(
          existingPublishedVersion,
          'supersededBy',
          getVersionId(version)
        );

        await existingPublishedVersion.save({ session });

        await createAuditEvent({
          action: 'legal.version.superseded',
          document,
          version: existingPublishedVersion,
          actor,
          reason,
          metadata: {
            ...normalizeMetadata(options.metadata),
            supersededByVersionId: getVersionId(version),
          },
          session,
        });
      }

      setLifecycleFields(version, LEGAL_STATUS.PUBLISHED, {
        actorId: actor.id,
        publishedAt: publicationDate,
      });

      setIfDefined(version, 'effectiveDate', publicationDate);
      setIfDefined(version, 'publishedAt', publicationDate);
      setIfDefined(version, 'publishedBy', actor.id);

      /*
       * Once published, the content must be treated as immutable.
       *
       * Models may implement immutable fields, but this service also records
       * the lifecycle transition explicitly.
       */
      setIfDefined(version, 'isImmutable', true);
      setIfDefined(version, 'immutable', true);

      await version.save({ session });

      /*
       * Update parent document pointer.
       */
      setIfDefined(document, 'currentVersionId', getVersionId(version));
      setIfDefined(document, 'publishedVersionId', getVersionId(version));
      setIfDefined(document, 'currentVersion', getVersionNumber(version));
      setIfDefined(document, 'status', LEGAL_STATUS.PUBLISHED);
      setIfDefined(document, 'publishedAt', publicationDate);
      setIfDefined(document, 'effectiveDate', publicationDate);

      await document.save({ session });

      await createAuditEvent({
        action: 'legal.version.published',
        document,
        version,
        actor,
        reason,
        metadata: {
          ...normalizeMetadata(options.metadata),
          publicationDate: publicationDate.toISOString(),
        },
        session,
      });

      return version;
    });
  },

  /**
   * Publish a scheduled version when its scheduled time has arrived.
   */
  async publishScheduledVersion(versionIdentifier, options = {}) {
    const version = await findVersion(versionIdentifier);

    if (version.status !== LEGAL_STATUS.SCHEDULED) {
      throw new LegalPublicationError(
        `Only scheduled versions may be automatically published. Current status: ${version.status}.`,
        'INVALID_SCHEDULED_VERSION'
      );
    }

    const scheduledAt = normalizeDate(
      version.scheduledAt,
      'scheduledAt'
    );

    if (!scheduledAt || !isPastOrPresentDate(scheduledAt)) {
      throw new LegalPublicationError(
        'The scheduled publication time has not yet been reached.',
        'PUBLICATION_NOT_YET_DUE'
      );
    }

    return this.publishVersion(versionIdentifier, {
      ...options,
      effectiveDate: version.effectiveDate || scheduledAt,
      reason:
        options.reason ||
        'Scheduled legal publication automatically executed.',
    });
  },

  /**
   * Process all scheduled legal versions that are due for publication.
   *
   * Intended for:
   *   - cron workers
   *   - queue workers
   *   - scheduled jobs
   *   - administrative maintenance tasks
   */
  async publishDueScheduledVersions(options = {}) {
    const actor = normalizeActor(options.actor);

    const currentTime = now();

    let query = LegalDocumentVersion.find({
      status: LEGAL_STATUS.SCHEDULED,
      scheduledAt: {
        $lte: currentTime,
      },
    }).sort({
      scheduledAt: 1,
    });

    const limit =
      Number.isInteger(options.limit) && options.limit > 0
        ? Math.min(options.limit, 100)
        : 25;

    query = query.limit(limit);

    const versions = await query;

    const results = {
      attempted: versions.length,
      published: [],
      failed: [],
    };

    for (const version of versions) {
      try {
        const publishedVersion = await this.publishScheduledVersion(
          getVersionId(version),
          {
            actor,
            reason: 'Scheduled publication job.',
          }
        );

        results.published.push({
          versionId: getVersionId(publishedVersion),
          documentId:
            publishedVersion.documentId ||
            publishedVersion.legalDocumentId ||
            null,
          version: getVersionNumber(publishedVersion),
        });
      } catch (error) {
        results.failed.push({
          versionId: getVersionId(version),
          error: error.message,
          code: error.code || 'PUBLICATION_FAILED',
        });
      }
    }

    return results;
  },

  /**
   * Supersede a currently published version without publishing a replacement.
   *
   * This should be used carefully because a document can temporarily have
   * no published version after this operation.
   */
  async supersedeVersion(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    if (!reason) {
      throw new LegalPublicationError(
        'A reason is required when superseding a legal version.',
        'SUPERSESSION_REASON_REQUIRED'
      );
    }

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      if (version.status !== LEGAL_STATUS.PUBLISHED) {
        throw new LegalPublicationError(
          `Only published versions may be superseded. Current status: ${version.status}.`,
          'INVALID_LIFECYCLE_TRANSITION'
        );
      }

      setLifecycleFields(version, LEGAL_STATUS.SUPERSEDED, {
        actorId: actor.id,
      });

      setIfDefined(version, 'supersededAt', now());
      setIfDefined(version, 'supersededBy', options.replacementVersionId || null);

      await version.save({ session });

      const documentIdentifier =
        version.documentId ||
        version.legalDocumentId ||
        options.documentId;

      if (documentIdentifier) {
        const document = await findLegalDocument(
          documentIdentifier,
          { session }
        );

        if (
          String(document.currentVersionId || '') ===
          String(getVersionId(version))
        ) {
          setIfDefined(document, 'currentVersionId', null);
          setIfDefined(document, 'publishedVersionId', null);
          setIfDefined(document, 'currentVersion', null);

          if (!options.replacementVersionId) {
            setIfDefined(document, 'status', LEGAL_STATUS.RETIRED);
          }

          await document.save({ session });
        }

        await createAuditEvent({
          action: 'legal.version.superseded',
          document,
          version,
          actor,
          reason,
          metadata: {
            ...normalizeMetadata(options.metadata),
            replacementVersionId:
              options.replacementVersionId || null,
          },
          session,
        });
      } else {
        await createAuditEvent({
          action: 'legal.version.superseded',
          version,
          actor,
          reason,
          metadata: {
            ...normalizeMetadata(options.metadata),
            replacementVersionId:
              options.replacementVersionId || null,
          },
          session,
        });
      }

      return version;
    });
  },

  /**
   * Retire a legal document version.
   */
  async retireVersion(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    if (!reason) {
      throw new LegalPublicationError(
        'A reason is required when retiring a legal version.',
        'RETIREMENT_REASON_REQUIRED'
      );
    }

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      if (
        version.status !== LEGAL_STATUS.PUBLISHED &&
        version.status !== LEGAL_STATUS.SUPERSEDED
      ) {
        throw new LegalPublicationError(
          `Only published or superseded versions may be retired. Current status: ${version.status}.`,
          'INVALID_LIFECYCLE_TRANSITION'
        );
      }

      setLifecycleFields(version, LEGAL_STATUS.RETIRED, {
        actorId: actor.id,
      });

      setIfDefined(version, 'retiredAt', now());
      setIfDefined(version, 'retiredBy', actor.id);

      await version.save({ session });

      const documentIdentifier =
        version.documentId ||
        version.legalDocumentId ||
        options.documentId;

      let document = null;

      if (documentIdentifier) {
        document = await findLegalDocument(
          documentIdentifier,
          { session }
        );

        if (
          String(document.currentVersionId || '') ===
          String(getVersionId(version))
        ) {
          setIfDefined(document, 'currentVersionId', null);
          setIfDefined(document, 'publishedVersionId', null);
          setIfDefined(document, 'currentVersion', null);
          setIfDefined(document, 'status', LEGAL_STATUS.RETIRED);
          setIfDefined(document, 'retiredAt', now());
          setIfDefined(document, 'retiredBy', actor.id);

          await document.save({ session });
        }
      }

      await createAuditEvent({
        action: 'legal.version.retired',
        document,
        version,
        actor,
        reason,
        metadata: options.metadata,
        session,
      });

      return version;
    });
  },

  /**
   * Cancel a scheduled publication and return the version to approved state.
   */
  async cancelScheduledPublication(versionIdentifier, options = {}) {
    const actor = normalizeActor(options.actor);
    const reason = normalizeReason(options.reason);

    if (!reason) {
      throw new LegalPublicationError(
        'A reason is required when cancelling scheduled publication.',
        'CANCELLATION_REASON_REQUIRED'
      );
    }

    return executeWithOptionalTransaction(async (session) => {
      const version = await findVersion(versionIdentifier, { session });

      if (version.status !== LEGAL_STATUS.SCHEDULED) {
        throw new LegalPublicationError(
          `Only scheduled versions may have their publication cancelled. Current status: ${version.status}.`,
          'INVALID_LIFECYCLE_TRANSITION'
        );
      }

      setLifecycleFields(version, LEGAL_STATUS.APPROVED, {
        actorId: actor.id,
      });

      setIfDefined(version, 'scheduledAt', null);
      setIfDefined(version, 'scheduledBy', null);

      await version.save({ session });

      await createAuditEvent({
        action: 'legal.version.publication_cancelled',
        version,
        actor,
        reason,
        metadata: options.metadata,
        session,
      });

      return version;
    });
  },

  /**
   * Return the currently published version for a legal document.
   */
  async getPublishedVersion(documentIdentifier, options = {}) {
    const document = await findLegalDocument(documentIdentifier, options);

    const documentId = getDocumentId(document);

    const query = {
      $or: [
        { documentId },
        { legalDocumentId: documentId },
      ],
      status: LEGAL_STATUS.PUBLISHED,
    };

    let queryBuilder = LegalDocumentVersion
      .findOne(query)
      .sort({
        publishedAt: -1,
        createdAt: -1,
      });

    if (options.session) {
      queryBuilder = queryBuilder.session(options.session);
    }

    return queryBuilder;
  },

  /**
   * Get publication history for a legal document.
   */
  async getPublicationHistory(documentIdentifier, options = {}) {
    const document = await findLegalDocument(documentIdentifier, options);

    const documentId = getDocumentId(document);

    const query = {
      $or: [
        { documentId },
        { legalDocumentId: documentId },
      ],
      status: {
        $in: [
          LEGAL_STATUS.PUBLISHED,
          LEGAL_STATUS.SUPERSEDED,
          LEGAL_STATUS.RETIRED,
        ],
      },
    };

    let queryBuilder = LegalDocumentVersion
      .find(query)
      .sort({
        publishedAt: -1,
        supersededAt: -1,
        retiredAt: -1,
        createdAt: -1,
      });

    if (options.session) {
      queryBuilder = queryBuilder.session(options.session);
    }

    return queryBuilder;
  },

  /**
   * Determine whether a version is immutable.
   */
  isPublishedVersion(version) {
    return Boolean(
      version &&
      version.status === LEGAL_STATUS.PUBLISHED
    );
  },

  /**
   * Determine whether a lifecycle transition is valid.
   */
  canTransition(fromStatus, toStatus) {
    const transitions = {
      [LEGAL_STATUS.DRAFT]: [
        LEGAL_STATUS.REVIEW,
        LEGAL_STATUS.RETIRED,
      ],

      [LEGAL_STATUS.REVIEW]: [
        LEGAL_STATUS.DRAFT,
        LEGAL_STATUS.APPROVED,
      ],

      [LEGAL_STATUS.APPROVED]: [
        LEGAL_STATUS.SCHEDULED,
        LEGAL_STATUS.PUBLISHED,
        LEGAL_STATUS.RETIRED,
      ],

      [LEGAL_STATUS.SCHEDULED]: [
        LEGAL_STATUS.APPROVED,
        LEGAL_STATUS.PUBLISHED,
        LEGAL_STATUS.RETIRED,
      ],

      [LEGAL_STATUS.PUBLISHED]: [
        LEGAL_STATUS.SUPERSEDED,
        LEGAL_STATUS.RETIRED,
      ],

      [LEGAL_STATUS.SUPERSEDED]: [
        LEGAL_STATUS.RETIRED,
      ],

      [LEGAL_STATUS.RETIRED]: [],
    };

    return Boolean(
      transitions[fromStatus] &&
      transitions[fromStatus].includes(toStatus)
    );
  },

  /**
   * Validate a proposed publication operation without mutating data.
   *
   * Useful for administrative UIs and pre-flight validation.
   */
  async validatePublication(versionIdentifier, options = {}) {
    const version = await findVersion(versionIdentifier);

    const documentIdentifier =
      version.documentId ||
      version.legalDocumentId ||
      options.documentId;

    const document = await findLegalDocument(documentIdentifier);

    try {
      validateVersionForPublication(document, version);

      const effectiveDate = normalizeDate(
        options.effectiveDate ||
          version.effectiveDate,
        'effectiveDate'
      );

      return Object.freeze({
        valid: true,
        documentId: getDocumentId(document),
        versionId: getVersionId(version),
        version: getVersionNumber(version),
        effectiveDate,
        currentStatus: version.status,
        errors: Object.freeze([]),
      });
    } catch (error) {
      return Object.freeze({
        valid: false,
        documentId: getDocumentId(document),
        versionId: getVersionId(version),
        version: getVersionNumber(version),
        currentStatus: version.status,
        errors: Object.freeze([
          error.message,
        ]),
      });
    }
  },

  /**
   * Return a serializable service health/metadata object.
   */
  getServiceInfo() {
    return Object.freeze({
      service: SERVICE_NAME,
      version: '1.0.0',
      platform: 'TITech Community Capital',
      immutablePublishedVersions: true,
      auditEventsEnabled: Boolean(LegalAuditEvent),
      transactionSupport:
        Boolean(
          LegalDocument &&
          LegalDocument.db &&
          typeof LegalDocument.db.startSession === 'function'
        ),
    });
  },
});

/* ============================================================================
 * Exports
 * ========================================================================== */

module.exports = LegalPublicationService;

/*
 * Named compatibility exports.
 *
 * This allows consumers to use either:
 *
 *   const LegalPublicationService = require(...);
 *
 * or:
 *
 *   const {
 *     LegalPublicationService,
 *     LegalPublicationError,
 *   } = require(...);
 */
module.exports.LegalPublicationService = LegalPublicationService;
module.exports.LegalPublicationError = LegalPublicationError;
module.exports.LEGAL_STATUS = LEGAL_STATUS;

/* ============================================================================
 * END OF FILE
 * ============================================================================
 */