'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Intelligence Feature Store
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/featureStore.js
 *
 * Architectural Role:
 *   Tenant-aware feature persistence and serving boundary for Airtel payment
 *   intelligence, analytics, fraud/risk models, failure prediction and
 *   operational decision-support components.
 *
 * Responsibilities:
 *   - Normalize and validate intelligence features.
 *   - Enforce tenant isolation.
 *   - Store bounded, versioned feature vectors / feature records.
 *   - Serve current and historical feature sets.
 *   - Support deterministic feature fingerprints.
 *   - Support feature schema/version management.
 *   - Detect stale and expired feature data.
 *   - Preserve exact-money representations.
 *   - Support idempotent writes where repository capabilities permit.
 *   - Provide batch write/read operations with bounded limits.
 *   - Produce safe feature statistics without exposing raw provider payloads.
 *   - Provide health, diagnostics and capability information.
 *
 * Explicitly NOT Responsible For:
 *   - Payment authorization.
 *   - Payment execution.
 *   - Airtel API/HTTP communication.
 *   - OAuth/token handling.
 *   - Callback authentication or signature verification.
 *   - Ledger posting.
 *   - Balance mutation.
 *   - Settlement.
 *   - Reconciliation authority.
 *   - Loan or credit approval.
 *   - Fraud blocking.
 *   - AML/KYC decisions.
 *   - Regulatory determinations.
 *   - Autonomous financial actions.
 *
 * Financial Safety:
 *   - Monetary feature values are represented as decimal strings or bigint
 *     minor-unit values.
 *   - Number is never used for financial arithmetic.
 *   - Feature calculations do not mutate authoritative financial state.
 *   - Model scores/probabilities remain advisory signals.
 *   - Raw secrets, tokens, signatures and untrusted provider payloads are never
 *     stored as feature data.
 *
 * Security:
 *   - Tenant context is authoritative.
 *   - Caller-provided tenant filters cannot override resolved tenant identity.
 *   - Payload size, feature count and key length are bounded.
 *   - Sensitive key patterns are rejected/redacted.
 *   - Feature retrieval is tenant-scoped.
 *
 * Module Format:
 *   CommonJS
 *
 * =============================================================================
 */

const crypto = require('node:crypto');

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

const PROVIDER = 'AIRTEL';

const STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  STALE: 'STALE',
  EXPIRED: 'EXPIRED',
  INVALID: 'INVALID',
  DISABLED: 'DISABLED',
});

const SOURCE_TYPES = Object.freeze({
  CALLBACK: 'CALLBACK',
  TRANSACTION: 'TRANSACTION',
  ANALYTICS: 'ANALYTICS',
  RECONCILIATION: 'RECONCILIATION',
  PROVIDER_HEALTH: 'PROVIDER_HEALTH',
  FRAUD: 'FRAUD',
  FAILURE: 'FAILURE',
  OPERATIONS: 'OPERATIONS',
  MANUAL: 'MANUAL',
  DERIVED: 'DERIVED',
});

const FEATURE_TYPES = Object.freeze({
  NUMBER: 'NUMBER',
  INTEGER: 'INTEGER',
  BOOLEAN: 'BOOLEAN',
  STRING: 'STRING',
  CATEGORICAL: 'CATEGORICAL',
  MONEY_MINOR: 'MONEY_MINOR',
  MONEY_DECIMAL: 'MONEY_DECIMAL',
  TIMESTAMP: 'TIMESTAMP',
});

const QUALITY = Object.freeze({
  HIGH: 'HIGH',
  MEDIUM: 'MEDIUM',
  LOW: 'LOW',
  UNKNOWN: 'UNKNOWN',
});

const LIMITS = Object.freeze({
  MAX_FEATURES: 500,
  MAX_BATCH: 250,
  MAX_KEY_LENGTH: 150,
  MAX_STRING_LENGTH: 1000,
  MAX_CATEGORY_LENGTH: 150,
  MAX_METADATA_KEYS: 40,
  MAX_METADATA_VALUE_LENGTH: 500,
  MAX_ARRAY_ITEMS: 100,
  MAX_FEATURE_GROUP_LENGTH: 100,
  MAX_SCHEMA_LENGTH: 100,
  MAX_VERSION_LENGTH: 50,
  MAX_TTL_MS: 365 * 24 * 60 * 60 * 1000,
  DEFAULT_TTL_MS: 24 * 60 * 60 * 1000,
  DEFAULT_MAX_AGE_MS: 24 * 60 * 60 * 1000,
  MAX_READ_LIMIT: 250,
});

const SENSITIVE_KEY_PATTERNS = [
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /authorization/i,
  /cookie/i,
  /set-cookie/i,
  /signature/i,
  /private.?key/i,
  /access.?key/i,
  /refresh.?token/i,
  /client.?secret/i,
  /api.?key/i,
  /credential/i,
];

/* -------------------------------------------------------------------------- */
/* Primitive helpers                                                          */
/* -------------------------------------------------------------------------- */

function isPlainObject(value) {
  return Boolean(
    value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.getPrototypeOf(value) === Object.prototype
  );
}

function boundedText(value, maxLength) {
  if (value === null || value === undefined) {
    return null;
  }

  const text = String(value).trim();

  if (!text) {
    return null;
  }

  return text.slice(0, maxLength);
}

function normalizeId(value) {
  return boundedText(value, 200);
}

function normalizeProvider(value) {
  return boundedText(value, 50)?.toUpperCase() || PROVIDER;
}

function normalizeCurrency(value) {
  return boundedText(value, 10)?.toUpperCase() || null;
}

function normalizeBoolean(value, fallback = null) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === 'true' || value === '1') {
    return true;
  }

  if (value === 'false' || value === '0') {
    return false;
  }

  return fallback;
}

function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : null;
}

function normalizeInteger(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value)) {
      return null;
    }

    return BigInt(value);
  }

  const text = String(value).trim();

  if (!/^-?\d+$/.test(text)) {
    return null;
  }

  try {
    return BigInt(text);
  } catch {
    return null;
  }
}

function normalizeMoneyMinor(value) {
  const normalized = normalizeInteger(value);

  return normalized === null
    ? null
    : normalized.toString();
}

function normalizeTimestamp(value, fallback = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }

  if (value !== null && value !== undefined) {
    const date = new Date(value);

    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return fallback.toISOString();
}

function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some((pattern) =>
    pattern.test(String(key))
  );
}

function sanitizeMetadata(value) {
  if (!isPlainObject(value)) {
    return {};
  }

  const result = {};
  const entries = Object.entries(value).slice(0, LIMITS.MAX_METADATA_KEYS);

  for (const [rawKey, rawValue] of entries) {
    const key = boundedText(rawKey, LIMITS.MAX_KEY_LENGTH);

    if (!key || isSensitiveKey(key)) {
      continue;
    }

    if (
      rawValue === null ||
      typeof rawValue === 'boolean'
    ) {
      result[key] = rawValue;
      continue;
    }

    if (
      typeof rawValue === 'number' &&
      Number.isFinite(rawValue)
    ) {
      result[key] = rawValue;
      continue;
    }

    if (typeof rawValue === 'string') {
      result[key] = rawValue.slice(
        0,
        LIMITS.MAX_METADATA_VALUE_LENGTH
      );
      continue;
    }

    if (rawValue instanceof Date) {
      result[key] = rawValue.toISOString();
    }
  }

  return result;
}

function sanitizeArray(value, mapper, limit = LIMITS.MAX_ARRAY_ITEMS) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .slice(0, limit)
    .map(mapper)
    .filter(
      (item) => item !== null && item !== undefined
    );
}

function stableStringify(value) {
  if (value === undefined) {
    return 'null';
  }

  if (value === null) {
    return 'null';
  }

  if (typeof value === 'bigint') {
    return JSON.stringify(value.toString());
  }

  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value).sort();

    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${stableStringify(
            value[key]
          )}`
      )
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto
    .createHash('sha256')
    .update(stableStringify(value))
    .digest('hex');
}

function safePositiveInteger(value, fallback = 1) {
  const number = Number(value);

  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }

  return number;
}

function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, number));
}

/* -------------------------------------------------------------------------- */
/* Tenant / request context                                                   */
/* -------------------------------------------------------------------------- */

function resolveTenantId(input = {}, context = {}) {
  const candidates = [
    context.tenantId,
    context.tenant?.tenantId,
    context.tenant?.id,
    input.tenantId,
  ];

  const candidate = candidates.find(
    (value) =>
      value !== undefined &&
      value !== null &&
      String(value).trim() !== ''
  );

  return candidate ? String(candidate) : null;
}

function resolveCorrelationId(input = {}, context = {}) {
  return (
    normalizeId(
      input.correlationId ||
        input.requestId ||
        context.correlationId ||
        context.requestId
    ) || crypto.randomUUID()
  );
}

function requireTenant(input, context) {
  const tenantId = resolveTenantId(input, context);

  if (!tenantId) {
    const error = new Error(
      'Tenant context is required for feature-store operations.'
    );

    error.code = 'TENANT_REQUIRED';
    error.statusCode = 400;

    throw error;
  }

  return tenantId;
}

/* -------------------------------------------------------------------------- */
/* Feature value normalization                                                */
/* -------------------------------------------------------------------------- */

function inferFeatureType(value, explicitType) {
  if (explicitType) {
    const normalized = String(explicitType).toUpperCase();

    if (
      Object.values(FEATURE_TYPES).includes(normalized)
    ) {
      return normalized;
    }
  }

  if (typeof value === 'boolean') {
    return FEATURE_TYPES.BOOLEAN;
  }

  if (typeof value === 'bigint') {
    return FEATURE_TYPES.INTEGER;
  }

  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? FEATURE_TYPES.INTEGER
      : FEATURE_TYPES.NUMBER;
  }

  if (typeof value === 'string') {
    return FEATURE_TYPES.STRING;
  }

  return FEATURE_TYPES.STRING;
}

function normalizeFeatureValue(
  value,
  type,
  metadata = {}
) {
  switch (type) {
    case FEATURE_TYPES.BOOLEAN:
      return normalizeBoolean(value);

    case FEATURE_TYPES.INTEGER: {
      const integer = normalizeInteger(value);

      if (integer === null) {
        return null;
      }

      return integer.toString();
    }

    case FEATURE_TYPES.NUMBER:
      return normalizeNumber(value);

    case FEATURE_TYPES.MONEY_MINOR:
      return normalizeMoneyMinor(value);

    case FEATURE_TYPES.MONEY_DECIMAL: {
      if (value === null || value === undefined) {
        return null;
      }

      const decimal = String(value).trim();

      if (!/^-?\d+(?:\.\d+)?$/.test(decimal)) {
        return null;
      }

      return decimal;
    }

    case FEATURE_TYPES.TIMESTAMP:
      return normalizeTimestamp(value, new Date(0));

    case FEATURE_TYPES.CATEGORICAL:
      return boundedText(
        value,
        LIMITS.MAX_CATEGORY_LENGTH
      );

    case FEATURE_TYPES.STRING:
    default:
      return boundedText(
        value,
        LIMITS.MAX_STRING_LENGTH
      );
  }
}

function normalizeFeature(feature = {}, defaults = {}) {
  const key = boundedText(
    feature.key ||
      feature.name ||
      feature.featureName,
    LIMITS.MAX_KEY_LENGTH
  );

  if (!key || isSensitiveKey(key)) {
    return null;
  }

  const type = inferFeatureType(
    feature.value,
    feature.type
  );

  const value = normalizeFeatureValue(
    feature.value,
    type,
    feature.metadata
  );

  if (value === null || value === undefined) {
    return null;
  }

  const featureVersion =
    boundedText(
      feature.version ||
        defaults.featureVersion ||
        '1',
      LIMITS.MAX_VERSION_LENGTH
    ) || '1';

  const schema =
    boundedText(
      feature.schema ||
        defaults.schema ||
        'airtel.v1',
      LIMITS.MAX_SCHEMA_LENGTH
    ) || 'airtel.v1';

  return {
    key,
    type,
    value,
    featureVersion,
    schema,
    unit:
      boundedText(feature.unit, 40) || null,
    currency:
      type === FEATURE_TYPES.MONEY_MINOR ||
      type === FEATURE_TYPES.MONEY_DECIMAL
        ? normalizeCurrency(
            feature.currency ||
              defaults.currency
          )
        : null,
    source:
      boundedText(
        feature.source ||
          defaults.source ||
          SOURCE_TYPES.DERIVED,
        50
      )?.toUpperCase() ||
      SOURCE_TYPES.DERIVED,
    confidence:
      feature.confidence !== undefined &&
      feature.confidence !== null
        ? clamp(feature.confidence, 0, 1)
        : null,
    quality:
      boundedText(
        feature.quality ||
          defaults.quality ||
          QUALITY.UNKNOWN,
        30
      )?.toUpperCase() ||
      QUALITY.UNKNOWN,
    observedAt: normalizeTimestamp(
      feature.observedAt ||
        defaults.observedAt
    ),
    expiresAt: normalizeOptionalExpiry(
      feature.expiresAt ||
        defaults.expiresAt
    ),
    metadata: sanitizeMetadata(
      feature.metadata
    ),
  };
}

function normalizeOptionalExpiry(value) {
  if (value === null || value === undefined) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function normalizeFeatures(input = {}, context = {}) {
  const source =
    Array.isArray(input.features)
      ? input.features
      : Array.isArray(input.featureVector)
        ? input.featureVector
        : [];

  const defaults = {
    featureVersion:
      boundedText(
        input.featureVersion,
        LIMITS.MAX_VERSION_LENGTH
      ) || '1',
    schema:
      boundedText(
        input.schema,
        LIMITS.MAX_SCHEMA_LENGTH
      ) || 'airtel.v1',
    source:
      boundedText(
        input.source,
        50
      )?.toUpperCase() ||
      SOURCE_TYPES.DERIVED,
    currency:
      normalizeCurrency(input.currency),
    quality:
      boundedText(
        input.quality,
        30
      )?.toUpperCase() ||
      QUALITY.UNKNOWN,
    observedAt:
      normalizeTimestamp(
        input.observedAt
      ),
    expiresAt:
      normalizeOptionalExpiry(
        input.expiresAt
      ),
  };

  const features = [];
  const seen = new Set();

  for (const item of source.slice(0, LIMITS.MAX_FEATURES)) {
    const feature = normalizeFeature(
      item,
      defaults
    );

    if (!feature) {
      continue;
    }

    const identity = `${feature.key}:${feature.featureVersion}:${feature.schema}`;

    if (seen.has(identity)) {
      continue;
    }

    seen.add(identity);
    features.push(feature);
  }

  return features;
}

/* -------------------------------------------------------------------------- */
/* Freshness                                                                  */
/* -------------------------------------------------------------------------- */

function resolveMaxAge(options = {}) {
  const configured = Number(
    options.maxAgeMs
  );

  if (
    Number.isFinite(configured) &&
    configured > 0
  ) {
    return Math.min(
      configured,
      LIMITS.MAX_TTL_MS
    );
  }

  return LIMITS.DEFAULT_MAX_AGE_MS;
}

function evaluateFreshness(
  observedAt,
  expiresAt,
  options = {},
  now = new Date()
) {
  const observed =
    new Date(observedAt).getTime();

  const current =
    now instanceof Date
      ? now.getTime()
      : new Date(now).getTime();

  if (!Number.isFinite(observed)) {
    return {
      status: STATUS.INVALID,
      fresh: false,
      ageMs: null,
      stale: true,
      expired: false,
      reason: 'INVALID_OBSERVED_AT',
    };
  }

  const ageMs =
    Math.max(0, current - observed);

  if (
    expiresAt &&
    Number.isFinite(
      new Date(expiresAt).getTime()
    ) &&
    current >=
      new Date(expiresAt).getTime()
  ) {
    return {
      status: STATUS.EXPIRED,
      fresh: false,
      ageMs,
      stale: true,
      expired: true,
      reason: 'FEATURE_EXPIRED',
    };
  }

  const maxAgeMs =
    resolveMaxAge(options);

  if (ageMs > maxAgeMs) {
    return {
      status: STATUS.STALE,
      fresh: false,
      ageMs,
      stale: true,
      expired: false,
      reason: 'FEATURE_TOO_OLD',
    };
  }

  return {
    status: STATUS.ACTIVE,
    fresh: true,
    ageMs,
    stale: false,
    expired: false,
    reason: null,
  };
}

/* -------------------------------------------------------------------------- */
/* Feature-record construction                                                */
/* -------------------------------------------------------------------------- */

function normalizeFeatureGroup(value) {
  return (
    boundedText(
      value,
      LIMITS.MAX_FEATURE_GROUP_LENGTH
    ) || 'default'
  );
}

function buildFeatureRecord(
  input = {},
  context = {},
  options = {}
) {
  const tenantId =
    requireTenant(input, context);

  const correlationId =
    resolveCorrelationId(
      input,
      context
    );

  const provider =
    normalizeProvider(
      input.provider ||
        context.provider ||
        PROVIDER
    );

  const featureGroup =
    normalizeFeatureGroup(
      input.featureGroup ||
        input.group ||
        'default'
    );

  const features =
    normalizeFeatures(
      input,
      context
    );

  const observedAt =
    normalizeTimestamp(
      input.observedAt
    );

  const ttlMsRaw = Number(
    input.ttlMs ||
      options.ttlMs ||
      LIMITS.DEFAULT_TTL_MS
  );

  const ttlMs =
    Number.isFinite(ttlMsRaw) &&
    ttlMsRaw > 0
      ? Math.min(
          ttlMsRaw,
          LIMITS.MAX_TTL_MS
        )
      : LIMITS.DEFAULT_TTL_MS;

  const explicitExpiresAt =
    normalizeOptionalExpiry(
      input.expiresAt
    );

  const calculatedExpiry =
    explicitExpiresAt ||
    new Date(
      new Date(observedAt).getTime() +
        ttlMs
    ).toISOString();

  const featurePayload = {
    featureGroup,
    schema:
      boundedText(
        input.schema,
        LIMITS.MAX_SCHEMA_LENGTH
      ) || 'airtel.v1',
    featureVersion:
      boundedText(
        input.featureVersion,
        LIMITS.MAX_VERSION_LENGTH
      ) || '1',
    features,
  };

  const featureHash =
    fingerprint(
      featurePayload
    );

  const recordId =
    normalizeId(
      input.featureRecordId ||
        input.id ||
        input.recordId
    ) ||
    `feature:${tenantId}:${provider}:${featureGroup}:${featureHash}`;

  const createdAt =
    new Date().toISOString();

  const freshness =
    evaluateFreshness(
      observedAt,
      calculatedExpiry,
      options,
      new Date()
    );

  return {
    featureRecordId: recordId,
    tenantId,
    provider,
    featureGroup,
    schema: featurePayload.schema,
    featureVersion:
      featurePayload.featureVersion,
    featureHash,
    features,
    featureCount:
      features.length,
    observedAt,
    expiresAt:
      calculatedExpiry,
    status:
      freshness.status,
    freshness,
    source:
      boundedText(
        input.source,
        50
      )?.toUpperCase() ||
      SOURCE_TYPES.DERIVED,
    entityType:
      boundedText(
        input.entityType,
        50
      )?.toUpperCase() ||
      'UNKNOWN',
    entityId:
      normalizeId(
        input.entityId ||
          input.subjectId
      ),
    correlationId,
    idempotencyKey:
      normalizeId(
        input.idempotencyKey
      ),
    createdAt,
    updatedAt: createdAt,
    advisoryOnly: true,
    metadata:
      sanitizeMetadata(
        input.metadata
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Feature retrieval projection                                                */
/* -------------------------------------------------------------------------- */

function cloneFeature(feature) {
  if (!isPlainObject(feature)) {
    return feature;
  }

  return JSON.parse(
    JSON.stringify(
      feature,
      (_key, value) =>
        typeof value === 'bigint'
          ? value.toString()
          : value
    )
  );
}

function projectFeatureValue(
  feature,
  options = {}
) {
  if (!feature) {
    return null;
  }

  const projected = {
    key: feature.key,
    type: feature.type,
    value: feature.value,
    featureVersion:
      feature.featureVersion,
    schema:
      feature.schema,
    unit:
      feature.unit || null,
    currency:
      feature.currency || null,
    source:
      feature.source || null,
    confidence:
      feature.confidence ?? null,
    quality:
      feature.quality || QUALITY.UNKNOWN,
    observedAt:
      feature.observedAt,
    expiresAt:
      feature.expiresAt || null,
  };

  if (options.includeMetadata) {
    projected.metadata =
      sanitizeMetadata(
        feature.metadata
      );
  }

  return projected;
}

function projectFeatureRecord(
  record,
  options = {}
) {
  if (!record) {
    return null;
  }

  const features =
    Array.isArray(record.features)
      ? record.features
      : [];

  return {
    featureRecordId:
      normalizeId(
        record.featureRecordId ||
          record.id ||
          record._id
      ),
    tenantId:
      normalizeId(
        record.tenantId
      ),
    provider:
      normalizeProvider(
        record.provider
      ),
    featureGroup:
      normalizeFeatureGroup(
        record.featureGroup
      ),
    schema:
      boundedText(
        record.schema,
        LIMITS.MAX_SCHEMA_LENGTH
      ),
    featureVersion:
      boundedText(
        record.featureVersion,
        LIMITS.MAX_VERSION_LENGTH
      ),
    featureHash:
      normalizeId(
        record.featureHash
      ),
    featureCount:
      safePositiveInteger(
        record.featureCount,
        features.length
      ),
    status:
      boundedText(
        record.status,
        30
      )?.toUpperCase() ||
      STATUS.INVALID,
    observedAt:
      normalizeTimestamp(
        record.observedAt
      ),
    expiresAt:
      normalizeOptionalExpiry(
        record.expiresAt
      ),
    source:
      boundedText(
        record.source,
        50
      )?.toUpperCase() ||
      SOURCE_TYPES.DERIVED,
    entityType:
      boundedText(
        record.entityType,
        50
      )?.toUpperCase() ||
      'UNKNOWN',
    entityId:
      normalizeId(
        record.entityId
      ),
    correlationId:
      normalizeId(
        record.correlationId
      ),
    features: features
      .slice(0, LIMITS.MAX_FEATURES)
      .map((feature) =>
        projectFeatureValue(
          feature,
          options
        )
      )
      .filter(Boolean),
    freshness:
      record.freshness || null,
    advisoryOnly: true,
    metadata:
      options.includeMetadata
        ? sanitizeMetadata(
            record.metadata
          )
        : undefined,
    createdAt:
      normalizeTimestamp(
        record.createdAt
      ),
    updatedAt:
      normalizeTimestamp(
        record.updatedAt
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Schema management                                                          */
/* -------------------------------------------------------------------------- */

function normalizeSchemaDefinition(
  input = {}
) {
  const schema =
    boundedText(
      input.schema,
      LIMITS.MAX_SCHEMA_LENGTH
    ) || 'airtel.v1';

  const version =
    boundedText(
      input.version ||
        input.featureVersion,
      LIMITS.MAX_VERSION_LENGTH
    ) || '1';

  const featureDefinitions =
    sanitizeArray(
      input.features ||
        input.featureDefinitions,
      (definition) => {
        const key =
          boundedText(
            definition.key ||
              definition.name,
            LIMITS.MAX_KEY_LENGTH
          );

        if (!key || isSensitiveKey(key)) {
          return null;
        }

        const type =
          inferFeatureType(
            definition.exampleValue,
            definition.type
          );

        return {
          key,
          type,
          required:
            normalizeBoolean(
              definition.required,
              false
            ),
          description:
            boundedText(
              definition.description,
              500
            ),
          unit:
            boundedText(
              definition.unit,
              40
            ),
          currency:
            normalizeCurrency(
              definition.currency
            ),
          min:
            normalizeNumber(
              definition.min
            ),
          max:
            normalizeNumber(
              definition.max
            ),
          allowedValues:
            sanitizeArray(
              definition.allowedValues,
              (value) =>
                boundedText(
                  value,
                  LIMITS.MAX_CATEGORY_LENGTH
                ),
              100
            ),
        };
      },
      LIMITS.MAX_FEATURES
    );

  return {
    schema,
    version,
    provider:
      normalizeProvider(
        input.provider
      ),
    featureGroup:
      normalizeFeatureGroup(
        input.featureGroup
      ),
    definitions: featureDefinitions,
    schemaHash:
      fingerprint({
        schema,
        version,
        featureDefinitions,
      }),
    createdAt:
      new Date().toISOString(),
    advisoryOnly: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Repository adapter                                                         */
/* -------------------------------------------------------------------------- */

function createRepositoryAdapter(
  repository
) {
  if (!repository) {
    return null;
  }

  const adapter = {};

  if (typeof repository.create === 'function') {
    adapter.create =
      repository.create.bind(
        repository
      );
  }

  if (typeof repository.insert === 'function') {
    adapter.insert =
      repository.insert.bind(
        repository
      );
  }

  if (typeof repository.upsert === 'function') {
    adapter.upsert =
      repository.upsert.bind(
        repository
      );
  }

  if (typeof repository.update === 'function') {
    adapter.update =
      repository.update.bind(
        repository
      );
  }

  if (typeof repository.findOne === 'function') {
    adapter.findOne =
      repository.findOne.bind(
        repository
      );
  }

  if (typeof repository.findById === 'function') {
    adapter.findById =
      repository.findById.bind(
        repository
      );
  }

  if (typeof repository.find === 'function') {
    adapter.find =
      repository.find.bind(
        repository
      );
  }

  if (typeof repository.list === 'function') {
    adapter.list =
      repository.list.bind(
        repository
      );
  }

  if (typeof repository.bulkWrite === 'function') {
    adapter.bulkWrite =
      repository.bulkWrite.bind(
        repository
      );
  }

  return adapter;
}

/* -------------------------------------------------------------------------- */
/* Main service                                                               */
/* -------------------------------------------------------------------------- */

class FeatureStore {
  constructor(options = {}) {
    this.name =
      'AirtelIntelligenceFeatureStore';

    this.provider =
      normalizeProvider(
        options.provider ||
          PROVIDER
      );

    this.repository =
      createRepositoryAdapter(
        options.repository ||
          options.repositories
            ?.featureStore ||
          null
      );

    this.schemaRepository =
      createRepositoryAdapter(
        options.schemaRepository ||
          options.repositories
            ?.featureSchema ||
          null
      );

    this.eventBus =
      options.eventBus ||
      options.events ||
      options.outbox ||
      null;

    this.auditLogger =
      options.auditLogger ||
      options.audit ||
      null;

    this.logger =
      options.logger ||
      console;

    this.clock =
      typeof options.clock === 'function'
        ? options.clock
        : () => new Date();

    this.defaultTtlMs =
      Number.isFinite(
        Number(options.defaultTtlMs)
      )
        ? Math.min(
            Math.max(
              Number(
                options.defaultTtlMs
              ),
              1
            ),
            LIMITS.MAX_TTL_MS
          )
        : LIMITS.DEFAULT_TTL_MS;

    this.initialized = false;
    this.initializingPromise = null;

    this.metrics = {
      writes: 0,
      reads: 0,
      batchWrites: 0,
      batchReads: 0,
      staleReads: 0,
      expiredReads: 0,
      invalidFeatures: 0,
      persistenceFailures: 0,
      schemaWrites: 0,
      schemaFailures: 0,
      eventFailures: 0,
      auditFailures: 0,
    };
  }

  async initialize(context = {}) {
    if (this.initialized) {
      return this.getHealth();
    }

    if (this.initializingPromise) {
      return this.initializingPromise;
    }

    this.initializingPromise =
      (async () => {
        const repositories = [
          this.repository,
          this.schemaRepository,
        ];

        for (const repository of repositories) {
          if (
            repository &&
            typeof repository.initialize ===
              'function'
          ) {
            await repository.initialize(
              context
            );
          }
        }

        this.initialized = true;

        return this.getHealth();
      })()
        .catch((error) => {
          this.initialized = false;
          throw error;
        })
        .finally(() => {
          this.initializingPromise = null;
        });

    return this.initializingPromise;
  }

  async destroy(context = {}) {
    const repositories = [
      this.schemaRepository,
      this.repository,
    ];

    for (const repository of repositories) {
      try {
        if (
          repository &&
          typeof repository.destroy ===
            'function'
        ) {
          await repository.destroy(
            context
          );
        }
      } catch (error) {
        this.logger.warn?.(
          {
            err: error,
            service: this.name,
          },
          'Feature store dependency shutdown failed'
        );
      }
    }

    this.initialized = false;
  }

  validateFeatureRecord(
    input,
    context = {}
  ) {
    const record =
      buildFeatureRecord(
        input,
        context,
        {
          ttlMs:
            this.defaultTtlMs,
        }
      );

    const errors = [];

    if (!record.features.length) {
      errors.push(
        'At least one valid feature is required.'
      );
    }

    if (
      record.features.length >
      LIMITS.MAX_FEATURES
    ) {
      errors.push(
        `Feature count exceeds ${LIMITS.MAX_FEATURES}.`
      );
    }

    for (const feature of record.features) {
      if (
        feature.type ===
          FEATURE_TYPES.MONEY_MINOR &&
        !feature.currency
      ) {
        errors.push(
          `Money feature "${feature.key}" requires a currency.`
        );
      }

      if (
        feature.confidence !== null &&
        (!Number.isFinite(
          feature.confidence
        ) ||
          feature.confidence < 0 ||
          feature.confidence > 1)
      ) {
        errors.push(
          `Feature "${feature.key}" has invalid confidence.`
        );
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      record,
    };
  }

  async put(input = {}, context = {}) {
    const tenantId =
      requireTenant(input, context);

    const correlationId =
      resolveCorrelationId(
        input,
        context
      );

    const validation =
      this.validateFeatureRecord(
        input,
        {
          ...context,
          tenantId,
          correlationId,
        }
      );

    if (!validation.valid) {
      this.metrics.invalidFeatures +=
        1;

      const error = new Error(
        validation.errors.join(' ')
      );

      error.code =
        'INVALID_FEATURE_RECORD';
      error.details = validation.errors;
      throw error;
    }

    const record =
      validation.record;

    if (!this.repository) {
      const error = new Error(
        'Feature store repository is not configured.'
      );

      error.code =
        'FEATURE_STORE_REPOSITORY_UNAVAILABLE';
      throw error;
    }

    const idempotencyKey =
      normalizeId(
        input.idempotencyKey
      );

    try {
      if (
        idempotencyKey &&
        typeof this.repository.findOne ===
          'function'
      ) {
        const existing =
          await this.repository.findOne(
            {
              tenantId,
              idempotencyKey,
            },
            {
              ...context,
              tenantId,
              correlationId,
            }
          );

        if (existing) {
          this.metrics.reads += 1;

          return {
            record:
              projectFeatureRecord(
                existing
              ),
            persisted: true,
            idempotentReplay: true,
            correlationId,
          };
        }
      }

      let persisted;

      if (
        typeof this.repository.upsert ===
        'function'
      ) {
        persisted =
          await this.repository.upsert(
            {
              tenantId,
              featureRecordId:
                record.featureRecordId,
            },
            record,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else if (
        typeof this.repository.create ===
        'function'
      ) {
        persisted =
          await this.repository.create(
            record,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else if (
        typeof this.repository.insert ===
        'function'
      ) {
        persisted =
          await this.repository.insert(
            record,
            {
              ...context,
              tenantId,
              correlationId,
            }
          );
      } else {
        const error = new Error(
          'Feature store repository does not support persistence.'
        );

        error.code =
          'UNSUPPORTED_REPOSITORY_INTERFACE';

        throw error;
      }

      this.metrics.writes += 1;

      const projected =
        projectFeatureRecord(
          persisted || record
        );

      await this.emitFeatureEvent(
        'airtel.featureStore.put',
        projected,
        context
      );

      await this.audit(
        'AIRTEL_FEATURE_STORE_PUT',
        projected,
        context
      );

      return {
        record: projected,
        persisted: true,
        idempotentReplay: false,
        correlationId,
      };
    } catch (error) {
      this.metrics.persistenceFailures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          correlationId,
        },
        'Airtel feature store write failed'
      );

      throw error;
    }
  }

  async putBatch(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(input, context);

    const records =
      Array.isArray(
        input.records
      )
        ? input.records
        : Array.isArray(
            input.features
          )
          ? input.features
          : [];

    if (!records.length) {
      return {
        tenantId,
        inserted: [],
        failed: [],
        count: 0,
      };
    }

    const boundedRecords =
      records.slice(
        0,
        LIMITS.MAX_BATCH
      );

    if (
      typeof this.repository
        ?.bulkWrite ===
      'function'
    ) {
      const normalized = [];
      const failures = [];

      for (const recordInput of boundedRecords) {
        try {
          const validation =
            this.validateFeatureRecord(
              {
                ...recordInput,
                tenantId,
              },
              context
            );

          if (!validation.valid) {
            throw new Error(
              validation.errors.join(
                ' '
              )
            );
          }

          normalized.push(
            validation.record
          );
        } catch (error) {
          failures.push({
            input:
              sanitizeMetadata(
                recordInput
              ),
            error: {
              code:
                error.code ||
                'INVALID_FEATURE_RECORD',
              message:
                boundedText(
                  error.message,
                  500
                ),
            },
          });
        }
      }

      if (!normalized.length) {
        return {
          tenantId,
          inserted: [],
          failed: failures,
          count: 0,
        };
      }

      try {
        const bulkResult =
          await this.repository.bulkWrite(
            normalized,
            {
              tenantId,
              ...context,
            }
          );

        this.metrics.batchWrites += 1;
        this.metrics.writes +=
          normalized.length;

        return {
          tenantId,
          inserted:
            Array.isArray(
              bulkResult?.items
            )
              ? bulkResult.items.map(
                  (item) =>
                    projectFeatureRecord(
                      item
                    )
                )
              : normalized.map(
                  (item) =>
                    projectFeatureRecord(
                      item
                    )
                ),
          failed: failures,
          count: normalized.length,
          repositoryResult:
            sanitizeRepositoryResult(
              bulkResult
            ),
        };
      } catch (error) {
        this.metrics.persistenceFailures +=
          1;

        this.logger.error?.(
          {
            err: error,
            tenantId,
          },
          'Airtel feature-store batch persistence failed'
        );

        throw error;
      }
    }

    const inserted = [];
    const failed = [];

    for (const recordInput of boundedRecords) {
      try {
        const result =
          await this.put(
            {
              ...recordInput,
              tenantId,
            },
            context
          );

        inserted.push(
          result.record
        );
      } catch (error) {
        failed.push({
          error: {
            code:
              error.code ||
              'FEATURE_WRITE_FAILED',
            message:
              boundedText(
                error.message,
                500
              ),
          },
        });
      }
    }

    this.metrics.batchWrites += 1;

    return {
      tenantId,
      inserted,
      failed,
      count: inserted.length,
    };
  }

  async get(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const featureRecordId =
      normalizeId(
        input.featureRecordId ||
          input.id ||
          input.recordId
      );

    if (!featureRecordId) {
      const error = new Error(
        'featureRecordId is required.'
      );

      error.code =
        'FEATURE_RECORD_ID_REQUIRED';

      throw error;
    }

    if (!this.repository) {
      return null;
    }

    let result = null;

    if (
      typeof this.repository
        .findOne ===
      'function'
    ) {
      result =
        await this.repository.findOne(
          {
            tenantId,
            featureRecordId,
          },
          {
            ...context,
            tenantId,
          }
        );
    } else if (
      typeof this.repository
        .findById ===
      'function'
    ) {
      result =
        await this.repository.findById(
          featureRecordId,
          {
            ...context,
            tenantId,
          }
        );
    }

    this.metrics.reads += 1;

    if (!result) {
      return null;
    }

    const projected =
      projectFeatureRecord(
        result,
        {
          includeMetadata:
            Boolean(
              input.includeMetadata
            ),
        }
      );

    return this.applyFreshness(
      projected,
      input
    );
  }

  async getLatest(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    if (!this.repository) {
      return null;
    }

    const query = {
      tenantId,
      provider:
        normalizeProvider(
          input.provider ||
            this.provider
        ),
      featureGroup:
        normalizeFeatureGroup(
          input.featureGroup
        ),
      schema:
        boundedText(
          input.schema,
          LIMITS.MAX_SCHEMA_LENGTH
        ) || undefined,
      featureVersion:
        boundedText(
          input.featureVersion,
          LIMITS.MAX_VERSION_LENGTH
        ) || undefined,
      entityType:
        boundedText(
          input.entityType,
          50
        )?.toUpperCase() ||
        undefined,
      entityId:
        normalizeId(
          input.entityId
        ) || undefined,
    };

    deleteUndefinedProperties(
      query
    );

    let result = null;

    if (
      typeof this.repository.findOne ===
      'function'
    ) {
      result =
        await this.repository.findOne(
          query,
          {
            ...context,
            tenantId,
            sort: {
              observedAt: -1,
              createdAt: -1,
            },
          }
        );
    } else if (
      typeof this.repository.list ===
      'function'
    ) {
      const response =
        await this.repository.list(
          {
            ...query,
            limit: 1,
            page: 1,
          },
          {
            ...context,
            tenantId,
          }
        );

      result =
        Array.isArray(
          response?.items
        )
          ? response.items[0] ||
            null
          : Array.isArray(response)
            ? response[0] ||
              null
            : null;
    }

    this.metrics.reads += 1;

    if (!result) {
      return null;
    }

    const projected =
      projectFeatureRecord(
        result,
        {
          includeMetadata:
            Boolean(
              input.includeMetadata
            ),
        }
      );

    return this.applyFreshness(
      projected,
      input
    );
  }

  async getByEntity(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const entityId =
      normalizeId(
        input.entityId
      );

    if (!entityId) {
      const error = new Error(
        'entityId is required.'
      );

      error.code =
        'ENTITY_ID_REQUIRED';

      throw error;
    }

    if (
      !this.repository
    ) {
      return {
        items: [],
        total: 0,
      };
    }

    const query = {
      tenantId,
      provider:
        normalizeProvider(
          input.provider ||
            this.provider
        ),
      entityId,
      entityType:
        boundedText(
          input.entityType,
          50
        )?.toUpperCase() ||
        undefined,
      featureGroup:
        input.featureGroup
          ? normalizeFeatureGroup(
              input.featureGroup
            )
          : undefined,
    };

    deleteUndefinedProperties(
      query
    );

    return this.list(
      {
        ...input,
        tenantId,
        query,
      },
      context
    );
  }

  async list(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    if (!this.repository) {
      return {
        items: [],
        total: 0,
        page: 1,
        pageSize: 0,
      };
    }

    const page =
      safePositiveInteger(
        input.page,
        1
      );

    const pageSize =
      Math.min(
        safePositiveInteger(
          input.pageSize ||
            input.limit,
          25
        ),
        LIMITS.MAX_READ_LIMIT
      );

    const query = isPlainObject(
      input.query
    )
      ? {
          ...input.query,
          tenantId,
        }
      : {
          tenantId,
        };

    // The authoritative tenantId always wins.
    query.tenantId =
      tenantId;

    delete query.tenant;
    delete query.tenantContext;

    deleteUndefinedProperties(
      query
    );

    let result;

    if (
      typeof this.repository.list ===
      'function'
    ) {
      result =
        await this.repository.list(
          {
            ...query,
            page,
            pageSize,
          },
          {
            ...context,
            tenantId,
          }
        );
    } else if (
      typeof this.repository.find ===
      'function'
    ) {
      result =
        await this.repository.find(
          {
            ...query,
            page,
            pageSize,
          },
          {
            ...context,
            tenantId,
          }
        );
    } else {
      result = [];
    }

    this.metrics.reads += 1;

    const normalized =
      normalizeListResult(
        result,
        page,
        pageSize
      );

    const items =
      normalized.items.map(
        (item) =>
          this.applyFreshness(
            projectFeatureRecord(
              item,
              {
                includeMetadata:
                  Boolean(
                    input.includeMetadata
                  ),
              }
            ),
            input
          )
      );

    this.metrics.batchReads += 1;

    return {
      ...normalized,
      items,
      tenantId,
    };
  }

  applyFreshness(
    record,
    options = {}
  ) {
    if (!record) {
      return null;
    }

    const freshness =
      evaluateFreshness(
        record.observedAt,
        record.expiresAt,
        options,
        this.clock()
      );

    const enriched = {
      ...record,
      status:
        freshness.status,
      freshness,
    };

    if (
      freshness.status ===
      STATUS.STALE
    ) {
      this.metrics.staleReads += 1;
    }

    if (
      freshness.status ===
      STATUS.EXPIRED
    ) {
      this.metrics.expiredReads += 1;
    }

    return enriched;
  }

  async delete(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const featureRecordId =
      normalizeId(
        input.featureRecordId ||
          input.id
      );

    if (!featureRecordId) {
      const error = new Error(
        'featureRecordId is required.'
      );

      error.code =
        'FEATURE_RECORD_ID_REQUIRED';

      throw error;
    }

    if (
      !this.repository
    ) {
      const error = new Error(
        'Feature store repository is not configured.'
      );

      error.code =
        'FEATURE_STORE_REPOSITORY_UNAVAILABLE';

      throw error;
    }

    const query = {
      tenantId,
      featureRecordId,
    };

    let result = null;

    if (
      typeof this.repository.update ===
      'function'
    ) {
      result =
        await this.repository.update(
          query,
          {
            status:
              STATUS.DISABLED,
            updatedAt:
              this.clock().toISOString(),
          },
          {
            ...context,
            tenantId,
          }
        );
    } else {
      const error = new Error(
        'Feature store repository does not support logical disable.'
      );

      error.code =
        'UNSUPPORTED_REPOSITORY_INTERFACE';

      throw error;
    }

    return {
      disabled: true,
      tenantId,
      featureRecordId,
      result:
        sanitizeRepositoryResult(
          result
        ),
    };
  }

  async registerSchema(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    if (
      !this.schemaRepository
    ) {
      const error = new Error(
        'Feature schema repository is not configured.'
      );

      error.code =
        'SCHEMA_REPOSITORY_UNAVAILABLE';

      throw error;
    }

    const schema =
      normalizeSchemaDefinition(
        input
      );

    const record = {
      ...schema,
      tenantId,
      advisoryOnly: true,
      updatedAt:
        this.clock().toISOString(),
    };

    try {
      let result;

      if (
        typeof this.schemaRepository.upsert ===
        'function'
      ) {
        result =
          await this.schemaRepository.upsert(
            {
              tenantId,
              schema:
                schema.schema,
              version:
                schema.version,
            },
            record,
            {
              ...context,
              tenantId,
            }
          );
      } else if (
        typeof this.schemaRepository.create ===
        'function'
      ) {
        result =
          await this.schemaRepository.create(
            record,
            {
              ...context,
              tenantId,
            }
          );
      } else {
        const error = new Error(
          'Feature schema repository does not support persistence.'
        );

        error.code =
          'UNSUPPORTED_SCHEMA_REPOSITORY';

        throw error;
      }

      this.metrics.schemaWrites += 1;

      return {
        schema:
          sanitizeSchema(
            result || record
          ),
        persisted: true,
      };
    } catch (error) {
      this.metrics.schemaFailures +=
        1;

      this.logger.error?.(
        {
          err: error,
          tenantId,
          schema:
            schema.schema,
          version:
            schema.version,
        },
        'Airtel feature schema registration failed'
      );

      throw error;
    }
  }

  async getSchema(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const schema =
      boundedText(
        input.schema,
        LIMITS.MAX_SCHEMA_LENGTH
      );

    const version =
      boundedText(
        input.version ||
          input.featureVersion,
        LIMITS.MAX_VERSION_LENGTH
      );

    if (!schema) {
      const error = new Error(
        'schema is required.'
      );

      error.code =
        'SCHEMA_REQUIRED';

      throw error;
    }

    if (
      !this.schemaRepository
    ) {
      return null;
    }

    const query = {
      tenantId,
      schema,
    };

    if (version) {
      query.version =
        version;
    }

    let result = null;

    if (
      typeof this.schemaRepository.findOne ===
      'function'
    ) {
      result =
        await this.schemaRepository.findOne(
          query,
          {
            ...context,
            tenantId,
          }
        );
    } else if (
      typeof this.schemaRepository.findById ===
      'function' &&
      version
    ) {
      result =
        await this.schemaRepository.findById(
          `${schema}:${version}`,
          {
            ...context,
            tenantId,
          }
        );
    }

    return sanitizeSchema(
      result
    );
  }

  async purgeExpired(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const now =
      this.clock().toISOString();

    if (
      !this.repository
    ) {
      return {
        tenantId,
        purged: 0,
      };
    }

    const query = {
      tenantId,
      expiresAt: {
        $lte: now,
      },
    };

    let result;

    if (
      typeof this.repository.update ===
      'function'
    ) {
      result =
        await this.repository.update(
          query,
          {
            status:
              STATUS.EXPIRED,
            updatedAt:
              now,
          },
          {
            ...context,
            tenantId,
          }
        );
    } else {
      return {
        tenantId,
        purged: 0,
        supported: false,
      };
    }

    const affected =
      Number.isFinite(
        Number(
          result?.modifiedCount
        )
      )
        ? Number(
            result.modifiedCount
          )
        : Number.isFinite(
              Number(
                result?.count
              )
            )
          ? Number(result.count)
          : 0;

    return {
      tenantId,
      purged:
        Math.max(0, affected),
      supported: true,
    };
  }

  async statistics(
    input = {},
    context = {}
  ) {
    const tenantId =
      requireTenant(
        input,
        context
      );

    const result =
      await this.list(
        {
          ...input,
          tenantId,
          page: 1,
          pageSize:
            Math.min(
              input.pageSize ||
                LIMITS.MAX_READ_LIMIT,
              LIMITS.MAX_READ_LIMIT
            ),
        },
        context
      );

    const items =
      Array.isArray(
        result.items
      )
        ? result.items
        : [];

    const stats = {
      tenantId,
      provider:
        normalizeProvider(
          input.provider ||
            this.provider
        ),
      totalRecords:
        items.length,
      byStatus: {},
      bySource: {},
      byQuality: {},
      featureCount: 0,
      staleCount: 0,
      expiredCount: 0,
      distinctFeatureKeys: 0,
      distinctSchemas: 0,
      distinctVersions: 0,
    };

    const featureKeys =
      new Set();
    const schemas =
      new Set();
    const versions =
      new Set();

    for (const item of items) {
      const status =
        item.status ||
        STATUS.INVALID;

      const source =
        item.source ||
        SOURCE_TYPES.DERIVED;

      stats.byStatus[status] =
        (stats.byStatus[status] || 0) + 1;

      stats.bySource[source] =
        (stats.bySource[source] || 0) + 1;

      if (
        item.status ===
        STATUS.STALE
      ) {
        stats.staleCount += 1;
      }

      if (
        item.status ===
        STATUS.EXPIRED
      ) {
        stats.expiredCount += 1;
      }

      schemas.add(
        item.schema
      );

      versions.add(
        item.featureVersion
      );

      for (const feature of
        item.features || []) {
        stats.featureCount += 1;
        featureKeys.add(
          feature.key
        );

        if (feature.quality) {
          const quality =
            feature.quality;

          stats.byQuality[
            quality
          ] =
            (stats.byQuality[
              quality
            ] || 0) + 1;
        }
      }
    }

    stats.distinctFeatureKeys =
      featureKeys.size;
    stats.distinctSchemas =
      schemas.size;
    stats.distinctVersions =
      versions.size;

    return stats;
  }

  async emitFeatureEvent(
    type,
    record,
    context = {}
  ) {
    if (!this.eventBus) {
      return {
        emitted: false,
        reason:
          'EVENT_BUS_UNAVAILABLE',
      };
    }

    const envelope = {
      eventId:
        crypto.randomUUID(),
      type,
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        record.tenantId,
      provider:
        record.provider,
      correlationId:
        record.correlationId,
      advisoryOnly: true,
      payload: {
        featureRecordId:
          record.featureRecordId,
        featureGroup:
          record.featureGroup,
        schema:
          record.schema,
        featureVersion:
          record.featureVersion,
        featureHash:
          record.featureHash,
        featureCount:
          record.featureCount,
        status:
          record.status,
        source:
          record.source,
        entityType:
          record.entityType,
        entityId:
          record.entityId,
      },
      metadata:
        sanitizeMetadata(
          context.metadata
        ),
    };

    try {
      if (
        typeof this.eventBus.publish ===
        'function'
      ) {
        await this.eventBus.publish(
          type,
          envelope
        );

        return {
          emitted: true,
        };
      }

      if (
        typeof this.eventBus.emit ===
        'function'
      ) {
        await Promise.resolve(
          this.eventBus.emit(
            type,
            envelope
          )
        );

        return {
          emitted: true,
        };
      }

      return {
        emitted: false,
        reason:
          'UNSUPPORTED_EVENT_BUS',
      };
    } catch (error) {
      this.metrics.eventFailures +=
        1;

      this.logger.warn?.(
        {
          err: error,
          type,
          tenantId:
            record.tenantId,
          featureRecordId:
            record.featureRecordId,
        },
        'Airtel feature-store event publication failed'
      );

      return {
        emitted: false,
        reason:
          'EVENT_PUBLICATION_FAILED',
      };
    }
  }

  async audit(
    action,
    record,
    context = {}
  ) {
    if (!this.auditLogger) {
      return {
        recorded: false,
        reason:
          'AUDIT_UNAVAILABLE',
      };
    }

    const entry = {
      action,
      occurredAt:
        this.clock().toISOString(),
      tenantId:
        record.tenantId,
      provider:
        record.provider,
      correlationId:
        record.correlationId,
      featureRecordId:
        record.featureRecordId,
      featureGroup:
        record.featureGroup,
      schema:
        record.schema,
      featureVersion:
        record.featureVersion,
      featureHash:
        record.featureHash,
      featureCount:
        record.featureCount,
      status:
        record.status,
      advisoryOnly: true,
      metadata:
        sanitizeMetadata(
          context.metadata
        ),
    };

    try {
      if (
        typeof this.auditLogger.record ===
        'function'
      ) {
        await this.auditLogger.record(
          entry
        );

        return {
          recorded: true,
        };
      }

      if (
        typeof this.auditLogger.log ===
        'function'
      ) {
        await this.auditLogger.log(
          entry
        );

        return {
          recorded: true,
        };
      }

      if (
        typeof this.auditLogger.write ===
        'function'
      ) {
        await this.auditLogger.write(
          entry
        );

        return {
          recorded: true,
        };
      }

      return {
        recorded: false,
        reason:
          'UNSUPPORTED_AUDIT_INTERFACE',
      };
    } catch (error) {
      this.metrics.auditFailures +=
        1;

      this.logger.warn?.(
        {
          err: error,
          action,
          tenantId:
            record.tenantId,
          featureRecordId:
            record.featureRecordId,
        },
        'Airtel feature-store audit write failed'
      );

      return {
        recorded: false,
        reason:
          'AUDIT_WRITE_FAILED',
      };
    }
  }

  getHealth() {
    const repositoryAvailable =
      Boolean(
        this.repository
      );

    const schemaRepositoryAvailable =
      Boolean(
        this.schemaRepository
      );

    let status =
      repositoryAvailable
        ? 'UP'
        : 'DEGRADED';

    const degradedReasons =
      [];

    if (!repositoryAvailable) {
      degradedReasons.push(
        'Feature repository is not configured.'
      );
    }

    if (!schemaRepositoryAvailable) {
      degradedReasons.push(
        'Feature schema repository is not configured.'
      );
    }

    if (!this.initialized) {
      status = 'DEGRADED';

      degradedReasons.push(
        'Feature store has not been initialized.'
      );
    }

    if (
      this.metrics.persistenceFailures >
      0
    ) {
      status = 'DEGRADED';

      degradedReasons.push(
        'Feature persistence failures have been observed.'
      );
    }

    return {
      service: this.name,
      provider: this.provider,
      status,
      initialized:
        this.initialized,
      advisoryOnly: true,
      authoritative: false,
      financialAuthority: false,
      ledgerAuthority: false,
      settlementAuthority: false,
      paymentAuthority: false,
      complianceAuthority: false,
      dependencies: {
        featureRepository:
          repositoryAvailable,
        schemaRepository:
          schemaRepositoryAvailable,
        eventBus:
          Boolean(this.eventBus),
        auditLogger:
          Boolean(
            this.auditLogger
          ),
      },
      degradedReasons,
      metrics: {
        ...this.metrics,
      },
      checkedAt:
        this.clock().toISOString(),
    };
  }

  health() {
    return this.getHealth();
  }

  diagnostics() {
    return {
      service: this.name,
      provider: this.provider,
      module:
        'airtel.intelligence.featureStore',
      architecture: {
        tenantAware: true,
        boundedPayloads: true,
        exactMoneySupport: true,
        bigintMoneyRepresentation: true,
        versionedFeatures: true,
        schemaSupport: true,
        staleDetection: true,
        expirySupport: true,
        deterministicFingerprinting:
          true,
        idempotencySupport:
          true,
        advisoryOnly: true,
        paymentAuthority: false,
        ledgerAuthority: false,
        settlementAuthority:
          false,
        financialAuthority:
          false,
        complianceAuthority:
          false,
      },
      limits: {
        ...LIMITS,
      },
      metrics: {
        ...this.metrics,
      },
      health:
        this.getHealth(),
    };
  }

  capabilities() {
    return {
      put: true,
      putBatch: true,
      get: true,
      getLatest: true,
      getByEntity: true,
      list: true,
      delete: true,
      registerSchema: true,
      getSchema: true,
      purgeExpired: true,
      statistics: true,
      freshnessDetection: true,
      featureFingerprinting: true,
      versioning: true,
      tenantIsolation: true,
      exactMoneyRepresentation: true,
      advisoryOnly: true,
      paymentExecution: false,
      paymentAuthorization: false,
      ledgerMutation: false,
      balanceMutation: false,
      settlement: false,
      reconciliationAuthority: false,
      fraudBlocking: false,
      complianceDecisioning: false,
      providerHttp: false,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Result helpers                                                             */
/* -------------------------------------------------------------------------- */

function deleteUndefinedProperties(object) {
  for (const key of Object.keys(object)) {
    if (object[key] === undefined) {
      delete object[key];
    }
  }

  return object;
}

function normalizeListResult(
  result,
  page,
  pageSize
) {
  if (Array.isArray(result)) {
    return {
      items: result,
      total: result.length,
      page,
      pageSize,
    };
  }

  if (!isPlainObject(result)) {
    return {
      items: [],
      total: 0,
      page,
      pageSize,
    };
  }

  const items =
    Array.isArray(
      result.items
    )
      ? result.items
      : Array.isArray(
          result.rows
        )
        ? result.rows
        : Array.isArray(
            result.results
          )
          ? result.results
          : [];

  const total =
    Number.isFinite(
      Number(result.total)
    )
      ? Math.max(
          0,
          Number(result.total)
        )
      : items.length;

  return {
    ...result,
    items,
    total,
    page:
      safePositiveInteger(
        result.page,
        page
      ),
    pageSize:
      safePositiveInteger(
        result.pageSize,
        pageSize
      ),
  };
}

function sanitizeRepositoryResult(
  result
) {
  if (
    result === null ||
    result === undefined
  ) {
    return null;
  }

  if (
    typeof result ===
      'string' ||
    typeof result ===
      'number' ||
    typeof result ===
      'boolean'
  ) {
    return result;
  }

  if (Array.isArray(result)) {
    return {
      count:
        result.length,
    };
  }

  if (isPlainObject(result)) {
    const safe = {};

    for (const [
      key,
      value,
    ] of Object.entries(
      result
    ).slice(0, 30)) {
      if (
        isSensitiveKey(key)
      ) {
        continue;
      }

      if (
        typeof value ===
          'string' ||
        typeof value ===
          'number' ||
        typeof value ===
          'boolean' ||
        value === null
      ) {
        safe[
          boundedText(
            key,
            100
          )
        ] = value;
      }
    }

    return safe;
  }

  return null;
}

function sanitizeSchema(
  schema
) {
  if (!schema) {
    return null;
  }

  return {
    schema:
      boundedText(
        schema.schema,
        LIMITS.MAX_SCHEMA_LENGTH
      ),
    version:
      boundedText(
        schema.version ||
          schema.featureVersion,
        LIMITS.MAX_VERSION_LENGTH
      ),
    provider:
      normalizeProvider(
        schema.provider
      ),
    featureGroup:
      normalizeFeatureGroup(
        schema.featureGroup
      ),
    definitions:
      sanitizeArray(
        schema.definitions ||
          schema.features,
        (definition) => ({
          key:
            boundedText(
              definition.key,
              LIMITS.MAX_KEY_LENGTH
            ),
          type:
            boundedText(
              definition.type,
              40
            )?.toUpperCase() ||
            FEATURE_TYPES.STRING,
          required:
            normalizeBoolean(
              definition.required,
              false
            ),
          description:
            boundedText(
              definition.description,
              500
            ),
          unit:
            boundedText(
              definition.unit,
              40
            ),
          currency:
            normalizeCurrency(
              definition.currency
            ),
          min:
            normalizeNumber(
              definition.min
            ),
          max:
            normalizeNumber(
              definition.max
            ),
          allowedValues:
            sanitizeArray(
              definition.allowedValues,
              (value) =>
                boundedText(
                  value,
                  LIMITS.MAX_CATEGORY_LENGTH
                ),
              100
            ),
        }),
        LIMITS.MAX_FEATURES
      ),
    schemaHash:
      normalizeId(
        schema.schemaHash
      ),
    advisoryOnly: true,
    createdAt:
      normalizeTimestamp(
        schema.createdAt
      ),
    updatedAt:
      normalizeTimestamp(
        schema.updatedAt ||
          schema.createdAt
      ),
  };
}

/* -------------------------------------------------------------------------- */
/* Factories / singleton                                                      */
/* -------------------------------------------------------------------------- */

let defaultInstance = null;

function createFeatureStore(
  options = {}
) {
  return new FeatureStore(
    options
  );
}

function getFeatureStore(
  options = {}
) {
  if (!defaultInstance) {
    defaultInstance =
      new FeatureStore(
        options
      );
  }

  return defaultInstance;
}

async function resetFeatureStore() {
  if (
    defaultInstance &&
    typeof defaultInstance.destroy ===
      'function'
  ) {
    await defaultInstance.destroy();
  }

  defaultInstance = null;
}

/* -------------------------------------------------------------------------- */
/* Exports                                                                    */
/* -------------------------------------------------------------------------- */

module.exports =
  FeatureStore;

module.exports.FeatureStore =
  FeatureStore;

module.exports.createFeatureStore =
  createFeatureStore;

module.exports.getFeatureStore =
  getFeatureStore;

module.exports.resetFeatureStore =
  resetFeatureStore;

module.exports.PROVIDER =
  PROVIDER;

module.exports.STATUS =
  STATUS;

module.exports.SOURCE_TYPES =
  SOURCE_TYPES;

module.exports.FEATURE_TYPES =
  FEATURE_TYPES;

module.exports.QUALITY =
  QUALITY;

module.exports.LIMITS =
  LIMITS;

module.exports.buildFeatureRecord =
  buildFeatureRecord;

module.exports.normalizeFeature =
  normalizeFeature;

module.exports.normalizeFeatures =
  normalizeFeatures;

module.exports.normalizeMoneyMinor =
  normalizeMoneyMinor;

module.exports.evaluateFreshness =
  evaluateFreshness;

module.exports.normalizeSchemaDefinition =
  normalizeSchemaDefinition;

module.exports.projectFeatureRecord =
  projectFeatureRecord;