/**
 * TITech Community Capital
 * File: backend/modules/payment/airtel/intelligence/governance/decisionAuditLedger.js
 *
 * Architectural role
 * ------------------
 * Append-only, tenant-scoped, tamper-evident audit ledger for Airtel payment
 * intelligence and governance decisions.
 *
 * This module records the evidence trail around a decision: who/what produced
 * it, which policy/model versions were involved, what outcome was reached,
 * which approval or escalation path was followed, and what integrity chain the
 * record belongs to.
 *
 * Important boundaries / non-responsibilities
 * --------------------------------------------
 * - NOT the financial source of truth.
 * - NOT the canonical double-entry accounting ledger.
 * - NOT a payment settlement service.
 * - NOT an authorization or RBAC engine.
 * - NOT an AML/KYC decision engine.
 * - NOT a replacement for an outbox or durable event bus.
 * - NOT a guarantee of immutability when the underlying persistence layer can
 *   be modified by privileged operators. The hash chain makes undetected
 *   tampering materially harder and verifiable; production deployments should
 *   protect audit heads/backups with independent controls.
 *
 * Production principles
 * ---------------------
 * - Tenant context is mandatory and is part of the integrity boundary.
 * - Audit entries are append-only; existing entries are never updated by this
 *   service.
 * - Idempotency is scoped by tenant + idempotency key.
 * - Payloads are canonically serialized before hashing so equivalent objects
 *   produce deterministic fingerprints.
 * - Sensitive values are redacted or deterministically hashed before storage.
 * - The service records server time separately from producer/event time.
 * - Concurrent writers use compare-and-swap semantics at the store boundary.
 * - Verification detects chain breaks, sequence gaps, payload mutations and
 *   idempotency conflicts.
 * - The persistence adapter is injected so the same governance contract can be
 *   backed by MongoDB, PostgreSQL, an immutable audit service, or a test store.
 *
 * Module format
 * -------------
 * Native ESM. No framework-specific imports are required.
 */

import crypto from 'node:crypto';

const MODULE_NAME = 'titech.airtel.intelligence.governance.decisionAuditLedger';
const MODULE_VERSION = '1.0.0';
const SCHEMA_VERSION = 1;
const PROVIDER_CODE = 'AIRTEL';
const HASH_ALGORITHM = 'sha256';
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;
const DEFAULT_MAX_DECISION_ID_LENGTH = 160;
const DEFAULT_MAX_TENANT_ID_LENGTH = 160;
const DEFAULT_MAX_EVENT_TYPE_LENGTH = 120;
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 1000;
const DEFAULT_MAX_CHAIN_RETRIES = 5;
const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_STRING_MAX_LENGTH = 4096;

const TERMINAL_EVENTS = new Set([
  'DECISION_EXECUTED',
  'DECISION_REJECTED',
  'DECISION_FAILED',
  'DECISION_CANCELLED',
  'DECISION_REVERSED',
]);

const EVENT_TYPE_PATTERN = /^[A-Z0-9][A-Z0-9._:-]{0,119}$/;

const SENSITIVE_EXACT_KEYS = new Set([
  'password',
  'passphrase',
  'pin',
  'otp',
  'cvv',
  'cvc',
  'authorization',
  'accessToken',
  'refreshToken',
  'idToken',
  'token',
  'secret',
  'clientSecret',
  'privateKey',
  'apiKey',
  'webhookSecret',
  'encryptionKey',
  'signingKey',
]);

const HASH_IDENTIFIER_KEYS = new Set([
  'phone',
  'phoneNumber',
  'msisdn',
  'accountNumber',
  'bankAccount',
  'walletNumber',
  'customerNumber',
  'nationalId',
  'nin',
  'email',
  'ip',
  'ipAddress',
  'deviceId',
]);

const SKIP_OBJECT_KEYS = new Set([
  '__proto__',
  'prototype',
  'constructor',
]);

export const DecisionAuditLedgerEvents = Object.freeze({
  DECISION_RECEIVED: 'DECISION_RECEIVED',
  FEATURES_SNAPSHOT_CREATED: 'FEATURES_SNAPSHOT_CREATED',
  PREDICTION_GENERATED: 'PREDICTION_GENERATED',
  POLICY_EVALUATED: 'POLICY_EVALUATED',
  APPROVAL_REQUESTED: 'APPROVAL_REQUESTED',
  APPROVAL_GRANTED: 'APPROVAL_GRANTED',
  APPROVAL_REJECTED: 'APPROVAL_REJECTED',
  HUMAN_REVIEW_REQUESTED: 'HUMAN_REVIEW_REQUESTED',
  DECISION_ESCALATED: 'DECISION_ESCALATED',
  DECISION_EXECUTED: 'DECISION_EXECUTED',
  DECISION_REJECTED: 'DECISION_REJECTED',
  DECISION_FAILED: 'DECISION_FAILED',
  DECISION_CANCELLED: 'DECISION_CANCELLED',
  DECISION_REVERSED: 'DECISION_REVERSED',
  DECISION_SUPERSEDED: 'DECISION_SUPERSEDED',
  OVERRIDE_RECORDED: 'OVERRIDE_RECORDED',
  GOVERNANCE_EXCEPTION_RECORDED: 'GOVERNANCE_EXCEPTION_RECORDED',
});

export const DecisionAuditLedgerErrors = Object.freeze({
  CONFIGURATION_ERROR: 'DECISION_AUDIT_LEDGER_CONFIGURATION_ERROR',
  VALIDATION_ERROR: 'DECISION_AUDIT_LEDGER_VALIDATION_ERROR',
  IDEMPOTENCY_CONFLICT: 'DECISION_AUDIT_LEDGER_IDEMPOTENCY_CONFLICT',
  CHAIN_CONFLICT: 'DECISION_AUDIT_LEDGER_CHAIN_CONFLICT',
  INTEGRITY_FAILURE: 'DECISION_AUDIT_LEDGER_INTEGRITY_FAILURE',
  NOT_FOUND: 'DECISION_AUDIT_LEDGER_NOT_FOUND',
  PAYLOAD_TOO_LARGE: 'DECISION_AUDIT_LEDGER_PAYLOAD_TOO_LARGE',
  STORE_ERROR: 'DECISION_AUDIT_LEDGER_STORE_ERROR',
});

export class DecisionAuditLedgerError extends Error {
  constructor(
    message,
    code = DecisionAuditLedgerErrors.VALIDATION_ERROR,
    details = undefined,
    options = {},
  ) {
    super(message, options);
    this.name = 'DecisionAuditLedgerError';
    this.code = code;
    this.details = details;
    this.expose = Boolean(options.expose);
    Error.captureStackTrace?.(this, DecisionAuditLedgerError);
  }
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;

  const proto = Object.getPrototypeOf(value);

  return proto === Object.prototype || proto === null;
}

function asString(
  value,
  fieldName,
  {
    required = false,
    maxLength = DEFAULT_STRING_MAX_LENGTH,
  } = {},
) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new DecisionAuditLedgerError(`${fieldName} is required.`);
    }

    return undefined;
  }

  let result;

  if (typeof value === 'string') {
    result = value;
  } else if (typeof value === 'number' || typeof value === 'bigint') {
    result = String(value);
  } else if (
    typeof value?.toString === 'function'
    && value.toString !== Object.prototype.toString
  ) {
    result = value.toString();
  } else {
    throw new DecisionAuditLedgerError(
      `${fieldName} must be a string-compatible value.`,
    );
  }

  result = result.trim();

  if (!result && required) {
    throw new DecisionAuditLedgerError(`${fieldName} is required.`);
  }

  if (result.length > maxLength) {
    throw new DecisionAuditLedgerError(
      `${fieldName} exceeds the maximum length of ${maxLength}.`,
    );
  }

  return result || undefined;
}

function parseDate(value, fieldName, { required = false } = {}) {
  if (value === undefined || value === null || value === '') {
    if (required) {
      throw new DecisionAuditLedgerError(
        `${fieldName} is required.`,
      );
    }

    return undefined;
  }

  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new DecisionAuditLedgerError(
      `${fieldName} must be a valid date/time.`,
    );
  }

  return date;
}

function cloneValue(value, seen = new WeakMap()) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime());
  }

  if (Buffer.isBuffer(value)) {
    return Buffer.from(value);
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value);
  }

  if (seen.has(value)) {
    throw new DecisionAuditLedgerError(
      'Circular structures are not permitted in audit data.',
    );
  }

  seen.set(value, true);

  if (Array.isArray(value)) {
    const result = value.map((item) => cloneValue(item, seen));
    seen.delete(value);
    return result;
  }

  if (typeof value.toJSON === 'function' && !isPlainObject(value)) {
    const jsonValue = value.toJSON();

    seen.delete(value);

    return cloneValue(jsonValue, seen);
  }

  const result = Object.create(null);

  for (const [key, item] of Object.entries(value)) {
    if (SKIP_OBJECT_KEYS.has(key)) continue;

    result[key] = cloneValue(item, seen);
  }

  seen.delete(value);

  return result;
}

function stableNormalize(value, seen = new WeakMap()) {
  if (value === null) {
    return null;
  }

  const valueType = typeof value;

  if (valueType === 'string' || valueType === 'boolean') {
    return value;
  }

  if (valueType === 'number') {
    if (!Number.isFinite(value)) {
      return String(value);
    }

    if (Object.is(value, -0)) {
      return 0;
    }

    return value;
  }

  if (valueType === 'bigint') {
    return `${value.toString()}n`;
  }

  if (valueType === 'undefined') {
    return null;
  }

  if (valueType === 'function' || valueType === 'symbol') {
    return undefined;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`;
  }

  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }

  if (seen.has(value)) {
    throw new DecisionAuditLedgerError(
      'Circular structures are not permitted in canonical audit data.',
    );
  }

  seen.set(value, true);

  if (Array.isArray(value)) {
    const result = value.map((item) => stableNormalize(item, seen));

    seen.delete(value);

    return result;
  }

  if (typeof value.toJSON === 'function' && !isPlainObject(value)) {
    const normalizedJson = stableNormalize(value.toJSON(), seen);

    seen.delete(value);

    return normalizedJson;
  }

  const result = Object.create(null);

  for (const key of Object.keys(value).sort()) {
    if (SKIP_OBJECT_KEYS.has(key)) continue;

    const normalized = stableNormalize(value[key], seen);

    if (normalized !== undefined) {
      result[key] = normalized;
    }
  }

  seen.delete(value);

  return result;
}

export function canonicalize(value) {
  const normalized = stableNormalize(value);

  return JSON.stringify(normalized);
}

export function sha256(value) {
  const input =
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : canonicalize(value);

  return crypto
    .createHash(HASH_ALGORITHM)
    .update(input)
    .digest('hex');
}

function hmacSha256(secret, value) {
  const input =
    typeof value === 'string' || Buffer.isBuffer(value)
      ? value
      : canonicalize(value);

  return crypto
    .createHmac(HASH_ALGORITHM, secret)
    .update(input)
    .digest('hex');
}

function constantTimeHexEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') {
    return false;
  }

  const a = Buffer.from(left, 'utf8');
  const b = Buffer.from(right, 'utf8');

  if (a.length !== b.length) {
    return false;
  }

  return crypto.timingSafeEqual(a, b);
}

function identifierDigest(value) {
  return `redacted:sha256:${sha256(String(value).trim())}`;
}

function redactAuditValue(
  key,
  value,
  depth,
  maxStringLength,
) {
  if (SENSITIVE_EXACT_KEYS.has(key)) {
    return '[REDACTED]';
  }

  if (HASH_IDENTIFIER_KEYS.has(key)) {
    return identifierDigest(value);
  }

  if (
    typeof value === 'string'
    && value.length > maxStringLength
  ) {
    return `${value.slice(0, maxStringLength)}…[TRUNCATED]`;
  }

  return redactAuditData(
    value,
    depth + 1,
    maxStringLength,
  );
}

export function redactAuditData(
  value,
  depth = 0,
  maxStringLength = DEFAULT_STRING_MAX_LENGTH,
) {
  if (depth > 12) {
    return '[MAX_DEPTH]';
  }

  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Buffer.isBuffer(value)) {
    return `base64:${value.toString('base64')}`;
  }

  if (value instanceof Uint8Array) {
    return `base64:${Buffer.from(value).toString('base64')}`;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      redactAuditData(
        item,
        depth + 1,
        maxStringLength,
      ));
  }

  if (
    typeof value.toJSON === 'function'
    && !isPlainObject(value)
  ) {
    return redactAuditData(
      value.toJSON(),
      depth + 1,
      maxStringLength,
    );
  }

  const result = Object.create(null);

  for (const [key, item] of Object.entries(value)) {
    if (SKIP_OBJECT_KEYS.has(key)) continue;

    result[key] = redactAuditValue(
      key,
      item,
      depth,
      maxStringLength,
    );
  }

  return result;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) {
    return value;
  }

  seen.add(value);

  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }

  return Object.freeze(value);
}

function assertPayloadSize(value, maxBytes) {
  const bytes = Buffer.byteLength(
    canonicalize(value),
    'utf8',
  );

  if (bytes > maxBytes) {
    throw new DecisionAuditLedgerError(
      `Audit payload exceeds the configured limit of ${maxBytes} bytes.`,
      DecisionAuditLedgerErrors.PAYLOAD_TOO_LARGE,
      {
        maxBytes,
        actualBytes: bytes,
      },
    );
  }

  return bytes;
}

function normalizeOutcome(outcome) {
  if (outcome === undefined || outcome === null) {
    return undefined;
  }

  return asString(outcome, 'outcome', {
    maxLength: 100,
  });
}

function normalizeActor(actor = {}) {
  if (actor === undefined || actor === null) {
    return undefined;
  }

  if (!isPlainObject(actor)) {
    throw new DecisionAuditLedgerError(
      'actor must be an object.',
    );
  }

  return {
    type: asString(actor.type, 'actor.type', {
      maxLength: 50,
    }),
    id: asString(actor.id, 'actor.id', {
      maxLength: 200,
    }),
    role: asString(actor.role, 'actor.role', {
      maxLength: 120,
    }),
    source: asString(actor.source, 'actor.source', {
      maxLength: 120,
    }),
    sessionId: asString(actor.sessionId, 'actor.sessionId', {
      maxLength: 200,
    }),
  };
}

function normalizeProvider(provider = {}) {
  if (provider === undefined || provider === null) {
    return {
      code: PROVIDER_CODE,
    };
  }

  if (!isPlainObject(provider)) {
    throw new DecisionAuditLedgerError(
      'provider must be an object.',
    );
  }

  const code = asString(
    provider.code ?? PROVIDER_CODE,
    'provider.code',
    {
      maxLength: 30,
    },
  );

  if (code !== PROVIDER_CODE) {
    throw new DecisionAuditLedgerError(
      `This ledger is scoped to provider ${PROVIDER_CODE}.`,
    );
  }

  return {
    code,
    operation: asString(
      provider.operation,
      'provider.operation',
      {
        maxLength: 160,
      },
    ),
    environment: asString(
      provider.environment,
      'provider.environment',
      {
        maxLength: 40,
      },
    ),
    country: asString(
      provider.country,
      'provider.country',
      {
        maxLength: 40,
      },
    ),
    adapterVersion: asString(
      provider.adapterVersion,
      'provider.adapterVersion',
      {
        maxLength: 100,
      },
    ),
  };
}

function normalizeRequest(request = {}) {
  if (request === undefined || request === null) {
    return undefined;
  }

  if (!isPlainObject(request)) {
    throw new DecisionAuditLedgerError(
      'request must be an object.',
    );
  }

  return {
    requestId: asString(
      request.requestId,
      'request.requestId',
      {
        maxLength: 200,
      },
    ),
    correlationId: asString(
      request.correlationId,
      'request.correlationId',
      {
        maxLength: 200,
      },
    ),
    traceId: asString(
      request.traceId,
      'request.traceId',
      {
        maxLength: 200,
      },
    ),
    idempotencyKey: asString(
      request.idempotencyKey,
      'request.idempotencyKey',
      {
        maxLength: 300,
      },
    ),
    source: asString(
      request.source,
      'request.source',
      {
        maxLength: 80,
      },
    ),
  };
}

function normalizePolicy(policy = {}) {
  if (policy === undefined || policy === null) {
    return undefined;
  }

  if (!isPlainObject(policy)) {
    throw new DecisionAuditLedgerError(
      'policy must be an object.',
    );
  }

  return redactAuditData({
    policyId: policy.policyId,
    policyVersion: policy.policyVersion,
    decision: policy.decision,
    evaluationVersion: policy.evaluationVersion,
    matchedRuleIds: policy.matchedRuleIds,
    failedRuleIds: policy.failedRuleIds,
    exceptionIds: policy.exceptionIds,
    effectiveAt: policy.effectiveAt,
  });
}

function normalizeModel(model = {}) {
  if (model === undefined || model === null) {
    return undefined;
  }

  if (!isPlainObject(model)) {
    throw new DecisionAuditLedgerError(
      'model must be an object.',
    );
  }

  return redactAuditData({
    modelId: model.modelId,
    modelVersion: model.modelVersion,
    provider: model.provider,
    artifactVersion: model.artifactVersion,
    featureSetVersion: model.featureSetVersion,
    calibrationVersion: model.calibrationVersion,
    inferenceMode: model.inferenceMode,
    trainingDataVersion: model.trainingDataVersion,
  });
}

function normalizeEvidence(evidence = []) {
  if (evidence === undefined || evidence === null) {
    return undefined;
  }

  if (!Array.isArray(evidence)) {
    throw new DecisionAuditLedgerError(
      'evidence must be an array.',
    );
  }

  if (evidence.length > 500) {
    throw new DecisionAuditLedgerError(
      'evidence cannot contain more than 500 references.',
    );
  }

  return evidence.map((item, index) => {
    if (!isPlainObject(item)) {
      throw new DecisionAuditLedgerError(
        `evidence[${index}] must be an object.`,
      );
    }

    return redactAuditData({
      id: item.id,
      type: item.type,
      version: item.version,
      hash: item.hash,
      source: item.source,
      capturedAt: item.capturedAt,
    });
  });
}

function normalizeDecision(decision = {}) {
  if (decision === undefined || decision === null) {
    return undefined;
  }

  if (!isPlainObject(decision)) {
    throw new DecisionAuditLedgerError(
      'decision must be an object.',
    );
  }

  const confidence = decision.confidence;

  if (
    confidence !== undefined
    && (
      typeof confidence !== 'number'
      || !Number.isFinite(confidence)
      || confidence < 0
      || confidence > 1
    )
  ) {
    throw new DecisionAuditLedgerError(
      'decision.confidence must be a finite number between 0 and 1.',
    );
  }

  return redactAuditData({
    action: decision.action,
    outcome: decision.outcome,
    confidence,
    reasonCodes: decision.reasonCodes,
    rationaleCodes: decision.rationaleCodes,
    decisionVersion: decision.decisionVersion,
    subjectType: decision.subjectType,
    subjectId: decision.subjectId,
  });
}

function normalizeIntegrityState(integrity) {
  return {
    algorithm: HASH_ALGORITHM,
    previousHash: integrity.previousHash ?? null,
    canonicalHash: integrity.canonicalHash,
    payloadHash: integrity.payloadHash,
    entryHash: integrity.entryHash,
    mode: integrity.mode,
  };
}

function buildCanonicalBody(entry) {
  const body = {
    schemaVersion: entry.schemaVersion,
    ledger: entry.ledger,
    entryId: entry.entryId,
    eventType: entry.eventType,
    occurredAt: entry.occurredAt,
    recordedAt: entry.recordedAt,
    decisionId: entry.decisionId,
    decisionVersion: entry.decisionVersion,
    stage: entry.stage,
    outcome: entry.outcome,
    reasonCode: entry.reasonCode,
    provider: entry.provider,
    actor: entry.actor,
    request: entry.request,
    policy: entry.policy,
    model: entry.model,
    decision: entry.decision,
    evidence: entry.evidence,
    auditPayloadHash: entry.auditPayloadHash,
    inputHash: entry.inputHash,
    outputHash: entry.outputHash,
    previousStateHash: entry.previousStateHash,
    resultingStateHash: entry.resultingStateHash,
    parentDecisionEntryId: entry.parentDecisionEntryId,
    metadata: entry.metadata,
  };

  return stableNormalize(body);
}

function computeEntryHash({
  secret,
  mode,
  previousHash,
  canonicalHash,
  entryId,
  sequence,
}) {
  const material =
    `${previousHash ?? 'GENESIS'}|${canonicalHash}|${entryId}|${sequence}`;

  return mode === 'hmac'
    ? hmacSha256(secret, material)
    : sha256(material);
}

function freezeEntry(entry) {
  return deepFreeze(entry);
}

function normalizeStoreError(error) {
  if (error instanceof DecisionAuditLedgerError) {
    return error;
  }

  return new DecisionAuditLedgerError(
    error?.message || 'Audit store operation failed.',
    error?.code || DecisionAuditLedgerErrors.STORE_ERROR,
    undefined,
    {
      cause: error,
    },
  );
}

/**
 * Persistence adapter contract.
 *
 * Implementations should provide durable, transactional semantics where the
 * production datastore permits them.
 *
 * Required:
 *   getHead(tenantId) -> { sequence:number, entryHash:string|null } | null
 *   append(entry, { expectedPreviousHash }) -> persistedEntry
 *   findByIdempotencyKey(tenantId, idempotencyKey) -> entry | null
 *   findById(tenantId, entryId) -> entry | null
 *   listByDecisionId(tenantId, decisionId, options) -> { entries,total,nextCursor? }
 *   listByTenant(tenantId, options) -> { entries,total,nextCursor? }
 *
 * Optional:
 *   count(tenantId, options)
 *   close()
 *   healthCheck()
 *
 * append() MUST reject when the supplied expectedPreviousHash does not match
 * the current tenant head. Use error.code = CHAIN_CONFLICT for CAS failures.
 */
export class InMemoryDecisionAuditStore {
  constructor() {
    this.byTenant = new Map();
    this.locks = new Map();
    this.closed = false;
  }

  #assertOpen() {
    if (this.closed) {
      throw new DecisionAuditLedgerError(
        'Audit store is closed.',
        DecisionAuditLedgerErrors.STORE_ERROR,
      );
    }
  }

  async #withTenantLock(tenantId, operation) {
    const previous =
      this.locks.get(tenantId) ?? Promise.resolve();

    let release;

    const current = new Promise((resolve) => {
      release = resolve;
    });

    const queue = previous.then(() => current);

    this.locks.set(tenantId, queue);

    await previous;

    try {
      return await operation();
    } finally {
      release();

      if (this.locks.get(tenantId) === queue) {
        this.locks.delete(tenantId);
      }
    }
  }

  async getHead(tenantId) {
    this.#assertOpen();

    const entries = this.byTenant.get(tenantId) ?? [];
    const last = entries.at(-1);

    if (!last) {
      return null;
    }

    return {
      sequence: last.ledger.sequence,
      entryHash: last.integrity.entryHash,
    };
  }

  async findByIdempotencyKey(
    tenantId,
    idempotencyKey,
  ) {
    this.#assertOpen();

    if (!idempotencyKey) {
      return null;
    }

    const entries = this.byTenant.get(tenantId) ?? [];

    const found = [...entries]
      .reverse()
      .find(
        (entry) =>
          entry.request?.idempotencyKey === idempotencyKey,
      );

    return found ? cloneValue(found) : null;
  }

  async findById(tenantId, entryId) {
    this.#assertOpen();

    const entries = this.byTenant.get(tenantId) ?? [];

    const found = entries.find(
      (entry) => entry.entryId === entryId,
    );

    return found ? cloneValue(found) : null;
  }

  async append(
    entry,
    {
      expectedPreviousHash = null,
    } = {},
  ) {
    this.#assertOpen();

    return this.#withTenantLock(
      entry.ledger.tenantId,
      async () => {
        const entries =
          this.byTenant.get(entry.ledger.tenantId) ?? [];

        const current = entries.at(-1);

        const actualPreviousHash =
          current?.integrity?.entryHash ?? null;

        if (
          !constantTimeStringEqual(
            actualPreviousHash,
            expectedPreviousHash,
          )
        ) {
          throw new DecisionAuditLedgerError(
            'Audit chain head changed during append.',
            DecisionAuditLedgerErrors.CHAIN_CONFLICT,
            {
              expectedPreviousHash,
              actualPreviousHash,
            },
          );
        }

        const expectedSequence =
          (current?.ledger?.sequence ?? 0) + 1;

        if (entry.ledger.sequence !== expectedSequence) {
          throw new DecisionAuditLedgerError(
            'Audit chain sequence is not contiguous.',
            DecisionAuditLedgerErrors.CHAIN_CONFLICT,
            {
              expectedSequence,
              suppliedSequence: entry.ledger.sequence,
            },
          );
        }

        if (!this.byTenant.has(entry.ledger.tenantId)) {
          this.byTenant.set(
            entry.ledger.tenantId,
            entries,
          );
        }

        const persisted =
          freezeEntry(cloneValue(entry));

        entries.push(persisted);

        return cloneValue(persisted);
      },
    );
  }

  async listByDecisionId(
    tenantId,
    decisionId,
    options = {},
  ) {
    this.#assertOpen();

    const entries = (
      this.byTenant.get(tenantId) ?? []
    ).filter(
      (entry) => entry.decisionId === decisionId,
    );

    const sorted = entries.sort(
      (a, b) =>
        a.ledger.sequence - b.ledger.sequence,
    );

    const limit = Math.min(
      Number(options.limit) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const start = Math.max(
      0,
      Number(options.offset) || 0,
    );

    return {
      entries: cloneValue(
        sorted.slice(start, start + limit),
      ),
      total: sorted.length,
      nextOffset:
        start + limit < sorted.length
          ? start + limit
          : null,
    };
  }

  async listByTenant(
    tenantId,
    options = {},
  ) {
    this.#assertOpen();

    const all =
      this.byTenant.get(tenantId) ?? [];

    let filtered = all;

    if (options.eventType) {
      filtered = filtered.filter(
        (entry) =>
          entry.eventType === options.eventType,
      );
    }

    if (options.from) {
      filtered = filtered.filter(
        (entry) =>
          entry.recordedAt >= options.from,
      );
    }

    if (options.to) {
      filtered = filtered.filter(
        (entry) =>
          entry.recordedAt <= options.to,
      );
    }

    const sorted = filtered.sort(
      (a, b) =>
        a.ledger.sequence - b.ledger.sequence,
    );

    const limit = Math.min(
      Number(options.limit) || DEFAULT_PAGE_SIZE,
      MAX_PAGE_SIZE,
    );

    const start = Math.max(
      0,
      Number(options.offset) || 0,
    );

    return {
      entries: cloneValue(
        sorted.slice(start, start + limit),
      ),
      total: sorted.length,
      nextOffset:
        start + limit < sorted.length
          ? start + limit
          : null,
    };
  }

  async count(tenantId, options = {}) {
    const result = await this.listByTenant(
      tenantId,
      {
        ...options,
        limit: MAX_PAGE_SIZE,
        offset: 0,
      },
    );

    return result.total;
  }

  async healthCheck() {
    return {
      ok: !this.closed,
      type: 'in-memory',
      durable: false,
    };
  }

  async close() {
    this.closed = true;
    this.byTenant.clear();
    this.locks.clear();
  }
}

function constantTimeStringEqual(left, right) {
  if (
    left === null
    || left === undefined
    || right === null
    || right === undefined
  ) {
    return (left ?? null) === (right ?? null);
  }

  return constantTimeHexEqual(
    String(left),
    String(right),
  );
}

export class DecisionAuditLedger {
  constructor(options = {}) {
    const {
      store,
      clock = () => new Date(),
      integrityMode = 'hash',
      integritySecret,
      allowInMemoryStore = false,
      maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
      maxChainRetries = DEFAULT_MAX_CHAIN_RETRIES,
      maxClockSkewMs = DEFAULT_CLOCK_SKEW_MS,
      redact = redactAuditData,
      logger = console,
      moduleVersion = MODULE_VERSION,
    } = options;

    if (
      integrityMode !== 'hash'
      && integrityMode !== 'hmac'
    ) {
      throw new DecisionAuditLedgerError(
        'integrityMode must be "hash" or "hmac".',
        DecisionAuditLedgerErrors.CONFIGURATION_ERROR,
      );
    }

    if (
      integrityMode === 'hmac'
      && (
        !integritySecret
        || String(integritySecret).length < 32
      )
    ) {
      throw new DecisionAuditLedgerError(
        'A 32-character minimum integritySecret is required for HMAC audit integrity.',
        DecisionAuditLedgerErrors.CONFIGURATION_ERROR,
      );
    }

    if (store) {
      this.store = store;
    } else if (
      allowInMemoryStore
      || process.env.NODE_ENV === 'test'
    ) {
      this.store = new InMemoryDecisionAuditStore();
    } else {
      throw new DecisionAuditLedgerError(
        'A durable audit persistence adapter is required. Use allowInMemoryStore only for tests/local development.',
        DecisionAuditLedgerErrors.CONFIGURATION_ERROR,
      );
    }

    const requiredStoreMethods = [
      'getHead',
      'append',
      'findByIdempotencyKey',
      'findById',
      'listByDecisionId',
      'listByTenant',
    ];

    const missingStoreMethods =
      requiredStoreMethods.filter(
        (method) =>
          typeof this.store?.[method] !== 'function',
      );

    if (missingStoreMethods.length) {
      throw new DecisionAuditLedgerError(
        `Audit persistence adapter is missing required methods: ${missingStoreMethods.join(', ')}.`,
        DecisionAuditLedgerErrors.CONFIGURATION_ERROR,
        {
          missingStoreMethods,
        },
      );
    }

    this.clock = clock;
    this.integrityMode = integrityMode;
    this.integritySecret = integritySecret;
    this.maxPayloadBytes = maxPayloadBytes;
    this.maxChainRetries = maxChainRetries;
    this.maxClockSkewMs = maxClockSkewMs;
    this.redact = redact;
    this.logger = logger ?? console;
    this.moduleVersion = moduleVersion;
    this.appendLocks = new Map();
  }

  #now() {
    const now = this.clock();

    const date = parseDate(
      now,
      'clock() result',
      {
        required: true,
      },
    );

    return date;
  }

  #validateTenantId(tenantId) {
    return asString(
      tenantId,
      'tenantId',
      {
        required: true,
        maxLength:
          DEFAULT_MAX_TENANT_ID_LENGTH,
      },
    );
  }

  #validateDecisionId(decisionId) {
    return asString(
      decisionId,
      'decisionId',
      {
        required: true,
        maxLength:
          DEFAULT_MAX_DECISION_ID_LENGTH,
      },
    );
  }

  #validateEventType(eventType) {
    const value = asString(
      eventType,
      'eventType',
      {
        required: true,
        maxLength:
          DEFAULT_MAX_EVENT_TYPE_LENGTH,
      },
    );

    if (!EVENT_TYPE_PATTERN.test(value)) {
      throw new DecisionAuditLedgerError(
        'eventType must contain only uppercase letters, numbers, dots, underscores, colons or hyphens.',
      );
    }

    return value;
  }

  #validateOccurredAt(
    occurredAt,
    recordedAt,
  ) {
    const date =
      parseDate(occurredAt, 'occurredAt')
      ?? recordedAt;

    if (
      date.getTime()
      > recordedAt.getTime()
        + this.maxClockSkewMs
    ) {
      throw new DecisionAuditLedgerError(
        'occurredAt is too far in the future relative to server time.',
      );
    }

    return date.toISOString();
  }

  #normalizeEvent(input) {
    if (!isPlainObject(input)) {
      throw new DecisionAuditLedgerError(
        'Audit event input must be an object.',
      );
    }

    const recordedAt = this.#now();

    const tenantId =
      this.#validateTenantId(input.tenantId);

    const decisionId =
      this.#validateDecisionId(
        input.decisionId,
      );

    const eventType =
      this.#validateEventType(
        input.eventType,
      );

    const request =
      normalizeRequest(
        input.request ?? {
          requestId:
            input.requestId,
          correlationId:
            input.correlationId,
          traceId:
            input.traceId,
          idempotencyKey:
            input.idempotencyKey,
          source:
            input.source,
        },
      );

    const idempotencyKey =
      request?.idempotencyKey;

    if (
      input.idempotencyRequired !== false
      && !idempotencyKey
    ) {
      throw new DecisionAuditLedgerError(
        'request.idempotencyKey is required for auditable decision events.',
      );
    }

    const metadata =
      this.redact(
        cloneValue(
          input.metadata ?? {},
        ),
      );

    const rawInput =
      this.redact(
        cloneValue(
          input.input ?? {},
        ),
      );

    const rawOutput =
      this.redact(
        cloneValue(
          input.output ?? {},
        ),
      );

    const evidence =
      normalizeEvidence(
        input.evidence,
      );

    const policy =
      normalizePolicy(
        input.policy,
      );

    const model =
      normalizeModel(
        input.model,
      );

    const decision =
      normalizeDecision(
        input.decision,
      );

    const actor =
      normalizeActor(
        input.actor,
      );

    const provider =
      normalizeProvider(
        input.provider,
      );

    const inputHash =
      input.inputHash
      ?? (
        input.input === undefined
          ? undefined
          : sha256(rawInput)
      );

    const outputHash =
      input.outputHash
      ?? (
        input.output === undefined
          ? undefined
          : sha256(rawOutput)
      );

    return {
      schemaVersion:
        SCHEMA_VERSION,

      ledger: {
        name:
          MODULE_NAME,
        moduleVersion:
          this.moduleVersion,
        tenantId,
        sequence:
          undefined,
      },

      entryId:
        asString(
          input.entryId,
          'entryId',
          {
            maxLength: 200,
          },
        )
        ?? crypto.randomUUID(),

      eventType,

      occurredAt:
        this.#validateOccurredAt(
          input.occurredAt,
          recordedAt,
        ),

      recordedAt:
        recordedAt.toISOString(),

      decisionId,

      decisionVersion:
        asString(
          input.decisionVersion,
          'decisionVersion',
          {
            maxLength: 80,
          },
        ),

      stage:
        asString(
          input.stage,
          'stage',
          {
            maxLength: 100,
          },
        ),

      outcome:
        normalizeOutcome(
          input.outcome
          ?? decision?.outcome,
        ),

      reasonCode:
        asString(
          input.reasonCode,
          'reasonCode',
          {
            maxLength: 120,
          },
        ),

      provider,

      actor,

      request,

      policy,

      model,

      decision,

      evidence,

      inputHash:
        inputHash
          ? asString(
            inputHash,
            'inputHash',
            {
              maxLength: 200,
            },
          )
          : undefined,

      outputHash:
        outputHash
          ? asString(
            outputHash,
            'outputHash',
            {
              maxLength: 200,
            },
          )
          : undefined,

      previousStateHash:
        input.previousStateHash
          ? asString(
            input.previousStateHash,
            'previousStateHash',
            {
              maxLength: 200,
            },
          )
          : undefined,

      resultingStateHash:
        input.resultingStateHash
          ? asString(
            input.resultingStateHash,
            'resultingStateHash',
            {
              maxLength: 200,
            },
          )
          : undefined,

      parentDecisionEntryId:
        input.parentDecisionEntryId
          ? asString(
            input.parentDecisionEntryId,
            'parentDecisionEntryId',
            {
              maxLength: 200,
            },
          )
          : undefined,

      metadata,

      auditPayload: {
        input: rawInput,
        output: rawOutput,
      },
    };
  }

  #buildCandidate(
    normalized,
    head,
  ) {
    const sequence =
      (head?.sequence ?? 0) + 1;

    const previousHash =
      head?.entryHash ?? null;

    const entry = {
      ...normalized,

      ledger: {
        ...normalized.ledger,
        sequence,
      },
    };

    const auditPayload =
      entry.auditPayload;

    const payloadHash =
      sha256(auditPayload);

    entry.auditPayloadHash =
      payloadHash;

    const canonicalBody =
      buildCanonicalBody({
        ...entry,
        auditPayload: undefined,
      });

    const canonicalHash =
      sha256(canonicalBody);

    const entryHash =
      computeEntryHash({
        secret:
          this.integritySecret,
        mode:
          this.integrityMode,
        previousHash,
        canonicalHash,
        entryId:
          entry.entryId,
        sequence,
      });

    const completeEntry = {
      ...entry,
      auditPayload:
        undefined,
      auditPayloadHash:
        payloadHash,

      integrity:
        normalizeIntegrityState({
          algorithm:
            HASH_ALGORITHM,
          previousHash,
          canonicalHash,
          payloadHash,
          entryHash,
          mode:
            this.integrityMode,
        }),
    };

    assertPayloadSize(
      completeEntry,
      this.maxPayloadBytes,
    );

    return completeEntry;
  }

  async recordDecisionEvent(
    input = {},
    options = {},
  ) {
    const normalized =
      this.#normalizeEvent(input);

    assertPayloadSize(
      normalized,
      this.maxPayloadBytes,
    );

    const tenantId =
      normalized.ledger.tenantId;

    return this.#withTenantAppendLock(
      tenantId,
      async () => {
        const idempotencyKey =
          normalized.request
            ?.idempotencyKey;

        const existing =
          idempotencyKey
            ? await this.store.findByIdempotencyKey(
              tenantId,
              idempotencyKey,
            )
            : null;

        if (existing) {
          const incomingPayloadHash =
            sha256({
              eventType:
                normalized.eventType,
              decisionId:
                normalized.decisionId,
              decisionVersion:
                normalized.decisionVersion,
              stage:
                normalized.stage,
              outcome:
                normalized.outcome,
              policy:
                normalized.policy,
              model:
                normalized.model,
              decision:
                normalized.decision,
              evidence:
                normalized.evidence,
              inputHash:
                normalized.inputHash,
              outputHash:
                normalized.outputHash,
              metadata:
                normalized.metadata,
            });

          const existingPayloadHash =
            sha256({
              eventType:
                existing.eventType,
              decisionId:
                existing.decisionId,
              decisionVersion:
                existing.decisionVersion,
              stage:
                existing.stage,
              outcome:
                existing.outcome,
              policy:
                existing.policy,
              model:
                existing.model,
              decision:
                existing.decision,
              evidence:
                existing.evidence,
              inputHash:
                existing.inputHash,
              outputHash:
                existing.outputHash,
              metadata:
                existing.metadata,
            });

          if (
            incomingPayloadHash
            !== existingPayloadHash
          ) {
            throw new DecisionAuditLedgerError(
              'The idempotency key has already been used for a different audit event.',
              DecisionAuditLedgerErrors.IDEMPOTENCY_CONFLICT,
              {
                tenantId,
                idempotencyKey,
                existingEntryId:
                  existing.entryId,
              },
            );
          }

          return {
            entry:
              deepFreeze(existing),
            idempotentReplay:
              true,
          };
        }

        const maxRetries =
          Number.isInteger(
            options.maxChainRetries,
          )
            ? Math.max(
              0,
              options.maxChainRetries,
            )
            : this.maxChainRetries;

        let lastConflict;

        for (
          let attempt = 0;
          attempt <= maxRetries;
          attempt += 1
        ) {
          try {
            const head =
              await this.store.getHead(
                tenantId,
              );

            const candidate =
              this.#buildCandidate(
                normalized,
                head,
              );

            const persisted =
              await this.store.append(
                candidate,
                {
                  expectedPreviousHash:
                    head?.entryHash
                    ?? null,
                },
              );

            this.#log(
              'debug',
              'decision_audit_recorded',
              {
                tenantId,
                decisionId:
                  normalized.decisionId,
                eventType:
                  normalized.eventType,
                entryId:
                  persisted.entryId,
                sequence:
                  persisted.ledger.sequence,
                terminal:
                  TERMINAL_EVENTS.has(
                    normalized.eventType,
                  ),
              },
            );

            return {
              entry:
                deepFreeze(persisted),
              idempotentReplay:
                false,
            };
          } catch (error) {
            const normalizedError =
              normalizeStoreError(error);

            lastConflict =
              normalizedError;

            if (
              normalizedError.code
                !== DecisionAuditLedgerErrors.CHAIN_CONFLICT
              || attempt >= maxRetries
            ) {
              throw normalizedError;
            }

            await new Promise(
              (resolve) =>
                setTimeout(
                  resolve,
                  Math.min(
                    100,
                    5 * (2 ** attempt),
                  ),
                ),
            );
          }
        }

        throw lastConflict
          ?? new DecisionAuditLedgerError(
            'Unable to append audit event.',
          );
      },
    );
  }

  async append(
    input = {},
    options = {},
  ) {
    return this.recordDecisionEvent(
      input,
      options,
    );
  }

  async recordDecision(
    input = {},
    options = {},
  ) {
    return this.recordDecisionEvent(
      input,
      options,
    );
  }

  async recordApproval(
    input = {},
    options = {},
  ) {
    return this.recordDecisionEvent(
      {
        ...input,
        eventType:
          input.eventType
          ?? DecisionAuditLedgerEvents.APPROVAL_GRANTED,
        stage:
          input.stage
          ?? 'APPROVAL',
      },
      options,
    );
  }

  async recordRejection(
    input = {},
    options = {},
  ) {
    return this.recordDecisionEvent(
      {
        ...input,
        eventType:
          input.eventType
          ?? DecisionAuditLedgerEvents.DECISION_REJECTED,
        stage:
          input.stage
          ?? 'DECISION',
        outcome:
          input.outcome
          ?? 'REJECTED',
      },
      options,
    );
  }

  async recordEscalation(
    input = {},
    options = {},
  ) {
    return this.recordDecisionEvent(
      {
        ...input,
        eventType:
          input.eventType
          ?? DecisionAuditLedgerEvents.DECISION_ESCALATED,
        stage:
          input.stage
          ?? 'GOVERNANCE',
        outcome:
          input.outcome
          ?? 'ESCALATED',
      },
      options,
    );
  }

  async recordExecution(
    input = {},
    options = {},
  ) {
    return this.recordDecisionEvent(
      {
        ...input,
        eventType:
          input.eventType
          ?? DecisionAuditLedgerEvents.DECISION_EXECUTED,
        stage:
          input.stage
          ?? 'EXECUTION',
        outcome:
          input.outcome
          ?? 'EXECUTED',
      },
      options,
    );
  }

  async getDecisionHistory({
    tenantId,
    decisionId,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  } = {}) {
    const normalizedTenantId =
      this.#validateTenantId(
        tenantId,
      );

    const normalizedDecisionId =
      this.#validateDecisionId(
        decisionId,
      );

    const boundedLimit =
      Math.min(
        Math.max(
          Number(limit)
          || DEFAULT_PAGE_SIZE,
          1,
        ),
        MAX_PAGE_SIZE,
      );

    const boundedOffset =
      Math.max(
        Number(offset) || 0,
        0,
      );

    const result =
      await this.store.listByDecisionId(
        normalizedTenantId,
        normalizedDecisionId,
        {
          limit:
            boundedLimit,
          offset:
            boundedOffset,
        },
      );

    return {
      ...result,
      entries:
        result.entries.map(
          (entry) =>
            deepFreeze(entry),
        ),
    };
  }

  async getEntry({
    tenantId,
    entryId,
  } = {}) {
    const normalizedTenantId =
      this.#validateTenantId(
        tenantId,
      );

    const normalizedEntryId =
      asString(
        entryId,
        'entryId',
        {
          required: true,
          maxLength: 200,
        },
      );

    const entry =
      await this.store.findById(
        normalizedTenantId,
        normalizedEntryId,
      );

    if (!entry) {
      throw new DecisionAuditLedgerError(
        'Audit entry not found.',
        DecisionAuditLedgerErrors.NOT_FOUND,
        {
          tenantId:
            normalizedTenantId,
          entryId:
            normalizedEntryId,
        },
      );
    }

    return deepFreeze(entry);
  }

  async listTenantAudit({
    tenantId,
    eventType,
    from,
    to,
    limit = DEFAULT_PAGE_SIZE,
    offset = 0,
  } = {}) {
    const normalizedTenantId =
      this.#validateTenantId(
        tenantId,
      );

    const boundedLimit =
      Math.min(
        Math.max(
          Number(limit)
          || DEFAULT_PAGE_SIZE,
          1,
        ),
        MAX_PAGE_SIZE,
      );

    const boundedOffset =
      Math.max(
        Number(offset) || 0,
        0,
      );

    const result =
      await this.store.listByTenant(
        normalizedTenantId,
        {
          eventType:
            eventType
              ? this.#validateEventType(
                eventType,
              )
              : undefined,

          from:
            from
              ? parseDate(
                from,
                'from',
              )?.toISOString()
              : undefined,

          to:
            to
              ? parseDate(
                to,
                'to',
              )?.toISOString()
              : undefined,

          limit:
            boundedLimit,

          offset:
            boundedOffset,
        },
      );

    return {
      ...result,
      entries:
        result.entries.map(
          (entry) =>
            deepFreeze(entry),
        ),
    };
  }

  async verifyEntry(entry) {
    if (!isPlainObject(entry)) {
      throw new DecisionAuditLedgerError(
        'Audit entry must be an object.',
      );
    }

    const canonicalBody =
      buildCanonicalBody(entry);

    const canonicalHash =
      sha256(canonicalBody);

    const expectedEntryHash =
      computeEntryHash({
        secret:
          this.integritySecret,

        mode:
          entry.integrity?.mode
          ?? this.integrityMode,

        previousHash:
          entry.integrity
            ?.previousHash
          ?? null,

        canonicalHash,

        entryId:
          entry.entryId,

        sequence:
          entry.ledger
            ?.sequence,
      });

    const expectedPayloadHash =
      entry.auditPayload
        ? sha256(entry.auditPayload)
        : entry.auditPayloadHash
          ?? entry.integrity?.payloadHash;

    const canonicalMatch =
      entry.integrity?.canonicalHash
      === canonicalHash;

    const entryHashMatch =
      entry.integrity?.entryHash
      === expectedEntryHash;

    const payloadMatch =
      entry.auditPayloadHash === undefined
        ? (
          entry.integrity?.payloadHash
          === expectedPayloadHash
        )
        : (
          entry.integrity?.payloadHash
          === entry.auditPayloadHash
        );

    return {
      ok:
        canonicalMatch
        && entryHashMatch
        && payloadMatch,

      entryId:
        entry.entryId,

      tenantId:
        entry.ledger?.tenantId,

      sequence:
        entry.ledger?.sequence,

      canonicalMatch,

      entryHashMatch,

      payloadMatch,

      expected: {
        canonicalHash,
        entryHash:
          expectedEntryHash,
        payloadHash:
          expectedPayloadHash,
      },

      actual: {
        canonicalHash:
          entry.integrity?.canonicalHash,

        entryHash:
          entry.integrity?.entryHash,

        payloadHash:
          entry.integrity?.payloadHash,
      },
    };
  }

  async verifyChain({
    tenantId,
    fromSequence = 1,
    toSequence,
  } = {}) {
    const normalizedTenantId =
      this.#validateTenantId(
        tenantId,
      );

    const entries = [];

    let offset = 0;

    const targetToSequence =
      toSequence === undefined
        ? undefined
        : Number(toSequence);

    while (true) {
      const page =
        await this.store.listByTenant(
          normalizedTenantId,
          {
            limit:
              MAX_PAGE_SIZE,
            offset,
          },
        );

      const pageEntries =
        Array.isArray(page?.entries)
          ? page.entries
          : [];

      for (const entry of pageEntries) {
        if (
          entry.ledger.sequence
          < Number(fromSequence)
        ) {
          continue;
        }

        if (
          targetToSequence !== undefined
          && entry.ledger.sequence
            > targetToSequence
        ) {
          break;
        }

        entries.push(entry);
      }

      const reachedTarget =
        targetToSequence !== undefined
        && pageEntries.some(
          (entry) =>
            entry.ledger.sequence
            >= targetToSequence,
        );

      const hasNext =
        page?.nextOffset !== null
        && page?.nextOffset !== undefined;

      if (
        reachedTarget
        || !hasNext
        || pageEntries.length === 0
      ) {
        break;
      }

      offset =
        Number(page.nextOffset);

      if (
        !Number.isFinite(offset)
        || offset <= 0
      ) {
        break;
      }
    }

    entries.sort(
      (a, b) =>
        a.ledger.sequence - b.ledger.sequence,
    );

    if (!entries.length) {
      return {
        ok: true,
        tenantId:
          normalizedTenantId,
        verifiedEntries:
          0,
        firstSequence:
          null,
        lastSequence:
          null,
        errors: [],
      };
    }

    const errors = [];

    let previousSequence =
      entries[0].ledger.sequence - 1;

    let previousHash =
      entries[0].integrity.previousHash
      ?? null;

    for (const entry of entries) {
      if (
        entry.ledger.sequence
        !== previousSequence + 1
      ) {
        errors.push({
          code:
            DecisionAuditLedgerErrors.INTEGRITY_FAILURE,

          type:
            'SEQUENCE_GAP',

          sequence:
            entry.ledger.sequence,

          expected:
            previousSequence + 1,

          entryId:
            entry.entryId,
        });
      }

      if (
        !constantTimeStringEqual(
          entry.integrity.previousHash
            ?? null,
          previousHash,
        )
      ) {
        errors.push({
          code:
            DecisionAuditLedgerErrors.INTEGRITY_FAILURE,

          type:
            'PREVIOUS_HASH_MISMATCH',

          sequence:
            entry.ledger.sequence,

          entryId:
            entry.entryId,

          expected:
            previousHash,

          actual:
            entry.integrity.previousHash
            ?? null,
        });
      }

      const verification =
        await this.verifyEntry(
          entry,
        );

      if (!verification.ok) {
        errors.push({
          code:
            DecisionAuditLedgerErrors.INTEGRITY_FAILURE,

          type:
            'ENTRY_HASH_MISMATCH',

          sequence:
            entry.ledger.sequence,

          entryId:
            entry.entryId,

          verification,
        });
      }

      previousSequence =
        entry.ledger.sequence;

      previousHash =
        entry.integrity.entryHash;
    }

    const report = {
      ok:
        errors.length === 0,

      tenantId:
        normalizedTenantId,

      verifiedEntries:
        entries.length,

      firstSequence:
        entries[0].ledger.sequence,

      lastSequence:
        entries.at(-1).ledger.sequence,

      errors,
    };

    if (!report.ok) {
      this.#log(
        'error',
        'decision_audit_integrity_failure',
        {
          tenantId:
            normalizedTenantId,

          verifiedEntries:
            report.verifiedEntries,

          errorCount:
            report.errors.length,
        },
      );
    }

    return report;
  }

  async verifyDecision({
    tenantId,
    decisionId,
  } = {}) {
    const history =
      await this.getDecisionHistory({
        tenantId,
        decisionId,
        limit:
          MAX_PAGE_SIZE,
        offset:
          0,
      });

    const errors = [];

    let previousHash = null;
    let previousSequence = null;

    for (const entry of history.entries) {
      const verification =
        await this.verifyEntry(entry);

      if (!verification.ok) {
        errors.push({
          entryId:
            entry.entryId,
          type:
            'ENTRY_HASH_MISMATCH',
          verification,
        });
      }

      if (
        previousHash !== null
        && !constantTimeStringEqual(
          entry.integrity.previousHash
            ?? null,
          previousHash,
        )
      ) {
        errors.push({
          entryId:
            entry.entryId,

          type:
            'DECISION_CHAIN_MISMATCH',

          expected:
            previousHash,

          actual:
            entry.integrity.previousHash,
        });
      }

      if (
        previousSequence !== null
        && entry.ledger.sequence
          !== previousSequence + 1
      ) {
        errors.push({
          entryId:
            entry.entryId,

          type:
            'DECISION_SEQUENCE_GAP',

          expected:
            previousSequence + 1,

          actual:
            entry.ledger.sequence,
        });
      }

      previousHash =
        entry.integrity.entryHash;

      previousSequence =
        entry.ledger.sequence;
    }

    return {
      ok:
        errors.length === 0,

      tenantId:
        this.#validateTenantId(
          tenantId,
        ),

      decisionId:
        this.#validateDecisionId(
          decisionId,
        ),

      entryCount:
        history.entries.length,

      terminalEvent:
        history.entries.at(-1)
          ?.eventType
        ?? null,

      terminal:
        TERMINAL_EVENTS.has(
          history.entries.at(-1)
            ?.eventType,
        ),

      errors,

      entries:
        history.entries,
    };
  }

  async exportDecisionAudit({
    tenantId,
    decisionId,
  } = {}) {
    const verification =
      await this.verifyDecision({
        tenantId,
        decisionId,
      });

    const generatedAt =
      this.#now().toISOString();

    const evidenceBundle = {
      bundleVersion:
        '1.0',

      generatedAt,

      module: {
        name:
          MODULE_NAME,

        version:
          this.moduleVersion,
      },

      tenantId:
        verification.tenantId,

      decisionId:
        verification.decisionId,

      integrity: {
        ok:
          verification.ok,

        entryCount:
          verification.entryCount,
      },

      entries:
        verification.entries,
    };

    return {
      ...evidenceBundle,

      evidenceBundleHash:
        sha256(evidenceBundle),
    };
  }

  async healthCheck() {
    try {
      if (
        typeof this.store.healthCheck
        === 'function'
      ) {
        return {
          ok: true,

          module:
            MODULE_NAME,

          moduleVersion:
            this.moduleVersion,

          integrityMode:
            this.integrityMode,

          store:
            await this.store.healthCheck(),
        };
      }

      return {
        ok: true,

        module:
          MODULE_NAME,

        moduleVersion:
          this.moduleVersion,

        integrityMode:
          this.integrityMode,

        store: {
          ok: true,
          healthCheckSupported:
            false,
        },
      };
    } catch (error) {
      const normalized =
        normalizeStoreError(error);

      return {
        ok: false,

        module:
          MODULE_NAME,

        moduleVersion:
          this.moduleVersion,

        integrityMode:
          this.integrityMode,

        error: {
          code:
            normalized.code,

          message:
            normalized.message,
        },
      };
    }
  }

  async close() {
    if (
      typeof this.store.close
      === 'function'
    ) {
      await this.store.close();
    }

    this.appendLocks.clear();
  }

  async #withTenantAppendLock(
    tenantId,
    operation,
  ) {
    const previous =
      this.appendLocks.get(
        tenantId,
      )
      ?? Promise.resolve();

    let release;

    const current =
      new Promise((resolve) => {
        release = resolve;
      });

    const queue =
      previous.then(
        () => current,
      );

    this.appendLocks.set(
      tenantId,
      queue,
    );

    await previous;

    try {
      return await operation();
    } finally {
      release();

      if (
        this.appendLocks.get(
          tenantId,
        ) === queue
      ) {
        this.appendLocks.delete(
          tenantId,
        );
      }
    }
  }

  #log(
    level,
    message,
    details,
  ) {
    const loggerMethod =
      this.logger?.[level]
      ?? this.logger?.info;

    if (
      typeof loggerMethod
      !== 'function'
    ) {
      return;
    }

    try {
      loggerMethod.call(
        this.logger,
        {
          module:
            MODULE_NAME,
          ...details,
        },
        message,
      );
    } catch {
      // Logging must never break the audit path.
    }
  }
}

export function createDecisionAuditLedger(
  options = {},
) {
  return new DecisionAuditLedger(options);
}

export default DecisionAuditLedger;

export const constants = Object.freeze({
  MODULE_NAME,
  MODULE_VERSION,
  SCHEMA_VERSION,
  PROVIDER_CODE,
  HASH_ALGORITHM,
  DEFAULT_MAX_PAYLOAD_BYTES,
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  DEFAULT_MAX_CHAIN_RETRIES,
  DEFAULT_CLOCK_SKEW_MS,
});