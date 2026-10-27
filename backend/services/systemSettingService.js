import { createHash } from "node:crypto";
import { createRequire } from "node:module";

/**
 * TITech Community Capital — System Setting Service
 *
 * ES-module implementation for packages using "type": "module".
 * CommonJS model loading is isolated to the optional legacy-model adapter;
 * callers may inject a model or repository to avoid that adapter entirely.
 * Authorization and trusted tenant resolution remain controller/policy duties.
 */

const require = createRequire(import.meta.url);

let defaultSystemSettingModelLoadErrors = [];

function loadDefaultSystemSettingModel() {
  const candidates = [
    "../models/SystemSetting",
    "../models/systemSetting.model",
  ];

  for (const candidate of candidates) {
    try {
      const loaded = require(candidate);
      const model = loaded?.default ?? loaded?.SystemSetting ?? loaded;

      if (model) return model;
    } catch (error) {
      defaultSystemSettingModelLoadErrors.push({
        candidate,
        error,
      });
    }
  }

  return null;
}

const defaultSystemSettingModel = loadDefaultSystemSettingModel();

export const SERVICE_NAME = "TITechSystemSettingService";
export const SERVICE_VERSION = "2026.4";
export const CACHE_NAMESPACE = "titech:system-settings";

const DEFAULT_CACHE_TTL_SECONDS = Number(
  process.env.SYSTEM_SETTING_CACHE_TTL_SECONDS || 300
);

const DEFAULT_MAX_KEY_LENGTH = 255;
const DEFAULT_MAX_VALUE_LENGTH = 100000;
const DEFAULT_MAX_DESCRIPTION_LENGTH = 1000;
const DEFAULT_MAX_TAGS = 50;
const DEFAULT_MAX_TAG_LENGTH = 64;
const DEFAULT_MAX_BATCH_SIZE = 100;
const DEFAULT_MAX_RETRY_ATTEMPTS = 3;

export const SETTING_SCOPES = Object.freeze({
  GLOBAL: "GLOBAL",
  TENANT: "TENANT",
});

export const SETTING_TYPES = Object.freeze({
  STRING: "STRING",
  NUMBER: "NUMBER",
  BOOLEAN: "BOOLEAN",
  JSON: "JSON",
  SECRET: "SECRET",
  URL: "URL",
});

export const SETTING_STATUSES = Object.freeze({
  ACTIVE: "ACTIVE",
  DISABLED: "DISABLED",
});

const SENSITIVE_KEY_PATTERNS = Object.freeze([
  /password/i,
  /passwd/i,
  /secret/i,
  /token/i,
  /api[_-]?key/i,
  /private[_-]?key/i,
  /client[_-]?secret/i,
  /access[_-]?key/i,
  /encryption[_-]?key/i,
  /signing[_-]?key/i,
  /credential/i,
]);

export class SystemSettingServiceError extends Error {
  constructor(
    message,
    {
      code = "SYSTEM_SETTING_ERROR",
      statusCode = 500,
      retryable = false,
      cause = null,
      details = null,
    } = {}
  ) {
    super(message, cause ? { cause } : undefined);

    this.name = "SystemSettingServiceError";
    this.code = code;
    this.statusCode = statusCode;
    this.retryable = retryable;
    this.details = details;

    if (cause && !this.cause) {
      this.cause = cause;
    }

    Error.captureStackTrace?.(
      this,
      SystemSettingServiceError
    );
  }
}

function fail(
  message,
  code,
  statusCode = 400,
  extra = {}
) {
  throw new SystemSettingServiceError(message, {
    code,
    statusCode,
    ...extra,
  });
}

function normalizeString(value, fallback = null) {
  if (value === undefined || value === null) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

export function normalizeKey(value) {
  const key = normalizeString(value);

  if (!key) {
    fail(
      "Setting key is required.",
      "SETTING_KEY_REQUIRED"
    );
  }

  if (key.length > DEFAULT_MAX_KEY_LENGTH) {
    fail(
      "Setting key exceeds the maximum allowed length.",
      "SETTING_KEY_TOO_LONG"
    );
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(key)) {
    fail("Invalid setting key.", "INVALID_SETTING_KEY");
  }

  return key;
}

export function normalizeTenantId(
  tenantId,
  { required = true } = {}
) {
  const normalized =
    normalizeString(tenantId)?.toLowerCase() ?? null;

  if (!normalized && required) {
    fail("tenantId is required.", "TENANT_ID_REQUIRED");
  }

  if (!normalized) {
    return null;
  }

  if (
    normalized.length < 3 ||
    normalized.length > 64 ||
    !/^[a-z0-9-]+$/.test(normalized)
  ) {
    fail(
      "Invalid tenant identifier.",
      "INVALID_TENANT_ID"
    );
  }

  return normalized;
}

function normalizeEnum(
  value,
  fallback,
  allowed,
  errorCode,
  label
) {
  const normalized = String(value || fallback)
    .trim()
    .toUpperCase();

  if (!Object.values(allowed).includes(normalized)) {
    fail(
      `Invalid system setting ${label}.`,
      errorCode
    );
  }

  return normalized;
}

function normalizeScope(scope) {
  return normalizeEnum(
    scope,
    SETTING_SCOPES.TENANT,
    SETTING_SCOPES,
    "INVALID_SETTING_SCOPE",
    "scope"
  );
}

function normalizeType(type) {
  return normalizeEnum(
    type,
    SETTING_TYPES.STRING,
    SETTING_TYPES,
    "INVALID_SETTING_TYPE",
    "type"
  );
}

function normalizeStatus(status) {
  return normalizeEnum(
    status,
    SETTING_STATUSES.ACTIVE,
    SETTING_STATUSES,
    "INVALID_SETTING_STATUS",
    "status"
  );
}

function normalizeTags(tags) {
  if (tags == null) {
    return [];
  }

  if (!Array.isArray(tags)) {
    fail(
      "Setting tags must be an array.",
      "INVALID_SETTING_TAGS"
    );
  }

  if (tags.length > DEFAULT_MAX_TAGS) {
    fail(
      "Too many setting tags.",
      "TOO_MANY_SETTING_TAGS"
    );
  }

  const normalized = [
    ...new Set(
      tags
        .map((tag) => normalizeString(tag))
        .filter(Boolean)
    ),
  ];

  if (
    normalized.some(
      (tag) => tag.length > DEFAULT_MAX_TAG_LENGTH
    )
  ) {
    fail(
      "A setting tag exceeds the maximum allowed length.",
      "SETTING_TAG_TOO_LONG"
    );
  }

  return normalized;
}

export function isSensitiveKey(key) {
  return SENSITIVE_KEY_PATTERNS.some(
    (pattern) => pattern.test(String(key || ""))
  );
}

export function isSensitiveSetting(setting) {
  if (!setting) {
    return false;
  }

  return (
    String(setting.type || "").toUpperCase() ===
      SETTING_TYPES.SECRET ||
    isSensitiveKey(setting.key)
  );
}

function hashValue(value) {
  return createHash("sha256")
    .update(String(value ?? ""), "utf8")
    .digest("hex");
}

function cloneValue(value) {
  if (
    value === undefined ||
    value === null ||
    typeof value !== "object"
  ) {
    return value;
  }

  if (typeof structuredClone === "function") {
    try {
      return structuredClone(value);
    } catch {
      // Fall through for Mongoose/BSON values.
    }
  }

  return JSON.parse(JSON.stringify(value));
}

function safeErrorMessage(error) {
  return typeof error?.message === "string"
    ? error.message
    : "Unknown error.";
}

function toPlainObject(value) {
  if (!value) {
    return value;
  }

  if (typeof value.toObject === "function") {
    return value.toObject();
  }

  if (typeof value.toJSON === "function") {
    return value.toJSON();
  }

  return { ...value };
}

function resultMatchedCount(result) {
  if (!result) {
    return 0;
  }

  if (Number.isFinite(result.matchedCount)) {
    return result.matchedCount;
  }

  if (Number.isFinite(result.n)) {
    return result.n;
  }

  if (Number.isFinite(result.nMatched)) {
    return result.nMatched;
  }

  // A zero modification count can still mean a record matched.
  return null;
}

function resultDeletedCount(result) {
  if (!result) {
    return 0;
  }

  if (Number.isFinite(result.deletedCount)) {
    return result.deletedCount;
  }

  if (Number.isFinite(result.n)) {
    return result.n;
  }

  return 0;
}

export function validateSettingValue(value, type) {
  const normalizedType = normalizeType(type);

  switch (normalizedType) {
    case SETTING_TYPES.STRING:
      if (typeof value !== "string") {
        fail(
          "Setting value must be a string.",
          "INVALID_SETTING_VALUE"
        );
      }
      break;

    case SETTING_TYPES.NUMBER:
      if (
        typeof value !== "number" ||
        !Number.isFinite(value)
      ) {
        fail(
          "Setting value must be a finite number.",
          "INVALID_SETTING_VALUE"
        );
      }
      break;

    case SETTING_TYPES.BOOLEAN:
      if (typeof value !== "boolean") {
        fail(
          "Setting value must be a boolean.",
          "INVALID_SETTING_VALUE"
        );
      }
      break;

    case SETTING_TYPES.JSON: {
      try {
        const serialized = JSON.stringify(value);

        if (serialized === undefined) {
          fail(
            "Setting value must be JSON serializable.",
            "INVALID_SETTING_VALUE"
          );
        }
      } catch (error) {
        if (error instanceof SystemSettingServiceError) {
          throw error;
        }

        fail(
          "Setting value must be JSON serializable.",
          "INVALID_SETTING_VALUE",
          400,
          { cause: error }
        );
      }
      break;
    }

    case SETTING_TYPES.SECRET:
      if (
        typeof value !== "string" &&
        !Buffer.isBuffer(value)
      ) {
        fail(
          "Secret setting value must be a string or Buffer.",
          "INVALID_SECRET_VALUE"
        );
      }
      break;

    case SETTING_TYPES.URL: {
      if (typeof value !== "string") {
        fail(
          "URL setting value must be a string.",
          "INVALID_SETTING_VALUE"
        );
      }

      try {
        const parsed = new URL(value);

        if (
          !["http:", "https:"].includes(parsed.protocol)
        ) {
          fail(
            "Setting URL must use HTTP or HTTPS.",
            "INVALID_SETTING_URL"
          );
        }
      } catch (error) {
        if (error instanceof SystemSettingServiceError) {
          throw error;
        }

        fail(
          "Setting value must be a valid URL.",
          "INVALID_SETTING_URL",
          400,
          { cause: error }
        );
      }
      break;
    }

    default:
      fail(
        "Unsupported setting type.",
        "UNSUPPORTED_SETTING_TYPE"
      );
  }

  if (
    typeof value === "string" &&
    value.length > DEFAULT_MAX_VALUE_LENGTH
  ) {
    fail(
      "Setting value exceeds the maximum allowed length.",
      "SETTING_VALUE_TOO_LONG"
    );
  }

  return true;
}

function escapeRegex(value) {
  return String(value).replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&"
  );
}

export function buildCacheKey({
  scope,
  tenantId,
  key,
}) {
  const normalizedScope = normalizeScope(scope);

  const normalizedTenantId =
    normalizedScope === SETTING_SCOPES.GLOBAL
      ? "global"
      : normalizeTenantId(tenantId);

  return [
    CACHE_NAMESPACE,
    normalizedScope.toLowerCase(),
    normalizedTenantId,
    normalizeKey(key),
  ].join(":");
}

const CREATE_ALLOWED_FIELDS = new Set([
  "scope",
  "tenantId",
  "key",
  "type",
  "value",
  "status",
  "description",
  "tags",
  "metadata",
  "createdBy",
  "updatedBy",
]);

export class SystemSettingService {
  constructor({
    model,
    repository,
    cache,
    logger,
    auditService,
    eventBus,
    outboxService,
    metricsService,
    tenantConstants,
    config = {},
  } = {}) {
    this.model = model || defaultSystemSettingModel;
    this.repository = repository || null;
    this.cache = cache || null;
    this.logger = logger || console;
    this.auditService = auditService || null;
    this.eventBus = eventBus || null;
    this.outboxService = outboxService || null;
    this.metricsService = metricsService || null;
    this.tenantConstants = tenantConstants || null;

    this.config = {
      cacheEnabled: config.cacheEnabled !== false,

      cacheTtlSeconds:
        Number.isFinite(Number(config.cacheTtlSeconds)) &&
        Number(config.cacheTtlSeconds) > 0
          ? Number(config.cacheTtlSeconds)
          : DEFAULT_CACHE_TTL_SECONDS,

      maxBatchSize:
        Number.isInteger(Number(config.maxBatchSize)) &&
        Number(config.maxBatchSize) > 0
          ? Number(config.maxBatchSize)
          : DEFAULT_MAX_BATCH_SIZE,

      maxRetryAttempts:
        Number.isInteger(Number(config.maxRetryAttempts)) &&
        Number(config.maxRetryAttempts) > 0
          ? Number(config.maxRetryAttempts)
          : DEFAULT_MAX_RETRY_ATTEMPTS,

      failOnAuditError: config.failOnAuditError === true,
      failOnEventError: config.failOnEventError === true,
    };

    this.metrics = this.createMetrics();
    this.assertConfiguration();
  }

  assertConfiguration() {
    if (!this.model && !this.repository) {
      const lastLoadError =
        defaultSystemSettingModelLoadErrors.at(-1)?.error;

      throw new TypeError(
        `[${SERVICE_NAME}] A SystemSetting model or repository is required. ` +
          'The default model could not be loaded; under "type": "module", ' +
          "legacy CommonJS model files must be migrated or moved to a " +
          "CommonJS package scope.",
        lastLoadError ? { cause: lastLoadError } : undefined
      );
    }
  }

  createMetrics() {
    return {
      reads: 0,
      writes: 0,
      creates: 0,
      updates: 0,
      deletes: 0,
      cacheHits: 0,
      cacheMisses: 0,
      cacheReadsFailed: 0,
      cacheWritesFailed: 0,
      cacheInvalidations: 0,
      validationFailures: 0,
      notFound: 0,
      concurrencyConflicts: 0,
      auditFailures: 0,
      eventFailures: 0,
      failures: 0,
    };
  }

  incrementMetric(name, value = 1) {
    if (
      !Object.prototype.hasOwnProperty.call(
        this.metrics,
        name
      )
    ) {
      this.metrics[name] = 0;
    }

    this.metrics[name] += value;

    try {
      this.metricsService?.increment?.(
        `system_setting_${name}`,
        value
      );
    } catch (error) {
      this.logWarn(
        "System setting metrics integration failed.",
        {
          metric: name,
          error: safeErrorMessage(error),
        }
      );
    }
  }

  getMetrics() {
    return { ...this.metrics };
  }

  logInfo(message, metadata = {}) {
    try {
      this.logger?.info?.(message, {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        ...metadata,
      });
    } catch {
      // Logging must not break operations.
    }
  }

  logWarn(message, metadata = {}) {
    try {
      this.logger?.warn?.(message, {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        ...metadata,
      });
    } catch {
      // Logging must not break operations.
    }
  }

  logError(message, metadata = {}) {
    try {
      this.logger?.error?.(message, {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        ...metadata,
      });
    } catch {
      // Logging must not break operations.
    }
  }

  validateTenant(tenantId, { required = true } = {}) {
    const normalized = normalizeTenantId(tenantId, { required });

    if (!normalized || !this.tenantConstants) {
      return normalized;
    }

    if (
      typeof this.tenantConstants.isValidTenantId === "function" &&
      !this.tenantConstants.isValidTenantId(normalized)
    ) {
      fail(
        "Invalid TITech tenant identifier.",
        "INVALID_TENANT_ID"
      );
    }

    return normalized;
  }

  buildScopeFilter({ scope, tenantId }) {
    const normalizedScope = normalizeScope(scope);

    if (normalizedScope === SETTING_SCOPES.GLOBAL) {
      return {
        scope: SETTING_SCOPES.GLOBAL,
        tenantId: null,
      };
    }

    return {
      scope: SETTING_SCOPES.TENANT,
      tenantId: this.validateTenant(tenantId),
    };
  }

  buildFilter({ key, scope, tenantId }) {
    return {
      ...this.buildScopeFilter({ scope, tenantId }),
      key: normalizeKey(key),
    };
  }

  async repositoryFindOne(filter, options = {}) {
    if (typeof this.repository?.findOne === "function") {
      return this.repository.findOne(filter, options);
    }

    if (!this.model?.findOne) {
      fail(
        "System setting persistence is unavailable.",
        "SETTING_PERSISTENCE_UNAVAILABLE",
        503,
        { retryable: true }
      );
    }

    let query = this.model.findOne(filter);

    if (
      options.session &&
      typeof query.session === "function"
    ) {
      query = query.session(options.session);
    }

    if (options.lean && typeof query.lean === "function") {
      query = query.lean();
    }

    return typeof query.exec === "function"
      ? query.exec()
      : query;
  }

  async repositoryFind(filter, options = {}) {
    if (typeof this.repository?.find === "function") {
      return this.repository.find(filter, options);
    }

    if (!this.model?.find) {
      fail(
        "System setting persistence is unavailable.",
        "SETTING_PERSISTENCE_UNAVAILABLE",
        503,
        { retryable: true }
      );
    }

    let query = this.model.find(filter);

    if (
      options.sort &&
      typeof query.sort === "function"
    ) {
      query = query.sort(options.sort);
    }

    if (
      Number.isInteger(options.limit) &&
      typeof query.limit === "function"
    ) {
      query = query.limit(options.limit);
    }

    if (
      options.session &&
      typeof query.session === "function"
    ) {
      query = query.session(options.session);
    }

    if (options.lean && typeof query.lean === "function") {
      query = query.lean();
    }

    return typeof query.exec === "function"
      ? query.exec()
      : query;
  }

  async repositoryCreate(document, options = {}) {
    if (typeof this.repository?.create === "function") {
      return this.repository.create(document, options);
    }

    if (typeof this.model !== "function") {
      fail(
        "System setting persistence is unavailable.",
        "SETTING_PERSISTENCE_UNAVAILABLE",
        503,
        { retryable: true }
      );
    }

    const instance = new this.model(document);

    return instance.save(
      options.session
        ? { session: options.session }
        : {}
    );
  }

  async repositoryUpdate(filter, update, options = {}) {
    if (typeof this.repository?.updateOne === "function") {
      return this.repository.updateOne(filter, update, options);
    }

    if (!this.model?.updateOne) {
      fail(
        "System setting persistence is unavailable.",
        "SETTING_PERSISTENCE_UNAVAILABLE",
        503,
        { retryable: true }
      );
    }

    const query = this.model.updateOne(
      filter,
      update,
      {
        session: options.session,
        runValidators: true,
      }
    );

    return typeof query.exec === "function"
      ? query.exec()
      : query;
  }

  async repositoryDelete(filter, options = {}) {
    if (typeof this.repository?.deleteOne === "function") {
      return this.repository.deleteOne(filter, options);
    }

    if (!this.model?.deleteOne) {
      fail(
        "System setting persistence is unavailable.",
        "SETTING_PERSISTENCE_UNAVAILABLE",
        503,
        { retryable: true }
      );
    }

    const query = this.model.deleteOne(filter, {
      session: options.session,
    });

    return typeof query.exec === "function"
      ? query.exec()
      : query;
  }

  async cacheGet(key) {
    if (
      !this.config.cacheEnabled ||
      !this.cache ||
      typeof this.cache.get !== "function"
    ) {
      return null;
    }

    try {
      const value = await this.cache.get(key);

      this.incrementMetric(
        value == null ? "cacheMisses" : "cacheHits"
      );

      return value ?? null;
    } catch (error) {
      this.incrementMetric("cacheReadsFailed");

      this.logWarn(
        "System setting cache read failed.",
        {
          cacheKey: key,
          error: safeErrorMessage(error),
        }
      );

      return null;
    }
  }

  async cacheSet(
    key,
    value,
    ttlSeconds = this.config.cacheTtlSeconds
  ) {
    if (
      !this.config.cacheEnabled ||
      !this.cache ||
      typeof this.cache.set !== "function"
    ) {
      return false;
    }

    try {
      if (
        Number.isFinite(ttlSeconds) &&
        ttlSeconds > 0
      ) {
        // node-redis v4 accepts { EX }; ioredis accepts "EX", ttl.
        try {
          await this.cache.set(key, value, {
            EX: ttlSeconds,
          });

          return true;
        } catch {
          // Try the ioredis signature.
        }

        try {
          await this.cache.set(
            key,
            value,
            "EX",
            ttlSeconds
          );

          return true;
        } catch {
          // Try setEx.
        }

        if (typeof this.cache.setEx === "function") {
          await this.cache.setEx(
            key,
            ttlSeconds,
            value
          );

          return true;
        }
      }

      await this.cache.set(key, value);

      return true;
    } catch (error) {
      this.incrementMetric("cacheWritesFailed");

      this.logWarn(
        "System setting cache write failed.",
        {
          cacheKey: key,
          error: safeErrorMessage(error),
        }
      );

      return false;
    }
  }

  async cacheDelete(key) {
    if (!this.cache) {
      return false;
    }

    try {
      if (typeof this.cache.del === "function") {
        await this.cache.del(key);
      } else if (typeof this.cache.delete === "function") {
        await this.cache.delete(key);
      } else {
        return false;
      }

      this.incrementMetric("cacheInvalidations");

      return true;
    } catch (error) {
      this.logWarn(
        "System setting cache invalidation failed.",
        {
          cacheKey: key,
          error: safeErrorMessage(error),
        }
      );

      return false;
    }
  }

  serializeForCache(setting) {
    if (!setting) {
      return null;
    }

    const object = toPlainObject(setting);

    if (isSensitiveSetting(object)) {
      return JSON.stringify({
        ...object,
        value: undefined,
        sensitive: true,
      });
    }

    return JSON.stringify(object);
  }

  deserializeFromCache(value) {
    if (value == null) {
      return null;
    }

    if (typeof value === "object") {
      return value;
    }

    try {
      return JSON.parse(String(value));
    } catch {
      return null;
    }
  }

  sanitizeForResponse(
    setting,
    { includeSensitive = false } = {}
  ) {
    if (!setting) {
      return null;
    }

    const output = {
      ...toPlainObject(setting),
    };

    if (
      isSensitiveSetting(output) &&
      !includeSensitive
    ) {
      delete output.value;
      output.valueRedacted = true;
    }

    if (
      output.metadata &&
      typeof output.metadata === "object"
    ) {
      output.metadata = cloneValue(output.metadata);
    }

    return output;
  }

  sanitizeForAudit(setting) {
    if (!setting) {
      return null;
    }

    const object = toPlainObject(setting);

    if (isSensitiveSetting(object)) {
      const { value, ...safeObject } = object;

      return {
        ...safeObject,
        valueHash: hashValue(value),
        valueRedacted: true,
      };
    }

    return object;
  }

  async audit(
    action,
    {
      tenantId = null,
      settingKey = null,
      actorId = null,
      requestId = null,
      correlationId = null,
      before = null,
      after = null,
      session = null,
    } = {}
  ) {
    if (!this.auditService) {
      return;
    }

    const payload = {
      action,
      entity: "SystemSetting",
      entityType: "SystemSetting",
      entityId: settingKey,
      tenantId,
      actorId,
      requestId,
      correlationId,
      before: this.sanitizeForAudit(before),
      after: this.sanitizeForAudit(after),
      occurredAt: new Date(),
      service: SERVICE_NAME,
      serviceVersion: SERVICE_VERSION,
      session,
    };

    try {
      if (typeof this.auditService.record === "function") {
        await this.auditService.record(payload);
      } else if (typeof this.auditService.log === "function") {
        await this.auditService.log(payload);
      }
    } catch (error) {
      this.incrementMetric("auditFailures");

      this.logError(
        "System setting audit integration failed.",
        {
          action,
          tenantId,
          settingKey,
          error: safeErrorMessage(error),
        }
      );

      if (this.config.failOnAuditError) {
        throw new SystemSettingServiceError(
          "System setting audit operation failed.",
          {
            code: "AUDIT_OPERATION_FAILED",
            statusCode: 503,
            retryable: true,
            cause: error,
          }
        );
      }
    }
  }

  async publishEvent(eventName, payload) {
    try {
      if (typeof this.outboxService?.enqueue === "function") {
        await this.outboxService.enqueue({
          type: eventName,
          aggregateType: "SystemSetting",
          aggregateId: payload.settingKey,
          tenantId: payload.tenantId,
          payload,
        });

        return;
      }

      if (typeof this.eventBus?.publish === "function") {
        await this.eventBus.publish(eventName, payload);
        return;
      }

      if (typeof this.eventBus?.emit === "function") {
        this.eventBus.emit(eventName, payload);
      }
    } catch (error) {
      this.incrementMetric("eventFailures");

      this.logError(
        "System setting event publication failed.",
        {
          eventName,
          settingKey: payload?.settingKey,
          tenantId: payload?.tenantId,
          error: safeErrorMessage(error),
        }
      );

      if (this.config.failOnEventError) {
        throw new SystemSettingServiceError(
          "System setting event publication failed.",
          {
            code: "EVENT_PUBLICATION_FAILED",
            statusCode: 503,
            retryable: true,
            cause: error,
          }
        );
      }
    }
  }

  normalizeCreateInput(input = {}) {
    for (const field of Object.keys(input)) {
      if (!CREATE_ALLOWED_FIELDS.has(field)) {
        fail(
          `Unknown setting field: ${field}`,
          "UNKNOWN_SETTING_FIELD"
        );
      }
    }

    const scope = normalizeScope(input.scope);

    const tenantId =
      scope === SETTING_SCOPES.GLOBAL
        ? null
        : this.validateTenant(input.tenantId);

    const key = normalizeKey(input.key);
    const type = normalizeType(input.type);
    const status = normalizeStatus(input.status);
    const value = input.value;

    if (value === undefined || value === null) {
      fail(
        "Setting value is required.",
        "SETTING_VALUE_REQUIRED"
      );
    }

    validateSettingValue(value, type);

    const description = normalizeString(input.description);

    if (
      description &&
      description.length > DEFAULT_MAX_DESCRIPTION_LENGTH
    ) {
      fail(
        "Setting description exceeds the maximum allowed length.",
        "SETTING_DESCRIPTION_TOO_LONG"
      );
    }

    if (
      input.metadata != null &&
      (
        typeof input.metadata !== "object" ||
        Array.isArray(input.metadata)
      )
    ) {
      fail(
        "Setting metadata must be an object.",
        "INVALID_SETTING_METADATA"
      );
    }

    return {
      scope,
      tenantId,
      key,
      type,
      value,
      status,
      description: description || null,
      tags: normalizeTags(input.tags),
      metadata: input.metadata
        ? cloneValue(input.metadata)
        : {},
      createdBy: normalizeString(input.createdBy),
      updatedBy: normalizeString(input.updatedBy),
    };
  }

  async get({
    key,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    session = null,
    useCache = true,
    includeSensitive = false,
  } = {}) {
    this.incrementMetric("reads");

    const normalizedScope = normalizeScope(scope);

    const normalizedTenantId =
      normalizedScope === SETTING_SCOPES.GLOBAL
        ? null
        : this.validateTenant(tenantId);

    const normalizedKey = normalizeKey(key);

    const cacheKey = buildCacheKey({
      scope: normalizedScope,
      tenantId: normalizedTenantId,
      key: normalizedKey,
    });

    if (
      useCache &&
      !isSensitiveKey(normalizedKey)
    ) {
      const cached = await this.cacheGet(cacheKey);

      if (cached != null) {
        const cachedSetting = this.deserializeFromCache(cached);

        if (cachedSetting) {
          return this.sanitizeForResponse(
            cachedSetting,
            { includeSensitive }
          );
        }
      }
    }

    const setting = await this.repositoryFindOne(
      this.buildFilter({
        key: normalizedKey,
        scope: normalizedScope,
        tenantId: normalizedTenantId,
      }),
      {
        session,
        lean: false,
      }
    );

    if (!setting) {
      this.incrementMetric("notFound");
      return null;
    }

    if (
      useCache &&
      !isSensitiveSetting(setting)
    ) {
      await this.cacheSet(
        cacheKey,
        this.serializeForCache(setting)
      );
    }

    return this.sanitizeForResponse(
      setting,
      { includeSensitive }
    );
  }

  async require(options = {}) {
    const setting = await this.get(options);

    if (!setting) {
      fail(
        "Required system setting was not found.",
        "SETTING_NOT_FOUND",
        404
      );
    }

    return setting;
  }

  async getInternal({
    key,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    session = null,
  } = {}) {
    return this.repositoryFindOne(
      this.buildFilter({
        key,
        scope,
        tenantId,
      }),
      {
        session,
        lean: false,
      }
    );
  }

  async list({
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    status = null,
    prefix = null,
    limit = 100,
    session = null,
    includeSensitive = false,
  } = {}) {
    const normalizedScope = normalizeScope(scope);

    const normalizedTenantId =
      normalizedScope === SETTING_SCOPES.GLOBAL
        ? null
        : this.validateTenant(tenantId);

    const numericLimit = Number(limit);

    const safeLimit = Math.min(
      Math.max(
        Number.isFinite(numericLimit)
          ? Math.trunc(numericLimit)
          : 100,
        1
      ),
      this.config.maxBatchSize
    );

    const filter = this.buildScopeFilter({
      scope: normalizedScope,
      tenantId: normalizedTenantId,
    });

    if (status) {
      filter.status = normalizeStatus(status);
    }

    if (prefix !== null) {
      const normalizedPrefix = normalizeString(prefix);

      if (normalizedPrefix) {
        filter.key = {
          $regex: `^${escapeRegex(normalizedPrefix)}`,
        };
      }
    }

    const settings = await this.repositoryFind(filter, {
      session,
      limit: safeLimit,
      sort: { key: 1 },
      lean: false,
    });

    return (settings || []).map((setting) =>
      this.sanitizeForResponse(
        setting,
        { includeSensitive }
      )
    );
  }

  async create(
    input = {},
    {
      session = null,
      actorId = null,
      requestId = null,
      correlationId = null,
      publishEvent = true,
    } = {}
  ) {
    this.incrementMetric("writes");

    let normalized;

    try {
      normalized = this.normalizeCreateInput({
        ...input,
        createdBy: actorId || input.createdBy,
        updatedBy: actorId || input.updatedBy,
      });
    } catch (error) {
      this.incrementMetric("validationFailures");
      throw error;
    }

    const filter = this.buildFilter(normalized);

    const existing = await this.repositoryFindOne(
      filter,
      { session }
    );

    if (existing) {
      fail(
        "System setting already exists.",
        "SETTING_ALREADY_EXISTS",
        409
      );
    }

    let created;

    try {
      created = await this.repositoryCreate(
        normalized,
        { session }
      );
    } catch (error) {
      if (error?.code === 11000) {
        throw new SystemSettingServiceError(
          "System setting already exists.",
          {
            code: "SETTING_ALREADY_EXISTS",
            statusCode: 409,
            cause: error,
          }
        );
      }

      throw error;
    }

    this.incrementMetric("creates");

    await this.invalidate({
      key: normalized.key,
      tenantId: normalized.tenantId,
      scope: normalized.scope,
    });

    await this.audit("SYSTEM_SETTING_CREATED", {
      tenantId: normalized.tenantId,
      settingKey: normalized.key,
      actorId,
      requestId,
      correlationId,
      after: created,
      session,
    });

    if (publishEvent) {
      await this.publishEvent(
        "titech.system_setting.created",
        {
          tenantId: normalized.tenantId,
          settingKey: normalized.key,
          scope: normalized.scope,
          actorId,
          requestId,
          correlationId,
          occurredAt: new Date(),
        }
      );
    }

    return this.sanitizeForResponse(created);
  }

  async update({
    key,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    value,
    type,
    status,
    description,
    tags,
    metadata,
    expectedUpdatedAt = null,
    actorId = null,
    requestId = null,
    correlationId = null,
    session = null,
    publishEvent = true,
  } = {}) {
    this.incrementMetric("writes");

    const normalizedScope = normalizeScope(scope);

    const normalizedTenantId =
      normalizedScope === SETTING_SCOPES.GLOBAL
        ? null
        : this.validateTenant(tenantId);

    const normalizedKey = normalizeKey(key);

    const filter = this.buildFilter({
      key: normalizedKey,
      scope: normalizedScope,
      tenantId: normalizedTenantId,
    });

    const before = await this.repositoryFindOne(
      filter,
      {
        session,
        lean: false,
      }
    );

    if (!before) {
      this.incrementMetric("notFound");

      fail(
        "System setting was not found.",
        "SETTING_NOT_FOUND",
        404
      );
    }

    let expectedDate = null;

    if (
      expectedUpdatedAt !== null &&
      expectedUpdatedAt !== undefined
    ) {
      expectedDate = new Date(expectedUpdatedAt);

      if (Number.isNaN(expectedDate.getTime())) {
        fail(
          "Invalid expectedUpdatedAt value.",
          "INVALID_CONCURRENCY_TOKEN"
        );
      }

      if (
        !before.updatedAt ||
        new Date(before.updatedAt).getTime() !==
          expectedDate.getTime()
      ) {
        this.incrementMetric("concurrencyConflicts");

        fail(
          "System setting was modified by another operation.",
          "SETTING_CONCURRENCY_CONFLICT",
          409,
          { retryable: true }
        );
      }
    }

    const update = {};

    if (value !== undefined) {
      const effectiveType = normalizeType(
        type ?? before.type
      );

      validateSettingValue(value, effectiveType);
      update.value = value;

      if (type !== undefined) {
        update.type = effectiveType;
      }
    }

    if (type !== undefined) {
      const normalizedType = normalizeType(type);

      if (value === undefined) {
        validateSettingValue(
          before.value,
          normalizedType
        );
      }

      update.type = normalizedType;
    }

    if (status !== undefined) {
      update.status = normalizeStatus(status);
    }

    if (description !== undefined) {
      const normalizedDescription = normalizeString(description);

      if (
        normalizedDescription &&
        normalizedDescription.length >
          DEFAULT_MAX_DESCRIPTION_LENGTH
      ) {
        fail(
          "Setting description exceeds the maximum allowed length.",
          "SETTING_DESCRIPTION_TOO_LONG"
        );
      }

      update.description = normalizedDescription;
    }

    if (tags !== undefined) {
      update.tags = normalizeTags(tags);
    }

    if (metadata !== undefined) {
      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        fail(
          "Setting metadata must be an object.",
          "INVALID_SETTING_METADATA"
        );
      }

      update.metadata = cloneValue(metadata);
    }

    if (actorId !== null && actorId !== undefined) {
      update.updatedBy = normalizeString(actorId);
    }

    if (Object.keys(update).length === 0) {
      return this.sanitizeForResponse(before);
    }

    // Explicit timestamp ensures optimistic-concurrency tokens change.
    update.updatedAt = new Date();

    const updateFilter = expectedDate
      ? { ...filter, updatedAt: expectedDate }
      : filter;

    const result = await this.repositoryUpdate(
      updateFilter,
      { $set: update },
      { session }
    );

    const matchedCount = resultMatchedCount(result);

    if (matchedCount === 0) {
      this.incrementMetric("concurrencyConflicts");

      fail(
        "System setting update failed because the record changed concurrently or no longer exists.",
        "SETTING_CONCURRENCY_CONFLICT",
        409,
        { retryable: true }
      );
    }

    const after = await this.repositoryFindOne(
      filter,
      {
        session,
        lean: false,
      }
    );

    if (!after) {
      fail(
        "System setting could not be reloaded after update.",
        "SETTING_RELOAD_FAILED",
        500
      );
    }

    this.incrementMetric("updates");

    await this.invalidate({
      key: normalizedKey,
      tenantId: normalizedTenantId,
      scope: normalizedScope,
    });

    await this.audit("SYSTEM_SETTING_UPDATED", {
      tenantId: normalizedTenantId,
      settingKey: normalizedKey,
      actorId,
      requestId,
      correlationId,
      before,
      after,
      session,
    });

    if (publishEvent) {
      await this.publishEvent(
        "titech.system_setting.updated",
        {
          tenantId: normalizedTenantId,
          settingKey: normalizedKey,
          scope: normalizedScope,
          actorId,
          requestId,
          correlationId,
          occurredAt: new Date(),
        }
      );
    }

    return this.sanitizeForResponse(after);
  }

  async delete({
    key,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    actorId = null,
    requestId = null,
    correlationId = null,
    session = null,
    publishEvent = true,
  } = {}) {
    this.incrementMetric("writes");

    const normalizedScope = normalizeScope(scope);

    const normalizedTenantId =
      normalizedScope === SETTING_SCOPES.GLOBAL
        ? null
        : this.validateTenant(tenantId);

    const normalizedKey = normalizeKey(key);

    const filter = this.buildFilter({
      key: normalizedKey,
      scope: normalizedScope,
      tenantId: normalizedTenantId,
    });

    const before = await this.repositoryFindOne(
      filter,
      {
        session,
        lean: false,
      }
    );

    if (!before) {
      this.incrementMetric("notFound");

      fail(
        "System setting was not found.",
        "SETTING_NOT_FOUND",
        404
      );
    }

    const result = await this.repositoryDelete(
      filter,
      { session }
    );

    if (resultDeletedCount(result) !== 1) {
      fail(
        "System setting could not be deleted.",
        "SETTING_DELETE_FAILED",
        500
      );
    }

    this.incrementMetric("deletes");

    await this.invalidate({
      key: normalizedKey,
      tenantId: normalizedTenantId,
      scope: normalizedScope,
    });

    await this.audit("SYSTEM_SETTING_DELETED", {
      tenantId: normalizedTenantId,
      settingKey: normalizedKey,
      actorId,
      requestId,
      correlationId,
      before,
      after: null,
      session,
    });

    if (publishEvent) {
      await this.publishEvent(
        "titech.system_setting.deleted",
        {
          tenantId: normalizedTenantId,
          settingKey: normalizedKey,
          scope: normalizedScope,
          actorId,
          requestId,
          correlationId,
          occurredAt: new Date(),
        }
      );
    }

    return {
      deleted: true,
      key: normalizedKey,
      tenantId: normalizedTenantId,
      scope: normalizedScope,
    };
  }

  async disable(options = {}) {
    return this.update({
      ...options,
      status: SETTING_STATUSES.DISABLED,
    });
  }

  async enable(options = {}) {
    return this.update({
      ...options,
      status: SETTING_STATUSES.ACTIVE,
    });
  }

  async setValue({
    key,
    value,
    type,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    actorId = null,
    expectedUpdatedAt = null,
    session = null,
    requestId = null,
    correlationId = null,
  } = {}) {
    const existing = await this.getInternal({
      key,
      tenantId,
      scope,
      session,
    });

    if (!existing) {
      return this.create(
        {
          key,
          value,
          type,
          tenantId,
          scope,
          createdBy: actorId,
          updatedBy: actorId,
        },
        {
          session,
          actorId,
          requestId,
          correlationId,
        }
      );
    }

    return this.update({
      key,
      value,
      type,
      tenantId,
      scope,
      actorId,
      expectedUpdatedAt,
      session,
      requestId,
      correlationId,
    });
  }

  async getValue({
    key,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    defaultValue = undefined,
    session = null,
    allowDisabled = false,
  } = {}) {
    const setting = await this.getInternal({
      key,
      tenantId,
      scope,
      session,
    });

    if (!setting) {
      return defaultValue;
    }

    if (
      !allowDisabled &&
      setting.status !== SETTING_STATUSES.ACTIVE
    ) {
      return defaultValue;
    }

    return cloneValue(setting.value);
  }

  async requireValue(options = {}) {
    const value = await this.getValue(options);

    if (value === undefined || value === null) {
      fail(
        "Required system setting value was not found.",
        "SETTING_VALUE_NOT_FOUND",
        404
      );
    }

    return value;
  }

  async invalidate({
    key,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
  } = {}) {
    return this.cacheDelete(
      buildCacheKey({ key, tenantId, scope })
    );
  }

  async invalidateTenant(tenantId) {
    const normalizedTenantId = this.validateTenant(tenantId);
    const pattern =
      `${CACHE_NAMESPACE}:tenant:${normalizedTenantId}:*`;

    if (!this.cache) {
      return false;
    }

    try {
      if (typeof this.cache.scanIterator === "function") {
        for await (
          const key of this.cache.scanIterator({
            MATCH: pattern,
          })
        ) {
          await this.cacheDelete(key);
        }

        return true;
      }

      if (typeof this.cache.keys === "function") {
        const keys = await this.cache.keys(pattern);

        for (const key of keys || []) {
          await this.cacheDelete(key);
        }

        return true;
      }
    } catch (error) {
      this.logWarn(
        "Tenant system setting cache invalidation failed.",
        {
          tenantId: normalizedTenantId,
          error: safeErrorMessage(error),
        }
      );
    }

    return false;
  }

  async getMany({
    keys,
    tenantId,
    scope = SETTING_SCOPES.TENANT,
    session = null,
    includeSensitive = false,
  } = {}) {
    if (!Array.isArray(keys) || keys.length === 0) {
      return [];
    }

    if (keys.length > this.config.maxBatchSize) {
      fail(
        "Too many settings requested in one operation.",
        "SETTING_BATCH_TOO_LARGE"
      );
    }

    const normalizedKeys = [
      ...new Set(keys.map(normalizeKey)),
    ];

    const normalizedScope = normalizeScope(scope);

    const normalizedTenantId =
      normalizedScope === SETTING_SCOPES.GLOBAL
        ? null
        : this.validateTenant(tenantId);

    const filter = {
      ...this.buildScopeFilter({
        scope: normalizedScope,
        tenantId: normalizedTenantId,
      }),
      key: { $in: normalizedKeys },
    };

    const settings = await this.repositoryFind(filter, {
      session,
      limit: this.config.maxBatchSize,
      sort: { key: 1 },
      lean: false,
    });

    return (settings || []).map((setting) =>
      this.sanitizeForResponse(
        setting,
        { includeSensitive }
      )
    );
  }

  async healthCheck() {
    try {
      if (typeof this.repository?.healthCheck === "function") {
        await this.repository.healthCheck();
      } else if (typeof this.model?.exists === "function") {
        await this.model.exists({});
      } else if (typeof this.repository?.findOne === "function") {
        await this.repository.findOne(
          {},
          { limit: 1, healthCheck: true }
        );
      } else {
        throw new Error(
          "No persistence health-check operation is available."
        );
      }

      return {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        healthy: true,
        persistence: true,
        cache: Boolean(this.cache),
        timestamp: new Date(),
      };
    } catch (error) {
      this.incrementMetric("failures");

      return {
        service: SERVICE_NAME,
        version: SERVICE_VERSION,
        healthy: false,
        persistence: false,
        cache: Boolean(this.cache),
        error: safeErrorMessage(error),
        timestamp: new Date(),
      };
    }
  }
}

export function createSystemSettingService(dependencies = {}) {
  return new SystemSettingService(dependencies);
}

let singletonService = null;

export function getSystemSettingService(dependencies = {}) {
  if (!singletonService) {
    singletonService = createSystemSettingService(dependencies);
  }

  return singletonService;
}

export function resetSystemSettingServiceForTests() {
  singletonService = null;
}

/**
 * ---------------------------------------------------------------------------
 * Backward-compatible model façade
 * ---------------------------------------------------------------------------
 *
 * Older TITech consumers and existing contract tests call these operations
 * directly from the service module. Preserve that API alongside the newer
 * class/factory interface.
 *
 * The model remains responsible for database-level version checks, protected
 * settings, logical deletion, and audit history. This façade validates inputs,
 * preserves explicit tenant/actor arguments, and propagates model errors.
 */

const LEGACY_UPDATE_FIELDS = new Set([
  "name",
  "description",
  "category",
  "value",
  "valueType",
  "enabled",
  "complianceRelevant",
  "regulatoryCritical",
  "metadata",
  "sensitive",
  "retired",
  "deleted",
]);

const LEGACY_VALUE_TYPES = new Set([
  "STRING",
  "NUMBER",
  "BOOLEAN",
  "ARRAY",
  "JSON",
]);

function getLegacyModel() {
  if (!defaultSystemSettingModel) {
    const cause =
      defaultSystemSettingModelLoadErrors.at(-1)?.error;

    throw new SystemSettingServiceError(
      "SystemSetting model is unavailable. Migrate the model to ESM or provide a compatible CommonJS package scope.",
      {
        code: "SETTING_MODEL_UNAVAILABLE",
        statusCode: 503,
        retryable: true,
        cause,
      }
    );
  }

  return defaultSystemSettingModel;
}

function normalizeLegacyKey(key, model = getLegacyModel()) {
  const normalized =
    typeof model.normalizeKey === "function"
      ? model.normalizeKey(key)
      : String(key ?? "").trim().toUpperCase();

  if (
    typeof normalized !== "string" ||
    !normalized.trim()
  ) {
    throw new SystemSettingServiceError(
      "System setting key is required.",
      {
        code: "SYSTEM_SETTING_KEY_REQUIRED",
        statusCode: 400,
      }
    );
  }

  return normalized;
}

function normalizeLegacyTenantId(
  tenantId,
  model = getLegacyModel()
) {
  if (typeof model.normalizeTenantId === "function") {
    return model.normalizeTenantId(tenantId);
  }

  // Matches the SystemSetting model contract.
  const normalized = String(
    tenantId ?? "SYSTEM"
  ).trim().toUpperCase();

  return normalized || "SYSTEM";
}

function getLegacyModelMethod(name) {
  const model = getLegacyModel();
  const method = model[name];

  if (typeof method !== "function") {
    throw new SystemSettingServiceError(
      `SystemSetting model does not implement ${name}().`,
      {
        code: "SETTING_MODEL_METHOD_UNAVAILABLE",
        statusCode: 503,
        details: { method: name },
      }
    );
  }

  return { model, method };
}

function legacyModelCall(name, args) {
  const { model, method } = getLegacyModelMethod(name);

  return method.apply(model, args);
}

function detectLegacyValueType(value) {
  if (Array.isArray(value)) return "ARRAY";

  if (
    value === null ||
    (typeof value === "object" && value !== null)
  ) {
    return "JSON";
  }

  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "string") return "STRING";

  return null;
}

function validateLegacyValueType(value, requestedType) {
  const valueType = String(
    requestedType || detectLegacyValueType(value) || ""
  ).trim().toUpperCase();

  if (!LEGACY_VALUE_TYPES.has(valueType)) {
    throw new SystemSettingServiceError(
      `Unsupported system setting value type: ${valueType || "UNSPECIFIED"}.`,
      {
        code: "INVALID_SETTING_VALUE_TYPE",
        statusCode: 400,
      }
    );
  }

  const valid =
    (valueType === "STRING" && typeof value === "string") ||
    (
      valueType === "NUMBER" &&
      typeof value === "number" &&
      Number.isFinite(value)
    ) ||
    (valueType === "BOOLEAN" && typeof value === "boolean") ||
    (valueType === "ARRAY" && Array.isArray(value)) ||
    (
      valueType === "JSON" &&
      (
        value === null ||
        (typeof value === "object" && !Array.isArray(value))
      )
    );

  if (!valid) {
    throw new SystemSettingServiceError(
      `System setting value does not match value type ${valueType}.`,
      {
        code: "INVALID_SETTING_VALUE_TYPE",
        statusCode: 400,
      }
    );
  }

  return valueType;
}

export async function getValue(
  key,
  tenantId = "SYSTEM",
  options = {}
) {
  const model = getLegacyModel();
  const normalizedKey = normalizeLegacyKey(key, model);
  const normalizedTenantId =
    normalizeLegacyTenantId(tenantId, model);

  return legacyModelCall("getValue", [
    normalizedKey,
    normalizedTenantId,
    options,
  ]);
}

export async function getSetting(
  key,
  tenantId = "SYSTEM"
) {
  const model = getLegacyModel();

  return legacyModelCall("getSetting", [
    normalizeLegacyKey(key, model),
    normalizeLegacyTenantId(tenantId, model),
  ]);
}

export async function getCategory(
  category,
  tenantId = "SYSTEM",
  options
) {
  const model = getLegacyModel();

  const normalizedCategory = String(
    category ?? "SYSTEM"
  ).trim().toUpperCase();

  const normalizedTenantId =
    normalizeLegacyTenantId(tenantId, model);

  const args = [
    normalizedCategory,
    normalizedTenantId,
  ];

  if (options !== undefined) {
    args.push(options);
  }

  return legacyModelCall("getCategory", args);
}

export async function getAllSettings(
  tenantId = "SYSTEM",
  options
) {
  const model = getLegacyModel();

  const normalizedTenantId =
    normalizeLegacyTenantId(tenantId, model);

  const args = [normalizedTenantId];

  if (options !== undefined) {
    args.push(options);
  }

  return legacyModelCall("getAllSettings", args);
}

export async function setValue(
  key,
  value,
  tenantId,
  updatedBy = null,
  options = {}
) {
  const model = getLegacyModel();
  const normalizedKey = normalizeLegacyKey(key, model);
  const normalizedTenantId =
    normalizeLegacyTenantId(tenantId, model);

  const suppliedOptions =
    options &&
    typeof options === "object" &&
    !Array.isArray(options)
      ? { ...options }
      : {};

  const valueType = validateLegacyValueType(
    value,
    suppliedOptions.valueType
  );

  // Tenant identity comes from the positional trusted argument, never
  // from a nested tenantId supplied as part of a setting value.
  suppliedOptions.valueType = valueType;

  return legacyModelCall("setValue", [
    normalizedKey,
    value,
    normalizedTenantId,
    updatedBy,
    suppliedOptions,
  ]);
}

export async function updateSetting(
  key,
  updates = {},
  tenantId,
  updatedBy = null,
  options = {}
) {
  if (
    !updates ||
    typeof updates !== "object" ||
    Array.isArray(updates)
  ) {
    throw new SystemSettingServiceError(
      "System setting updates must be an object.",
      {
        code: "INVALID_SETTING_UPDATES",
        statusCode: 400,
      }
    );
  }

  const model = getLegacyModel();
  const normalizedKey = normalizeLegacyKey(key, model);
  const normalizedTenantId =
    normalizeLegacyTenantId(tenantId, model);

  const sanitizedUpdates = {};

  for (const [field, value] of Object.entries(updates)) {
    if (LEGACY_UPDATE_FIELDS.has(field)) {
      sanitizedUpdates[field] = value;
    }
  }

  if (
    Object.prototype.hasOwnProperty.call(
      sanitizedUpdates,
      "value"
    )
  ) {
    sanitizedUpdates.valueType = validateLegacyValueType(
      sanitizedUpdates.value,
      sanitizedUpdates.valueType
    );
  } else if (sanitizedUpdates.valueType !== undefined) {
    const valueType = String(
      sanitizedUpdates.valueType
    ).trim().toUpperCase();

    if (!LEGACY_VALUE_TYPES.has(valueType)) {
      throw new SystemSettingServiceError(
        `Unsupported system setting value type: ${valueType}.`,
        {
          code: "INVALID_SETTING_VALUE_TYPE",
          statusCode: 400,
        }
      );
    }

    sanitizedUpdates.valueType = valueType;
  }

  return legacyModelCall("updateSetting", [
    normalizedKey,
    sanitizedUpdates,
    normalizedTenantId,
    updatedBy,
    options && typeof options === "object"
      ? options
      : {},
  ]);
}

export async function getEffectiveValue(
  key,
  tenantId,
  fallback = null
) {
  const model = getLegacyModel();

  return legacyModelCall("getEffectiveValue", [
    normalizeLegacyKey(key, model),
    normalizeLegacyTenantId(tenantId, model),
    fallback,
  ]);
}

export async function getEffectiveSetting(
  key,
  tenantId
) {
  const model = getLegacyModel();

  return legacyModelCall("getEffectiveSetting", [
    normalizeLegacyKey(key, model),
    normalizeLegacyTenantId(tenantId, model),
  ]);
}

export async function getHealthSummary(
  tenantId = "SYSTEM"
) {
  const model = getLegacyModel();

  return legacyModelCall("getHealthSummary", [
    normalizeLegacyTenantId(tenantId, model),
  ]);
}

export async function disableTenantOverride(
  key,
  tenantId,
  updatedBy = null,
  options = {}
) {
  const model = getLegacyModel();

  const normalizedTenantId =
    normalizeLegacyTenantId(tenantId, model);

  if (normalizedTenantId === "SYSTEM") {
    throw new SystemSettingServiceError(
      "SYSTEM settings cannot be disabled as tenant overrides.",
      {
        code: "INVALID_TENANT_OVERRIDE",
        statusCode: 400,
      }
    );
  }

  return legacyModelCall("disableTenantOverride", [
    normalizeLegacyKey(key, model),
    normalizedTenantId,
    updatedBy,
    options && typeof options === "object"
      ? options
      : {},
  ]);
}

async function changeLegacySettingStatus(
  action,
  key,
  tenantId = "SYSTEM",
  updatedBy = null,
  options = {}
) {
  const setting = await getSetting(key, tenantId);

  if (!setting) {
    throw new SystemSettingServiceError(
      "System setting was not found.",
      {
        code: "SYSTEM_SETTING_NOT_FOUND",
        statusCode: 404,
      }
    );
  }

  const method = setting[action];

  if (typeof method !== "function") {
    throw new SystemSettingServiceError(
      `System setting does not implement ${action}().`,
      {
        code: "SETTING_LIFECYCLE_METHOD_UNAVAILABLE",
        statusCode: 503,
      }
    );
  }

  return method.call(setting, updatedBy, options);
}

export async function enable(
  key,
  tenantId = "SYSTEM",
  updatedBy = null,
  options = {}
) {
  return changeLegacySettingStatus(
    "enable",
    key,
    tenantId,
    updatedBy,
    options
  );
}

export async function disable(
  key,
  tenantId = "SYSTEM",
  updatedBy = null,
  options = {}
) {
  return changeLegacySettingStatus(
    "disable",
    key,
    tenantId,
    updatedBy,
    options
  );
}

export async function create(
  input = {},
  options = {}
) {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input)
  ) {
    throw new SystemSettingServiceError(
      "System setting creation input must be an object.",
      {
        code: "INVALID_SETTING_INPUT",
        statusCode: 400,
      }
    );
  }

  const model = getLegacyModel();

  const document = {
    ...input,
    key: normalizeLegacyKey(input.key, model),
    tenantId: normalizeLegacyTenantId(
      input.tenantId,
      model
    ),
  };

  // Callers cannot assign database identity, version, or protected status.
  delete document._id;
  delete document.__v;
  delete document.version;
  delete document.isSystem;
  delete document.createdBy;
  delete document.updatedBy;

  const instance = new model(document);

  if (typeof instance.save !== "function") {
    throw new SystemSettingServiceError(
      "System setting document cannot be saved.",
      {
        code: "SETTING_PERSISTENCE_UNAVAILABLE",
        statusCode: 503,
      }
    );
  }

  return instance.save(
    options.session
      ? { session: options.session }
      : {}
  );
}

export async function update(
  key,
  updates = {},
  tenantId,
  updatedBy = null,
  options = {}
) {
  return updateSetting(
    key,
    updates,
    tenantId,
    updatedBy,
    options
  );
}

export async function remove(
  key,
  tenantId = "SYSTEM",
  updatedBy = null,
  options = {}
) {
  const setting = await getSetting(key, tenantId);

  if (!setting) {
    return null;
  }

  if (typeof setting.softDelete !== "function") {
    throw new SystemSettingServiceError(
      "Logical deletion is unavailable for this system setting.",
      {
        code: "SETTING_DELETE_UNAVAILABLE",
        statusCode: 503,
      }
    );
  }

  return setting.softDelete(updatedBy, options);
}

export async function restore(
  key,
  tenantId = "SYSTEM",
  updatedBy = null,
  options = {}
) {
  const setting = await getSetting(key, tenantId);

  if (!setting) {
    return null;
  }

  if (typeof setting.restore !== "function") {
    throw new SystemSettingServiceError(
      "Restoration is unavailable for this system setting.",
      {
        code: "SETTING_RESTORE_UNAVAILABLE",
        statusCode: 503,
      }
    );
  }

  return setting.restore(updatedBy, options);
}

// Deletion is logical; physical removal would erase configuration history.
export { remove as delete };

export default SystemSettingService;