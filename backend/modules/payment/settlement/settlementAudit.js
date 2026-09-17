'use strict';

/**
 * TITech Community Capital
 * Enterprise Settlement Audit Service
 *
 * File:
 *   backend/modules/payment/settlement/settlementAudit.js
 *
 * Architectural Role
 * ------------------
 * Dedicated audit/provenance boundary for payment settlement operations.
 *
 * Responsibilities
 * ----------------
 * - Record settlement lifecycle and operational audit events.
 * - Capture immutable business context, actors, tenant context and provenance.
 * - Support MongoDB transaction/session participation.
 * - Provide retry-safe / idempotent audit writes.
 * - Produce tamper-evident integrity metadata for audit records.
 * - Redact secrets and sensitive values before persistence.
 * - Preserve before/after state where explicitly supplied.
 * - Support maker-checker / approval context.
 * - Support reconciliation, provider and financial-transaction references.
 * - Provide operational query helpers for investigation.
 *
 * Explicit Non-Responsibilities
 * ----------------------------
 * - Does NOT mutate balances.
 * - Does NOT post ledger entries.
 * - Does NOT mark settlements as financially settled.
 * - Does NOT initiate provider payments.
 * - Does NOT bypass domain authorization.
 * - Does NOT replace the canonical financial transaction service.
 *
 * Financial Safety Principle
 * --------------------------
 * Audit records describe financial events; they do not make those events true.
 *
 * A successful HTTP request, provider callback, queued worker event, or audit
 * write must never be interpreted as financial settlement by itself.
 *
 * Audit records should be append-only. Corrections should be represented as
 * additional events rather than destructive modification of historical audit
 * records.
 *
 * Security Principles
 * -------------------
 * - Tenant scoped.
 * - Least privilege.
 * - Secret/credential redaction.
 * - No raw authorization headers or tokens.
 * - No payment provider secrets.
 * - No unrestricted request-body persistence.
 * - Explicit purpose/context for sensitive operations.
 * - Correlation/request identifiers preserved for investigation.
 *
 * Module Format
 * -------------
 * CommonJS, compatible with the repository's current backend conventions.
 *
 * Important Integration Note
 * --------------------------
 * This service intentionally does not hard-code a SettlementAudit model.
 * Pass a model explicitly, or expose a compatible model through the repository's
 * conventional model location.
 */

const crypto = require('crypto');
const mongoose = require('mongoose');

const DEFAULT_MAX_SNAPSHOT_BYTES = 64 * 1024;
const DEFAULT_MAX_REASON_LENGTH = 2000;
const DEFAULT_MAX_STRING_LENGTH = 2000;

const AUDIT_EVENT_TYPES = Object.freeze({
  CREATED: 'SETTLEMENT_CREATED',
  INITIATED: 'SETTLEMENT_INITIATED',
  PROVIDER_ACCEPTED: 'SETTLEMENT_PROVIDER_ACCEPTED',
  CALLBACK_RECEIVED: 'SETTLEMENT_CALLBACK_RECEIVED',
  CALLBACK_VALIDATED: 'SETTLEMENT_CALLBACK_VALIDATED',
  RECONCILIATION_STARTED: 'SETTLEMENT_RECONCILIATION_STARTED',
  RECONCILED: 'SETTLEMENT_RECONCILED',
  SETTLED: 'SETTLEMENT_SETTLED',
  FAILED: 'SETTLEMENT_FAILED',
  TIMEOUT: 'SETTLEMENT_TIMEOUT',
  CANCELLED: 'SETTLEMENT_CANCELLED',
  REVERSED: 'SETTLEMENT_REVERSED',
  REFUNDED: 'SETTLEMENT_REFUNDED',
  DISPUTED: 'SETTLEMENT_DISPUTED',
  REQUIRES_RECONCILIATION: 'SETTLEMENT_REQUIRES_RECONCILIATION',
  MANUAL_REVIEW: 'SETTLEMENT_MANUAL_REVIEW',
  MANUAL_APPROVAL: 'SETTLEMENT_MANUAL_APPROVAL',
  MANUAL_REJECTION: 'SETTLEMENT_MANUAL_REJECTION',
  CORRECTED: 'SETTLEMENT_AUDIT_CORRECTION',
  SECURITY_EVENT: 'SETTLEMENT_SECURITY_EVENT'
});

const AUDIT_ACTOR_TYPES = Object.freeze({
  USER: 'USER',
  SYSTEM: 'SYSTEM',
  SERVICE: 'SERVICE',
  WORKER: 'WORKER',
  PROVIDER: 'PROVIDER',
  API_CLIENT: 'API_CLIENT',
  UNKNOWN: 'UNKNOWN'
});

const AUDIT_OUTCOMES = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  PENDING: 'PENDING',
  FAILED: 'FAILED',
  NO_OP: 'NO_OP',
  REVIEW_REQUIRED: 'REVIEW_REQUIRED'
});

const SENSITIVE_KEY_PATTERN =
  /(password|passwd|secret|token|authorization|cookie|set-cookie|api[-_]?key|private[-_]?key|access[-_]?token|refresh[-_]?token|client[-_]?secret|signature|webhook[-_]?secret|encryption[-_]?key|credential)/i;

const HIGH_RISK_VALUE_PATTERN =
  /^(bearer\s+)?[A-Za-z0-9+/=_\-.]{24,}$/i;

class SettlementAuditError extends Error {
  constructor(message, code = 'SETTLEMENT_AUDIT_ERROR', details = undefined) {
    super(message);
    this.name = 'SettlementAuditError';
    this.code = code;

    if (details !== undefined) {
      this.details = details;
    }

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, SettlementAuditError);
    }
  }
}

/**
 * Normalize values to plain serializable objects.
 *
 * @param {*} value
 * @param {object} [options]
 * @returns {*}
 */
function toSerializable(value, options = {}) {
  const {
    depth = 0,
    maxDepth = 8,
    maxStringLength = DEFAULT_MAX_STRING_LENGTH,
    seen = new WeakSet()
  } = options;

  if (value === null || value === undefined) {
    return value;
  }

  if (depth > maxDepth) {
    return '[TRUNCATED_DEPTH]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'string' && value.length > maxStringLength) {
      return `${value.slice(0, maxStringLength)}...[TRUNCATED]`;
    }

    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return `[BUFFER:${value.length}BYTES]`;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      toSerializable(item, {
        depth: depth + 1,
        maxDepth,
        maxStringLength,
        seen
      })
    );
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }

    seen.add(value);

    const output = {};

    for (const [key, item] of Object.entries(value)) {
      output[key] = toSerializable(item, {
        depth: depth + 1,
        maxDepth,
        maxStringLength,
        seen
      });
    }

    return output;
  }

  return String(value);
}

/**
 * Recursively redact secrets and known credential-bearing fields.
 *
 * @param {*} value
 * @param {object} [options]
 * @returns {*}
 */
function redactSensitive(value, options = {}) {
  const {
    depth = 0,
    maxDepth = 10,
    seen = new WeakSet()
  } = options;

  if (value === null || value === undefined) {
    return value;
  }

  if (depth > maxDepth) {
    return '[REDACTED_DEPTH]';
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    if (typeof value === 'string' && HIGH_RISK_VALUE_PATTERN.test(value)) {
      return '[REDACTED]';
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactSensitive(item, {
        depth: depth + 1,
        maxDepth,
        seen
      })
    );
  }

  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  if (typeof value === 'object') {
    if (seen.has(value)) {
      return '[CIRCULAR]';
    }

    seen.add(value);

    const output = {};

    for (const [key, item] of Object.entries(value)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
      } else {
        output[key] = redactSensitive(item, {
          depth: depth + 1,
          maxDepth,
          seen
        });
      }
    }

    return output;
  }

  return '[REDACTED]';
}

/**
 * Deep-freeze plain values before returning them from this module.
 *
 * This does not create database immutability; it protects the in-memory
 * audit payload from accidental mutation after construction.
 *
 * @param {*} value
 * @returns {*}
 */
function deepFreeze(value) {
  if (!value || typeof value !== 'object') {
    return value;
  }

  if (Object.isFrozen(value)) {
    return value;
  }

  Object.freeze(value);

  for (const child of Object.values(value)) {
    deepFreeze(child);
  }

  return value;
}

/**
 * Generate a cryptographically random audit event identifier.
 *
 * @returns {string}
 */
function createAuditEventId() {
  return `sa_${crypto.randomUUID()}`;
}

/**
 * Normalize an identifier without losing its original business representation.
 *
 * @param {*} value
 * @returns {string|undefined}
 */
function normalizeId(value) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }

  if (value instanceof mongoose.Types.ObjectId) {
    return value.toString();
  }

  return String(value);
}

/**
 * Normalize a string field.
 *
 * @param {*} value
 * @param {number} maxLength
 * @returns {string|undefined}
 */
function normalizeString(value, maxLength = DEFAULT_MAX_STRING_LENGTH) {
  if (value === null || value === undefined) {
    return undefined;
  }

  const normalized = String(value).trim();

  if (!normalized) {
    return undefined;
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength)}...[TRUNCATED]`
    : normalized;
}

/**
 * Attempt to obtain the configured logger without creating a hard dependency
 * that prevents the audit module from being loaded during bootstrap/tests.
 *
 * @returns {object}
 */
function resolveLogger() {
  const candidates = [
    '../../../utils/logger',
    '../../../utils/log',
    '../../../config/logger'
  ];

  for (const modulePath of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const resolved = require(modulePath);

      if (resolved && typeof resolved === 'object') {
        return resolved.default || resolved;
      }
    } catch (_error) {
      // Continue to the next candidate.
    }
  }

  return {
    debug() {},
    info() {},
    warn() {},
    error() {}
  };
}

/**
 * Resolve an existing SettlementAudit model without forcing one exact model
 * layout.
 *
 * @param {object|undefined} model
 * @returns {object|undefined}
 */
function resolveModel(model) {
  if (model) {
    return model;
  }

  const candidates = [
    '../../../models/SettlementAudit',
    '../../../models/settlement/SettlementAudit',
    '../../../models/payment/SettlementAudit'
  ];

  for (const modulePath of candidates) {
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      const resolved = require(modulePath);
      const candidate = resolved && (resolved.default || resolved);

      if (candidate) {
        return candidate;
      }
    } catch (_error) {
      // Try next candidate.
    }
  }

  return undefined;
}

/**
 * Validate a Mongoose session-like object.
 *
 * @param {*} session
 * @returns {object|undefined}
 */
function normalizeSession(session) {
  if (!session) {
    return undefined;
  }

  if (typeof session.withTransaction === 'function') {
    return session;
  }

  if (typeof session.startTransaction === 'function') {
    return session;
  }

  throw new SettlementAuditError(
    'Invalid MongoDB session supplied to settlement audit service.',
    'INVALID_SESSION'
  );
}

/**
 * Ensure a value does not exceed the configured snapshot size.
 *
 * @param {*} value
 * @param {number} maxBytes
 * @returns {*}
 */
function limitSnapshotSize(value, maxBytes) {
  if (value === undefined) {
    return undefined;
  }

  const json = JSON.stringify(value);

  if (Buffer.byteLength(json, 'utf8') <= maxBytes) {
    return value;
  }

  return {
    _truncated: true,
    _reason: 'AUDIT_SNAPSHOT_SIZE_LIMIT',
    _sha256: crypto.createHash('sha256').update(json).digest('hex'),
    _originalBytes: Buffer.byteLength(json, 'utf8'),
    _maxBytes: maxBytes
  };
}

/**
 * Normalize the actor context.
 *
 * @param {object} [actor]
 * @returns {object}
 */
function normalizeActor(actor = {}) {
  return {
    type:
      Object.values(AUDIT_ACTOR_TYPES).includes(actor.type)
        ? actor.type
        : AUDIT_ACTOR_TYPES.UNKNOWN,
    actorId: normalizeId(actor.actorId || actor.userId || actor.id),
    username: normalizeString(actor.username, 256),
    serviceName: normalizeString(actor.serviceName, 256),
    clientId: normalizeString(actor.clientId, 256),
    role: normalizeString(actor.role, 256),
    ipAddress: normalizeString(actor.ipAddress, 128),
    userAgent: normalizeString(actor.userAgent, 1000),
    sessionId: normalizeString(actor.sessionId, 256),
    deviceId: normalizeString(actor.deviceId, 256)
  };
}

/**
 * Normalize approval context.
 *
 * @param {object} [approval]
 * @returns {object|undefined}
 */
function normalizeApproval(approval) {
  if (!approval) {
    return undefined;
  }

  return {
    required: Boolean(approval.required),
    status: normalizeString(approval.status, 128),
    makerId: normalizeId(approval.makerId),
    checkerId: normalizeId(approval.checkerId),
    approvedAt: approval.approvedAt
      ? new Date(approval.approvedAt)
      : undefined,
    rejectedAt: approval.rejectedAt
      ? new Date(approval.rejectedAt)
      : undefined,
    reason: normalizeString(approval.reason, DEFAULT_MAX_REASON_LENGTH),
    policyVersion: normalizeString(approval.policyVersion, 256),
    workflowId: normalizeId(approval.workflowId)
  };
}

/**
 * Build canonical request/provenance context.
 *
 * @param {object} [context]
 * @returns {object}
 */
function normalizeContext(context = {}) {
  return {
    requestId: normalizeString(context.requestId, 256),
    correlationId: normalizeString(context.correlationId, 256),
    traceId: normalizeString(context.traceId, 256),
    spanId: normalizeString(context.spanId, 256),
    source: normalizeString(context.source, 256),
    operation: normalizeString(context.operation, 256),
    purpose: normalizeString(context.purpose, DEFAULT_MAX_REASON_LENGTH),
    environment: normalizeString(
      context.environment || process.env.NODE_ENV,
      128
    ),
    ipAddress: normalizeString(context.ipAddress, 128),
    userAgent: normalizeString(context.userAgent, 1000)
  };
}

/**
 * Create a deterministic canonical representation for hashing.
 *
 * Object keys are sorted recursively so logically identical payloads produce
 * the same digest.
 *
 * @param {*} value
 * @returns {*}
 */
function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  if (value && typeof value === 'object') {
    const output = {};

    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalize(value[key]);
    }

    return output;
  }

  return value;
}

/**
 * Calculate an integrity hash from the immutable event fields.
 *
 * @param {object} event
 * @returns {string}
 */
function calculateIntegrityHash(event) {
  const canonicalPayload = canonicalize(event);

  return crypto
    .createHash('sha256')
    .update(JSON.stringify(canonicalPayload))
    .digest('hex');
}

/**
 * Build an audit chain hash from the previous event hash and current payload.
 *
 * This provides tamper-evident sequencing when callers provide the previous
 * hash. It is not a replacement for database-level append-only controls,
 * access controls, backups, or independent audit storage.
 *
 * @param {string|undefined} previousHash
 * @param {object} event
 * @returns {string}
 */
function calculateChainHash(previousHash, event) {
  return crypto
    .createHash('sha256')
    .update(
      `${previousHash || ''}:${calculateIntegrityHash(event)}`
    )
    .digest('hex');
}

/**
 * Construct a canonical audit document.
 *
 * @param {object} input
 * @returns {object}
 */
function buildAuditDocument(input) {
  const {
    tenantId,
    eventType,
    outcome,
    severity,
    actor,
    context,
    settlementId,
    settlementReference,
    financialTransactionId,
    financialTransactionReference,
    provider,
    providerTransactionId,
    paymentId,
    paymentReference,
    reconciliationId,
    reconciliationReference,
    transactionAmount,
    currency,
    sourceStatus,
    targetStatus,
    reason,
    error,
    before,
    after,
    metadata,
    approval,
    idempotencyKey,
    previousAuditHash,
    auditEventId,
    occurredAt,
    maxSnapshotBytes
  } = input;

  if (!tenantId) {
    throw new SettlementAuditError(
      'tenantId is required for settlement audit records.',
      'TENANT_ID_REQUIRED'
    );
  }

  if (!eventType) {
    throw new SettlementAuditError(
      'eventType is required for settlement audit records.',
      'EVENT_TYPE_REQUIRED'
    );
  }

  const safeBefore = limitSnapshotSize(
    redactSensitive(toSerializable(before)),
    maxSnapshotBytes
  );

  const safeAfter = limitSnapshotSize(
    redactSensitive(toSerializable(after)),
    maxSnapshotBytes
  );

  const safeMetadata = limitSnapshotSize(
    redactSensitive(toSerializable(metadata || {})),
    maxSnapshotBytes
  );

  const safeError = error
    ? {
        code: normalizeString(error.code, 256),
        type: normalizeString(error.type, 256),
        message: normalizeString(error.message, DEFAULT_MAX_REASON_LENGTH),
        providerCode: normalizeString(error.providerCode, 256),
        retryable:
          typeof error.retryable === 'boolean'
            ? error.retryable
            : undefined
      }
    : undefined;

  const baseEvent = {
    auditEventId: auditEventId || createAuditEventId(),
    tenantId: normalizeId(tenantId),
    eventType: normalizeString(eventType, 128),
    outcome: normalizeString(
      outcome || AUDIT_OUTCOMES.ACCEPTED,
      128
    ),
    severity: normalizeString(severity || 'INFO', 64),
    occurredAt: occurredAt ? new Date(occurredAt) : new Date(),

    actor: normalizeActor(actor),
    context: normalizeContext(context),

    settlementId: normalizeId(settlementId),
    settlementReference: normalizeString(settlementReference, 256),

    financialTransactionId: normalizeId(financialTransactionId),
    financialTransactionReference: normalizeString(
      financialTransactionReference,
      256
    ),

    paymentId: normalizeId(paymentId),
    paymentReference: normalizeString(paymentReference, 256),

    provider: normalizeString(provider, 128),
    providerTransactionId: normalizeString(providerTransactionId, 256),

    reconciliationId: normalizeId(reconciliationId),
    reconciliationReference: normalizeString(
      reconciliationReference,
      256
    ),

    transactionAmount:
      transactionAmount === undefined || transactionAmount === null
        ? undefined
        : String(transactionAmount),

    currency: normalizeString(currency, 16),

    sourceStatus: normalizeString(sourceStatus, 128),
    targetStatus: normalizeString(targetStatus, 128),

    reason: normalizeString(reason, DEFAULT_MAX_REASON_LENGTH),
    error: safeError,

    before: safeBefore,
    after: safeAfter,

    metadata: safeMetadata,

    approval: normalizeApproval(approval),

    idempotencyKey: normalizeString(idempotencyKey, 256),

    previousAuditHash: normalizeString(previousAuditHash, 128)
  };

  /*
   * Remove undefined values to avoid accidental persistence of sparse
   * properties when the underlying schema is strict.
   */
  for (const [key, value] of Object.entries(baseEvent)) {
    if (value === undefined) {
      delete baseEvent[key];
    }
  }

  const integrityHash = calculateIntegrityHash(baseEvent);
  const chainHash = calculateChainHash(
    previousAuditHash,
    baseEvent
  );

  baseEvent.integrity = {
    algorithm: 'SHA-256',
    hash: integrityHash,
    chainHash,
    version: 1
  };

  return deepFreeze(baseEvent);
}

/**
 * Safely extract a result from different Mongoose write APIs.
 *
 * @param {*} result
 * @returns {object}
 */
function normalizeWriteResult(result) {
  if (!result) {
    return {
      acknowledged: true
    };
  }

  if (result.value) {
    return result.value;
  }

  if (result.doc) {
    return result.doc;
  }

  if (result._id || result.auditEventId) {
    return result;
  }

  return {
    acknowledged:
      result.acknowledged !== undefined
        ? result.acknowledged
        : true,
    result
  };
}

/**
 * Determine whether an error represents duplicate-key/idempotency conflict.
 *
 * @param {*} error
 * @returns {boolean}
 */
function isDuplicateKeyError(error) {
  return Boolean(
    error &&
      (error.code === 11000 ||
        error.code === 11001 ||
        /duplicate key/i.test(String(error.message || '')))
  );
}

/**
 * Settlement audit service factory.
 *
 * @param {object} [options]
 * @returns {object}
 */
function createSettlementAudit(options = {}) {
  const logger = options.logger || resolveLogger();
  const AuditModel = resolveModel(options.model);
  const maxSnapshotBytes =
    Number.isFinite(options.maxSnapshotBytes) &&
    options.maxSnapshotBytes > 0
      ? options.maxSnapshotBytes
      : DEFAULT_MAX_SNAPSHOT_BYTES;

  /**
   * Get the configured audit model.
   *
   * @returns {object}
   */
  function getModel() {
    if (!AuditModel) {
      throw new SettlementAuditError(
        'Settlement audit model is not configured. Pass { model } to createSettlementAudit().',
        'AUDIT_MODEL_NOT_CONFIGURED'
      );
    }

    return AuditModel;
  }

  /**
   * Persist one immutable settlement audit event.
   *
   * The preferred integration path is to call this inside the same MongoDB
   * session/transaction as the corresponding financial operation.
   *
   * @param {object} input
   * @param {object} [optionsArg]
   * @returns {Promise<object>}
   */
  async function record(input, optionsArg = {}) {
    const {
      session,
      allowDuplicateReturn = true,
      enforceIdempotency = true,
      throwOnFailure = true
    } = optionsArg;

    const normalizedSession = normalizeSession(session);
    const model = getModel();

    const auditDocument = buildAuditDocument({
      ...input,
      maxSnapshotBytes
    });

    try {
      /*
       * Idempotency strategy:
       * - Prefer an explicit idempotencyKey when supplied.
       * - auditEventId is always unique.
       * - A unique compound index should be created at the schema/database
       *   layer for tenantId + idempotencyKey where the field is present.
       */
      if (enforceIdempotency && auditDocument.idempotencyKey) {
        const idempotencyFilter = {
          tenantId: auditDocument.tenantId,
          idempotencyKey: auditDocument.idempotencyKey
        };

        let existing;

        if (typeof model.findOne === 'function') {
          const query = model.findOne(idempotencyFilter);

          existing =
            normalizedSession && typeof query.session === 'function'
              ? await query.session(normalizedSession).lean?.() ||
                await query.session(normalizedSession)
              : await query;
        }

        if (existing) {
          if (existing.eventType !== auditDocument.eventType) {
            throw new SettlementAuditError(
              'Conflicting reuse of settlement audit idempotency key.',
              'AUDIT_IDEMPOTENCY_CONFLICT',
              {
                tenantId: auditDocument.tenantId,
                idempotencyKey: auditDocument.idempotencyKey,
                existingEventType: existing.eventType,
                incomingEventType: auditDocument.eventType
              }
            );
          }

          return {
            created: false,
            duplicate: true,
            idempotent: true,
            document: existing
          };
        }
      }

      let created;

      if (typeof model.create === 'function') {
        const result = await model.create(
          [auditDocument],
          normalizedSession
            ? { session: normalizedSession }
            : undefined
        );

        created = Array.isArray(result) ? result[0] : result;
      } else if (typeof model.insertOne === 'function') {
        const result = await model.insertOne(auditDocument, {
          session: normalizedSession
        });

        created = normalizeWriteResult(result);
      } else if (typeof model.collection === 'object') {
        const result = await model.collection.insertOne(
          auditDocument,
          normalizedSession
            ? { session: normalizedSession }
            : undefined
        );

        created = {
          ...auditDocument,
          _id: result.insertedId
        };
      } else {
        throw new SettlementAuditError(
          'Configured settlement audit model does not support persistence.',
          'AUDIT_MODEL_UNSUPPORTED'
        );
      }

      logger.info?.(
        {
          eventType: auditDocument.eventType,
          tenantId: auditDocument.tenantId,
          auditEventId: auditDocument.auditEventId,
          settlementId: auditDocument.settlementId,
          correlationId: auditDocument.context?.correlationId,
          outcome: auditDocument.outcome
        },
        'Settlement audit event recorded'
      );

      return {
        created: true,
        duplicate: false,
        idempotent: false,
        document: created
      };
    } catch (error) {
      if (
        allowDuplicateReturn &&
        enforceIdempotency &&
        auditDocument.idempotencyKey &&
        isDuplicateKeyError(error)
      ) {
        try {
          const query = model.findOne({
            tenantId: auditDocument.tenantId,
            idempotencyKey: auditDocument.idempotencyKey
          });

          const existing =
            normalizedSession && typeof query.session === 'function'
              ? await query.session(normalizedSession)
              : await query;

          if (existing) {
            return {
              created: false,
              duplicate: true,
              idempotent: true,
              document: existing
            };
          }
        } catch (lookupError) {
          logger.error?.(
            {
              err: lookupError,
              tenantId: auditDocument.tenantId,
              auditEventId: auditDocument.auditEventId
            },
            'Failed to recover duplicate settlement audit event'
          );
        }
      }

      logger.error?.(
        {
          err: error,
          tenantId: auditDocument.tenantId,
          auditEventId: auditDocument.auditEventId,
          eventType: auditDocument.eventType,
          settlementId: auditDocument.settlementId,
          correlationId: auditDocument.context?.correlationId
        },
        'Settlement audit persistence failed'
      );

      if (!throwOnFailure) {
        return {
          created: false,
          duplicate: false,
          idempotent: false,
          persisted: false,
          error: {
            code: error.code || 'AUDIT_PERSISTENCE_FAILED',
            message: error.message
          }
        };
      }

      if (error instanceof SettlementAuditError) {
        throw error;
      }

      throw new SettlementAuditError(
        'Failed to persist settlement audit event.',
        'AUDIT_PERSISTENCE_FAILED',
        {
          causeCode: error.code
        }
      );
    }
  }

  /**
   * Record a settlement lifecycle event.
   *
   * @param {string} eventType
   * @param {object} input
   * @param {object} [optionsArg]
   * @returns {Promise<object>}
   */
  async function recordEvent(eventType, input, optionsArg) {
    return record(
      {
        ...input,
        eventType
      },
      optionsArg
    );
  }

  /**
   * Record settlement creation.
   */
  async function recordCreated(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.CREATED, input, optionsArg);
  }

  /**
   * Record settlement initiation.
   */
  async function recordInitiated(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.INITIATED, input, optionsArg);
  }

  /**
   * Record provider acceptance.
   */
  async function recordProviderAccepted(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.PROVIDER_ACCEPTED,
      input,
      optionsArg
    );
  }

  /**
   * Record a provider callback receipt.
   */
  async function recordCallbackReceived(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.CALLBACK_RECEIVED,
      input,
      optionsArg
    );
  }

  /**
   * Record callback validation.
   */
  async function recordCallbackValidated(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.CALLBACK_VALIDATED,
      input,
      optionsArg
    );
  }

  /**
   * Record reconciliation start.
   */
  async function recordReconciliationStarted(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.RECONCILIATION_STARTED,
      input,
      optionsArg
    );
  }

  /**
   * Record successful reconciliation.
   */
  async function recordReconciled(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.RECONCILED,
      input,
      optionsArg
    );
  }

  /**
   * Record final settlement.
   *
   * IMPORTANT:
   * This only records the audit event. The caller remains responsible for
   * establishing that the settlement was actually confirmed by the financial
   * domain service and reconciliation workflow.
   */
  async function recordSettled(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.SETTLED, input, optionsArg);
  }

  /**
   * Record failure.
   */
  async function recordFailed(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.FAILED, input, optionsArg);
  }

  /**
   * Record timeout.
   */
  async function recordTimeout(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.TIMEOUT, input, optionsArg);
  }

  /**
   * Record cancellation.
   */
  async function recordCancelled(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.CANCELLED, input, optionsArg);
  }

  /**
   * Record reversal.
   */
  async function recordReversed(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.REVERSED, input, optionsArg);
  }

  /**
   * Record refund.
   */
  async function recordRefunded(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.REFUNDED, input, optionsArg);
  }

  /**
   * Record dispute.
   */
  async function recordDisputed(input, optionsArg) {
    return recordEvent(AUDIT_EVENT_TYPES.DISPUTED, input, optionsArg);
  }

  /**
   * Record a reconciliation exception.
   */
  async function recordRequiresReconciliation(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.REQUIRES_RECONCILIATION,
      {
        ...input,
        outcome:
          input.outcome || AUDIT_OUTCOMES.REVIEW_REQUIRED
      },
      optionsArg
    );
  }

  /**
   * Record a manual-review action.
   */
  async function recordManualReview(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.MANUAL_REVIEW,
      {
        ...input,
        outcome:
          input.outcome || AUDIT_OUTCOMES.REVIEW_REQUIRED
      },
      optionsArg
    );
  }

  /**
   * Record a maker-checker approval.
   */
  async function recordManualApproval(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.MANUAL_APPROVAL,
      {
        ...input,
        outcome: input.outcome || AUDIT_OUTCOMES.ACCEPTED
      },
      optionsArg
    );
  }

  /**
   * Record a maker-checker rejection.
   */
  async function recordManualRejection(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.MANUAL_REJECTION,
      {
        ...input,
        outcome: input.outcome || AUDIT_OUTCOMES.REJECTED
      },
      optionsArg
    );
  }

  /**
   * Record a security-related settlement audit event.
   */
  async function recordSecurityEvent(input, optionsArg) {
    return recordEvent(
      AUDIT_EVENT_TYPES.SECURITY_EVENT,
      {
        ...input,
        severity: input.severity || 'HIGH'
      },
      optionsArg
    );
  }

  /**
   * Verify a stored audit document's integrity hash.
   *
   * @param {object} document
   * @returns {object}
   */
  function verifyIntegrity(document) {
    if (!document || typeof document !== 'object') {
      throw new SettlementAuditError(
        'Audit document is required for integrity verification.',
        'AUDIT_DOCUMENT_REQUIRED'
      );
    }

    const {
      integrity,
      ...eventWithoutIntegrity
    } = toSerializable(document);

    if (!integrity || !integrity.hash) {
      return {
        valid: false,
        reason: 'INTEGRITY_METADATA_MISSING'
      };
    }

    const calculated = calculateIntegrityHash(
      eventWithoutIntegrity
    );

    return {
      valid: crypto.timingSafeEqual(
        Buffer.from(String(integrity.hash)),
        Buffer.from(String(calculated))
      ),
      algorithm: integrity.algorithm || 'SHA-256',
      expected: integrity.hash,
      calculated
    };
  }

  /**
   * Find an audit event by its immutable auditEventId.
   *
   * @param {string} tenantId
   * @param {string} auditEventId
   * @param {object} [optionsArg]
   * @returns {Promise<object|null>}
   */
  async function findByEventId(tenantId, auditEventId, optionsArg = {}) {
    const model = getModel();

    const filter = {
      tenantId: normalizeId(tenantId),
      auditEventId: normalizeId(auditEventId)
    };

    const query = model.findOne(filter);

    if (optionsArg.session && typeof query.session === 'function') {
      query.session(normalizeSession(optionsArg.session));
    }

    if (typeof query.lean === 'function') {
      return query.lean();
    }

    return query;
  }

  /**
   * Query settlement history for operations/audit investigations.
   *
   * This function intentionally requires tenantId.
   *
   * @param {object} filters
   * @param {object} [optionsArg]
   * @returns {Promise<object[]>}
   */
  async function query(filters, optionsArg = {}) {
    const model = getModel();

    if (!filters || !filters.tenantId) {
      throw new SettlementAuditError(
        'tenantId is required for settlement audit queries.',
        'TENANT_ID_REQUIRED'
      );
    }

    const limit = Math.min(
      Math.max(Number(optionsArg.limit) || 100, 1),
      500
    );

    const sort = optionsArg.sort || {
      occurredAt: -1,
      _id: -1
    };

    const filter = {
      tenantId: normalizeId(filters.tenantId)
    };

    const equalityFields = [
      'settlementId',
      'settlementReference',
      'paymentId',
      'paymentReference',
      'financialTransactionId',
      'financialTransactionReference',
      'providerTransactionId',
      'reconciliationId',
      'reconciliationReference',
      'eventType',
      'outcome',
      'provider'
    ];

    for (const field of equalityFields) {
      if (
        filters[field] !== undefined &&
        filters[field] !== null &&
        filters[field] !== ''
      ) {
        filter[field] = normalizeId(filters[field]);
      }
    }

    if (filters.from || filters.to) {
      filter.occurredAt = {};

      if (filters.from) {
        filter.occurredAt.$gte = new Date(filters.from);
      }

      if (filters.to) {
        filter.occurredAt.$lte = new Date(filters.to);
      }
    }

    const queryBuilder = model
      .find(filter)
      .sort(sort)
      .limit(limit);

    if (optionsArg.select && typeof queryBuilder.select === 'function') {
      queryBuilder.select(optionsArg.select);
    }

    if (optionsArg.session && typeof queryBuilder.session === 'function') {
      queryBuilder.session(normalizeSession(optionsArg.session));
    }

    if (typeof queryBuilder.lean === 'function') {
      return queryBuilder.lean();
    }

    return queryBuilder;
  }

  /**
   * Build the minimum expected indexes for the audit collection.
   *
   * This helper returns index definitions rather than silently mutating the
   * database during application runtime.
   *
   * Recommended schema indexes:
   *
   * - { tenantId: 1, occurredAt: -1 }
   * - { tenantId: 1, settlementId: 1, occurredAt: -1 }
   * - { tenantId: 1, idempotencyKey: 1 } unique/sparse
   * - { tenantId: 1, reconciliationId: 1, occurredAt: -1 }
   * - { tenantId: 1, providerTransactionId: 1, occurredAt: -1 }
   * - { tenantId: 1, auditEventId: 1 } unique
   *
   * @returns {object[]}
   */
  function recommendedIndexes() {
    return [
      {
        key: { tenantId: 1, auditEventId: 1 },
        options: { unique: true }
      },
      {
        key: { tenantId: 1, occurredAt: -1 },
        options: {}
      },
      {
        key: {
          tenantId: 1,
          settlementId: 1,
          occurredAt: -1
        },
        options: {}
      },
      {
        key: {
          tenantId: 1,
          reconciliationId: 1,
          occurredAt: -1
        },
        options: {}
      },
      {
        key: {
          tenantId: 1,
          providerTransactionId: 1,
          occurredAt: -1
        },
        options: {}
      },
      {
        key: {
          tenantId: 1,
          idempotencyKey: 1
        },
        options: {
          unique: true,
          sparse: true
        }
      }
    ];
  }

  /**
   * Public service metadata.
   */
  const service = {
    name: 'SettlementAuditService',
    version: '1.0.0',
    eventTypes: AUDIT_EVENT_TYPES,
    actorTypes: AUDIT_ACTOR_TYPES,
    outcomes: AUDIT_OUTCOMES,

    record,
    recordEvent,

    recordCreated,
    recordInitiated,
    recordProviderAccepted,
    recordCallbackReceived,
    recordCallbackValidated,
    recordReconciliationStarted,
    recordReconciled,
    recordSettled,
    recordFailed,
    recordTimeout,
    recordCancelled,
    recordReversed,
    recordRefunded,
    recordDisputed,
    recordRequiresReconciliation,
    recordManualReview,
    recordManualApproval,
    recordManualRejection,
    recordSecurityEvent,

    findByEventId,
    query,

    buildAuditDocument,
    verifyIntegrity,
    recommendedIndexes
  };

  return Object.freeze(service);
}

/*
 * Default singleton.
 *
 * This preserves a simple:
 *
 *   const settlementAudit = require('./settlementAudit');
 *
 * integration path while still allowing dependency injection in tests:
 *
 *   const service = settlementAudit.create({ model: FakeModel });
 */
const defaultService = createSettlementAudit();

module.exports = defaultService;
module.exports.create = createSettlementAudit;
module.exports.createSettlementAudit = createSettlementAudit;
module.exports.SettlementAuditError = SettlementAuditError;
module.exports.AUDIT_EVENT_TYPES = AUDIT_EVENT_TYPES;
module.exports.AUDIT_ACTOR_TYPES = AUDIT_ACTOR_TYPES;
module.exports.AUDIT_OUTCOMES = AUDIT_OUTCOMES;
module.exports.buildAuditDocument = buildAuditDocument;
module.exports.verifyIntegrity = (document) =>
  defaultService.verifyIntegrity(document);