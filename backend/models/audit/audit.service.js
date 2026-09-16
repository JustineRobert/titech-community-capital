/**
 * backend/models/audit/audit.service.js
 * TITech Community Capital — Audit Service
 *
 * Architectural role:
 * - Application/service-layer API for creating, querying, and verifying
 *   immutable audit records.
 * - Coordinates tenant/system scope, tracing identifiers, metadata
 *   sanitization, and hash-chain verification.
 * - Delegates persistence to the canonical AuditLog model.
 *
 * Important boundaries:
 * - AuditLog.js is the canonical audit persistence model.
 * - This service does not authorize business operations.
 * - This service does not replace domain services or repositories.
 * - Ordinary audit records must not be updated or deleted.
 * - Strict concurrent hash-chain serialization belongs in the repository /
 *   transaction layer when a single globally ordered chain is required.
 *
 * Security principles:
 * - Native ESM only.
 * - Never persist secrets, passwords, tokens, cookies, or authorization
 *   credentials in audit metadata.
 * - Hashing uses deterministic canonical serialization.
 * - Tenant scope is explicit.
 * - Verification uses deterministic createdAt + _id ordering.
 *
 * Module format:
 * - Native ECMAScript Modules (ESM)
 *
 * Canonical model:
 * - backend/models/AuditLog.js
 */

import crypto from 'node:crypto';

import AuditLog from '../../models/AuditLog.js';

const GENESIS_HASH = 'GENESIS';
const HASH_ALGORITHM = 'sha256';

const SENSITIVE_KEYS = new Set([
  'password',
  'passwd',
  'passcode',
  'pin',
  'otp',
  'totp',
  'secret',
  'clientsecret',
  'client_secret',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'id_token',
  'idtoken',
  'authorization',
  'cookie',
  'set-cookie',
  'apikey',
  'api_key',
  'private_key',
  'privatekey',
]);

const MAX_METADATA_DEPTH = 6;
const MAX_METADATA_KEYS = 100;
const MAX_METADATA_ARRAY_LENGTH = 100;

function normalizeString(value) {
  if (value === undefined || value === null) {
    return undefined;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeNullableString(value) {
  const normalized = normalizeString(value);
  return normalized ?? null;
}

function normalizeDate(value) {
  if (value === undefined || value === null) {
    return new Date();
  }

  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) {
      throw new TypeError('Invalid audit timestamp.');
    }

    return value;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new TypeError('Invalid audit timestamp.');
  }

  return date;
}

function isSensitiveKey(key) {
  const normalized = String(key)
    .trim()
    .toLowerCase()
    .replace(/[\s-]/g, '');

  return (
    SENSITIVE_KEYS.has(normalized) ||
    normalized.includes('password') ||
    normalized.includes('authorization') ||
    normalized.includes('access_token') ||
    normalized.includes('refresh_token') ||
    normalized.includes('privatekey')
  );
}

function sanitizeAuditMetadata(value, depth = 0) {
  if (depth > MAX_METADATA_DEPTH) {
    return '[TRUNCATED]';
  }

  if (value === undefined || value === null) {
    return value;
  }

  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Buffer.isBuffer(value)) {
    return '[BUFFER]';
  }

  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_METADATA_ARRAY_LENGTH)
      .map((item) => sanitizeAuditMetadata(item, depth + 1));
  }

  if (typeof value === 'object') {
    const output = {};
    const entries = Object.entries(value).slice(0, MAX_METADATA_KEYS);

    for (const [key, childValue] of entries) {
      if (isSensitiveKey(key)) {
        output[key] = '[REDACTED]';
        continue;
      }

      output[key] = sanitizeAuditMetadata(childValue, depth + 1);
    }

    if (Object.keys(value).length > MAX_METADATA_KEYS) {
      output._truncatedKeys = true;
    }

    return output;
  }

  return `[UNSERIALIZABLE:${typeof value}]`;
}

/**
 * Recursively sorts object keys so logically equivalent payloads always
 * produce the same serialized representation.
 */
function canonicalizeValue(value) {
  if (value === undefined) {
    return null;
  }

  if (value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeValue(item));
  }

  if (typeof value === 'object') {
    const output = {};

    for (const key of Object.keys(value).sort()) {
      output[key] = canonicalizeValue(value[key]);
    }

    return output;
  }

  return value;
}

/**
 * Canonical hash payload.
 *
 * This structure must remain synchronized with the hashing logic in
 * backend/models/AuditLog.js.
 */
function buildCanonicalHashPayload(log, previousHash = log.prevHash) {
  return {
    _id: normalizeNullableString(log._id),
    action: normalizeString(log.action) ?? null,
    userId: normalizeNullableString(log.userId),
    tenantId: normalizeNullableString(log.tenantId),
    scope: normalizeString(log.scope) ?? null,
    entityType: normalizeNullableString(log.entityType),
    entityId: normalizeNullableString(log.entityId),
    outcome: normalizeString(log.outcome) ?? null,
    metadata: sanitizeAuditMetadata(log.metadata ?? {}),
    requestId: normalizeNullableString(log.requestId),
    correlationId: normalizeNullableString(log.correlationId),
    prevHash: normalizeNullableString(previousHash) ?? GENESIS_HASH,
    createdAt: normalizeDate(log.createdAt).toISOString(),
  };
}

function calculateHash(log, previousHash = log.prevHash) {
  const payload = canonicalizeValue(
    buildCanonicalHashPayload(log, previousHash),
  );

  return crypto
    .createHash(HASH_ALGORITHM)
    .update(JSON.stringify(payload), 'utf8')
    .digest('hex');
}

function normalizeCreateInput(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TypeError('Audit log input must be an object.');
  }

  const {
    action,
    userId,
    tenantId,
    scope = tenantId ? 'tenant' : 'system',
    entityType,
    entityId,
    outcome = 'success',
    metadata = {},
    requestId,
    correlationId,
    createdAt,
    session,
  } = input;

  const normalizedAction = normalizeString(action);

  if (!normalizedAction) {
    throw new TypeError('Audit action is required.');
  }

  const normalizedScope = normalizeString(scope);

  if (!normalizedScope) {
    throw new TypeError('Audit scope is required.');
  }

  const normalizedTenantId = normalizeNullableString(tenantId);

  if (normalizedScope === 'tenant' && !normalizedTenantId) {
    throw new TypeError(
      'tenantId is required for tenant-scoped audit records.',
    );
  }

  if (normalizedScope === 'system' && normalizedTenantId) {
    throw new TypeError(
      'System-scoped audit records must not contain tenantId.',
    );
  }

  return {
    action: normalizedAction,
    userId: normalizeNullableString(userId),
    tenantId: normalizedTenantId,
    scope: normalizedScope,
    entityType: normalizeNullableString(entityType),
    entityId: normalizeNullableString(entityId),
    outcome: normalizeString(outcome) ?? 'success',
    metadata: sanitizeAuditMetadata(metadata),
    requestId: normalizeNullableString(requestId),
    correlationId: normalizeNullableString(correlationId),
    createdAt: normalizeDate(createdAt),
    session,
  };
}

/**
 * Create an immutable audit record.
 *
 * NOTE:
 * Latest-head lookup followed by insert can race under concurrent writes.
 * A repository/database transaction should serialize chain-head allocation
 * when strict single-chain guarantees are required.
 */
export async function createAuditLog(input = {}) {
  const normalized = normalizeCreateInput(input);

  const latestFilter = {
    scope: normalized.scope,
    tenantId:
      normalized.scope === 'tenant'
        ? normalized.tenantId
        : null,
  };

  let query = AuditLog.findOne(latestFilter)
    .sort({ createdAt: -1, _id: -1 })
    .select({
      _id: 1,
      currentHash: 1,
      createdAt: 1,
    });

  if (normalized.session) {
    query = query.session(normalized.session);
  }

  const latest = await query.lean().exec();

  const prevHash = latest?.currentHash ?? GENESIS_HASH;

  const auditRecord = new AuditLog({
    action: normalized.action,
    userId: normalized.userId,
    tenantId: normalized.tenantId,
    scope: normalized.scope,
    entityType: normalized.entityType,
    entityId: normalized.entityId,
    outcome: normalized.outcome,
    metadata: normalized.metadata,
    requestId: normalized.requestId,
    correlationId: normalized.correlationId,
    prevHash,
    createdAt: normalized.createdAt,
  });

  auditRecord.currentHash = calculateHash(auditRecord, prevHash);

  if (normalized.session) {
    await auditRecord.save({ session: normalized.session });
  } else {
    await auditRecord.save();
  }

  return auditRecord;
}

/**
 * Create a system-scoped audit record.
 */
export async function createSystemAuditLog(input = {}) {
  return createAuditLog({
    ...input,
    scope: 'system',
    tenantId: undefined,
  });
}

/**
 * Create an audit record for an access-denied event.
 */
export async function createAccessDeniedAuditLog(input = {}) {
  return createAuditLog({
    ...input,
    outcome: 'denied',
    metadata: {
      ...(input.metadata ?? {}),
      accessDenied: true,
    },
  });
}

/**
 * Verify a single record against its expected previous hash.
 */
export function verifyAuditRecord(
  log,
  expectedPreviousHash = log.prevHash ?? GENESIS_HASH,
) {
  const errors = [];

  const storedPreviousHash = log.prevHash ?? GENESIS_HASH;

  if (storedPreviousHash !== expectedPreviousHash) {
    errors.push({
      id: log._id,
      issue: 'Previous hash mismatch',
      expected: expectedPreviousHash,
      found: storedPreviousHash,
    });
  }

  const recomputedHash = calculateHash(log, expectedPreviousHash);

  if (log.currentHash !== recomputedHash) {
    errors.push({
      id: log._id,
      issue: 'Hash mismatch',
      expected: recomputedHash,
      found: log.currentHash,
    });
  }

  return {
    valid: errors.length === 0,
    errors,
    expectedHash: recomputedHash,
  };
}

/**
 * Verify one tenant's complete audit chain.
 */
export async function verifyAuditChain(tenantId, options = {}) {
  const normalizedTenantId = normalizeString(tenantId);

  if (!normalizedTenantId) {
    throw new TypeError('tenantId is required.');
  }

  const {
    session,
    limit,
  } = options;

  const query = AuditLog.find({
    tenantId: normalizedTenantId,
    scope: 'tenant',
  })
    .sort({ createdAt: 1, _id: 1 })
    .select({
      _id: 1,
      action: 1,
      userId: 1,
      tenantId: 1,
      scope: 1,
      entityType: 1,
      entityId: 1,
      outcome: 1,
      metadata: 1,
      requestId: 1,
      correlationId: 1,
      prevHash: 1,
      currentHash: 1,
      createdAt: 1,
    })
    .lean();

  if (Number.isInteger(limit) && limit > 0) {
    query.limit(limit);
  }

  if (session) {
    query.session(session);
  }

  const logs = await query.exec();

  let previousHash = GENESIS_HASH;
  const errors = [];

  for (const log of logs) {
    const result = verifyAuditRecord(log, previousHash);

    if (!result.valid) {
      errors.push(...result.errors);
    }

    previousHash = log.currentHash ?? previousHash;
  }

  return {
    valid: errors.length === 0,
    tenantId: normalizedTenantId,
    recordsChecked: logs.length,
    errors,
    chainHead: logs.at(-1)?.currentHash ?? GENESIS_HASH,
  };
}

/**
 * Verify the system audit chain.
 */
export async function verifySystemAuditChain(options = {}) {
  const {
    session,
    limit,
  } = options;

  const query = AuditLog.find({
    scope: 'system',
    tenantId: null,
  })
    .sort({ createdAt: 1, _id: 1 })
    .select({
      _id: 1,
      action: 1,
      userId: 1,
      tenantId: 1,
      scope: 1,
      entityType: 1,
      entityId: 1,
      outcome: 1,
      metadata: 1,
      requestId: 1,
      correlationId: 1,
      prevHash: 1,
      currentHash: 1,
      createdAt: 1,
    })
    .lean();

  if (Number.isInteger(limit) && limit > 0) {
    query.limit(limit);
  }

  if (session) {
    query.session(session);
  }

  const logs = await query.exec();

  let previousHash = GENESIS_HASH;
  const errors = [];

  for (const log of logs) {
    const result = verifyAuditRecord(log, previousHash);

    if (!result.valid) {
      errors.push(...result.errors);
    }

    previousHash = log.currentHash ?? previousHash;
  }

  return {
    valid: errors.length === 0,
    recordsChecked: logs.length,
    errors,
    chainHead: logs.at(-1)?.currentHash ?? GENESIS_HASH,
  };
}

/**
 * Retrieve tenant audit history with deterministic pagination.
 */
export async function getTenantAuditHistory(
  tenantId,
  options = {},
) {
  const normalizedTenantId = normalizeString(tenantId);

  if (!normalizedTenantId) {
    throw new TypeError('tenantId is required.');
  }

  const {
    action,
    outcome,
    userId,
    entityType,
    entityId,
    requestId,
    correlationId,
    from,
    to,
    limit = 100,
    skip = 0,
    session,
  } = options;

  const safeLimit = Math.min(
    Math.max(Number.parseInt(limit, 10) || 100, 1),
    500,
  );

  const safeSkip = Math.max(
    Number.parseInt(skip, 10) || 0,
    0,
  );

  const filter = {
    tenantId: normalizedTenantId,
    scope: 'tenant',
  };

  if (action) {
    filter.action = normalizeString(action);
  }

  if (outcome) {
    filter.outcome = normalizeString(outcome);
  }

  if (userId) {
    filter.userId = normalizeString(userId);
  }

  if (entityType) {
    filter.entityType = normalizeString(entityType);
  }

  if (entityId) {
    filter.entityId = normalizeString(entityId);
  }

  if (requestId) {
    filter.requestId = normalizeString(requestId);
  }

  if (correlationId) {
    filter.correlationId = normalizeString(correlationId);
  }

  if (from || to) {
    filter.createdAt = {};

    if (from) {
      filter.createdAt.$gte = normalizeDate(from);
    }

    if (to) {
      filter.createdAt.$lte = normalizeDate(to);
    }
  }

  let query = AuditLog.find(filter)
    .sort({ createdAt: -1, _id: -1 })
    .skip(safeSkip)
    .limit(safeLimit)
    .lean();

  if (session) {
    query = query.session(session);
  }

  const records = await query.exec();

  return {
    records,
    pagination: {
      limit: safeLimit,
      skip: safeSkip,
      returned: records.length,
    },
  };
}

/**
 * Retrieve audit history for one entity.
 */
export async function getEntityAuditHistory(
  tenantId,
  entityType,
  entityId,
  options = {},
) {
  const normalizedTenantId = normalizeString(tenantId);
  const normalizedEntityType = normalizeString(entityType);
  const normalizedEntityId = normalizeString(entityId);

  if (!normalizedTenantId) {
    throw new TypeError('tenantId is required.');
  }

  if (!normalizedEntityType) {
    throw new TypeError('entityType is required.');
  }

  if (!normalizedEntityId) {
    throw new TypeError('entityId is required.');
  }

  return getTenantAuditHistory(normalizedTenantId, {
    ...options,
    entityType: normalizedEntityType,
    entityId: normalizedEntityId,
  });
}

export {
  buildCanonicalHashPayload,
  calculateHash,
  sanitizeAuditMetadata,
  GENESIS_HASH,
};