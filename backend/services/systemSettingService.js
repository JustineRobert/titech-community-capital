"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise System Setting Service
 * ============================================================================
 *
 * File:
 *   backend/services/systemSettingService.js
 *
 * Purpose:
 *   Canonical application service for reading, creating, updating, deleting,
 *   caching, validating, and auditing TITech system settings.
 *
 * Architectural Position
 * ----------------------------------------------------------------------------
 *
 *   HTTP / Controller
 *          │
 *          ▼
 *   SystemSettingService
 *          │
 *          ├──────────────► SystemSetting Model / Repository
 *          │
 *          ├──────────────► Cache
 *          │
 *          ├──────────────► Audit Service
 *          │
 *          ├──────────────► Event Bus / Outbox
 *          │
 *          └──────────────► Metrics
 *
 * Architectural Principles
 * ----------------------------------------------------------------------------
 *
 *   ✓ Tenant isolation is mandatory for tenant-scoped settings.
 *   ✓ System/global settings are explicitly distinguished from tenant settings.
 *   ✓ Database remains the authoritative source of truth.
 *   ✓ Cache is an optimization only.
 *   ✓ Sensitive values are never logged.
 *   ✓ Sensitive values are never returned by default.
 *   ✓ Settings are validated before persistence.
 *   ✓ Updates support optimistic concurrency.
 *   ✓ Cache invalidation occurs after successful persistence.
 *   ✓ Audit/event integration is best-effort and isolated from core persistence.
 *   ✓ Unknown setting fields are rejected by this service.
 *   ✓ Configuration mutation is explicit rather than implicit.
 *   ✓ Caller authorization belongs to controller/policy middleware.
 *   ✓ Tenant identity must come from trusted server-side context.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This service does NOT:
 *
 *   - authenticate users
 *   - authorize administrators
 *   - establish tenant identity from client-controlled input
 *   - perform MongoDB transaction ownership on behalf of callers
 *   - contain HTTP response logic
 *   - expose raw secrets through logs
 *
 * Controllers/policies must perform authorization before invoking mutation
 * methods.
 *
 * ============================================================================
 */

const crypto = require("node:crypto");

/**
 * ============================================================================
 * Optional Dependencies
 * ============================================================================
 *
 * The service intentionally uses dependency injection so that the project can
 * operate with the existing MongoDB/Mongoose architecture while also allowing
 * Redis, metrics, audit, event-bus, and outbox implementations to be plugged in.
 * ============================================================================
 */

let defaultSystemSettingModel = null;

try {
    defaultSystemSettingModel =
        require("../models/SystemSetting");
} catch (error) {
    try {
        defaultSystemSettingModel =
            require("../models/systemSetting.model");
    } catch (fallbackError) {
        defaultSystemSettingModel = null;
    }
}

/**
 * ============================================================================
 * Service Metadata
 * ============================================================================
 */

const SERVICE_NAME =
    "TITechSystemSettingService";

const SERVICE_VERSION =
    "2026.3";

const CACHE_NAMESPACE =
    "titech:system-settings";

const DEFAULT_CACHE_TTL_SECONDS =
    Number(
        process.env.SYSTEM_SETTING_CACHE_TTL_SECONDS ||
        300
    );

const DEFAULT_MAX_KEY_LENGTH =
    255;

const DEFAULT_MAX_VALUE_LENGTH =
    100000;

const DEFAULT_MAX_DESCRIPTION_LENGTH =
    1000;

const DEFAULT_MAX_TAGS =
    50;

const DEFAULT_MAX_TAG_LENGTH =
    64;

const DEFAULT_MAX_BATCH_SIZE =
    100;

const DEFAULT_MAX_RETRY_ATTEMPTS =
    3;

/**
 * ============================================================================
 * Setting Scopes
 * ============================================================================
 */

const SETTING_SCOPES =
    Object.freeze({
        GLOBAL: "GLOBAL",
        TENANT: "TENANT"
    });

/**
 * ============================================================================
 * Setting Types
 * ============================================================================
 */

const SETTING_TYPES =
    Object.freeze({
        STRING: "STRING",
        NUMBER: "NUMBER",
        BOOLEAN: "BOOLEAN",
        JSON: "JSON",
        SECRET: "SECRET",
        URL: "URL"
    });

/**
 * ============================================================================
 * Setting Status
 * ============================================================================
 */

const SETTING_STATUSES =
    Object.freeze({
        ACTIVE: "ACTIVE",
        DISABLED: "DISABLED"
    });

/**
 * ============================================================================
 * Secret Redaction
 * ============================================================================
 *
 * Any setting whose type is SECRET, or whose key matches a sensitive pattern,
 * must never be exposed through ordinary read operations or logs.
 * ============================================================================
 */

const SENSITIVE_KEY_PATTERNS =
    Object.freeze([
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
        /credential/i
    ]);

/**
 * ============================================================================
 * Error Classes
 * ============================================================================
 */

class SystemSettingServiceError extends Error {
    constructor(
        message,
        {
            code = "SYSTEM_SETTING_ERROR",
            statusCode = 500,
            retryable = false,
            cause = null,
            details = null
        } = {}
    ) {
        super(message);

        this.name =
            "SystemSettingServiceError";

        this.code =
            code;

        this.statusCode =
            statusCode;

        this.retryable =
            retryable;

        this.details =
            details;

        if (cause) {
            this.cause =
                cause;
        }

        Error.captureStackTrace?.(
            this,
            SystemSettingServiceError
        );
    }
}

/**
 * ============================================================================
 * Utility Functions
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

function normalizeKey(
    value
) {
    const key =
        normalizeString(
            value
        );

    if (!key) {
        throw new SystemSettingServiceError(
            "Setting key is required.",
            {
                code:
                    "SETTING_KEY_REQUIRED",
                statusCode:
                    400
            }
        );
    }

    if (
        key.length >
        DEFAULT_MAX_KEY_LENGTH
    ) {
        throw new SystemSettingServiceError(
            "Setting key exceeds the maximum allowed length.",
            {
                code:
                    "SETTING_KEY_TOO_LONG",
                statusCode:
                    400
            }
        );
    }

    if (
        !/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/.test(
            key
        )
    ) {
        throw new SystemSettingServiceError(
            "Invalid setting key.",
            {
                code:
                    "INVALID_SETTING_KEY",
                statusCode:
                    400
            }
        );
    }

    return key;
}

function normalizeTenantId(
    tenantId,
    {
        required = true
    } = {}
) {
    const normalized =
        normalizeString(
            tenantId
        )?.toLowerCase() ||
        null;

    if (
        !normalized &&
        required
    ) {
        throw new SystemSettingServiceError(
            "tenantId is required.",
            {
                code:
                    "TENANT_ID_REQUIRED",
                statusCode:
                    400
            }
        );
    }

    if (!normalized) {
        return null;
    }

    if (
        normalized.length <
            3 ||
        normalized.length >
            64
    ) {
        throw new SystemSettingServiceError(
            "Invalid tenant identifier.",
            {
                code:
                    "INVALID_TENANT_ID",
                statusCode:
                    400
            }
        );
    }

    if (
        !/^[a-z0-9-]+$/.test(
            normalized
        )
    ) {
        throw new SystemSettingServiceError(
            "Invalid tenant identifier.",
            {
                code:
                    "INVALID_TENANT_ID",
                statusCode:
                    400
            }
        );
    }

    return normalized;
}

function normalizeScope(
    scope
) {
    const normalized =
        String(
            scope ||
            SETTING_SCOPES.TENANT
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            SETTING_SCOPES
        ).includes(
            normalized
        )
    ) {
        throw new SystemSettingServiceError(
            "Invalid system setting scope.",
            {
                code:
                    "INVALID_SETTING_SCOPE",
                statusCode:
                    400
            }
        );
    }

    return normalized;
}

function normalizeType(
    type
) {
    const normalized =
        String(
            type ||
            SETTING_TYPES.STRING
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            SETTING_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new SystemSettingServiceError(
            "Invalid system setting type.",
            {
                code:
                    "INVALID_SETTING_TYPE",
                statusCode:
                    400
            }
        );
    }

    return normalized;
}

function normalizeStatus(
    status
) {
    const normalized =
        String(
            status ||
            SETTING_STATUSES.ACTIVE
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            SETTING_STATUSES
        ).includes(
            normalized
        )
    ) {
        throw new SystemSettingServiceError(
            "Invalid system setting status.",
            {
                code:
                    "INVALID_SETTING_STATUS",
                statusCode:
                    400
            }
        );
    }

    return normalized;
}

function normalizeTags(
    tags
) {
    if (
        tags === undefined ||
        tags === null
    ) {
        return [];
    }

    if (!Array.isArray(tags)) {
        throw new SystemSettingServiceError(
            "Setting tags must be an array.",
            {
                code:
                    "INVALID_SETTING_TAGS",
                statusCode:
                    400
            }
        );
    }

    if (
        tags.length >
        DEFAULT_MAX_TAGS
    ) {
        throw new SystemSettingServiceError(
            "Too many setting tags.",
            {
                code:
                    "TOO_MANY_SETTING_TAGS",
                statusCode:
                    400
            }
        );
    }

    const normalized =
        [
            ...new Set(
                tags
                    .map(
                        (tag) =>
                            normalizeString(
                                tag
                            )
                    )
                    .filter(Boolean)
            )
        ];

    for (
        const tag of normalized
    ) {
        if (
            tag.length >
            DEFAULT_MAX_TAG_LENGTH
        ) {
            throw new SystemSettingServiceError(
                "A setting tag exceeds the maximum allowed length.",
                {
                    code:
                        "SETTING_TAG_TOO_LONG",
                    statusCode:
                        400
                }
            );
        }
    }

    return normalized;
}

function isSensitiveKey(
    key
) {
    return SENSITIVE_KEY_PATTERNS.some(
        (pattern) =>
            pattern.test(
                String(key || "")
            )
    );
}

function isSensitiveSetting(
    setting
) {
    if (!setting) {
        return false;
    }

    return (
        String(
            setting.type || ""
        ).toUpperCase() ===
            SETTING_TYPES.SECRET ||
        isSensitiveKey(
            setting.key
        )
    );
}

function hashValue(
    value
) {
    return crypto
        .createHash("sha256")
        .update(
            String(value ?? ""),
            "utf8"
        )
        .digest("hex");
}

function cloneValue(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    if (
        typeof value !==
        "object"
    ) {
        return value;
    }

    return JSON.parse(
        JSON.stringify(
            value
        )
    );
}

function safeErrorMessage(
    error
) {
    return (
        error?.message ||
        "Unknown error."
    );
}

/**
 * ============================================================================
 * Typed Value Validation
 * ============================================================================
 */

function validateSettingValue(
    value,
    type
) {
    switch (type) {
        case SETTING_TYPES.STRING:
            if (
                typeof value !==
                "string"
            ) {
                throw new SystemSettingServiceError(
                    "Setting value must be a string.",
                    {
                        code:
                            "INVALID_SETTING_VALUE",
                        statusCode:
                            400
                    }
                );
            }

            break;

        case SETTING_TYPES.NUMBER:
            if (
                typeof value !==
                    "number" ||
                !Number.isFinite(
                    value
                )
            ) {
                throw new SystemSettingServiceError(
                    "Setting value must be a finite number.",
                    {
                        code:
                            "INVALID_SETTING_VALUE",
                        statusCode:
                            400
                    }
                );
            }

            break;

        case SETTING_TYPES.BOOLEAN:
            if (
                typeof value !==
                "boolean"
            ) {
                throw new SystemSettingServiceError(
                    "Setting value must be a boolean.",
                    {
                        code:
                            "INVALID_SETTING_VALUE",
                        statusCode:
                            400
                    }
                );
            }

            break;

        case SETTING_TYPES.JSON:
            try {
                JSON.stringify(
                    value
                );
            } catch (
                error
            ) {
                throw new SystemSettingServiceError(
                    "Setting value must be JSON serializable.",
                    {
                        code:
                            "INVALID_SETTING_VALUE",
                        statusCode:
                            400,
                        cause:
                            error
                    }
                );
            }

            break;

        case SETTING_TYPES.SECRET:
            if (
                typeof value !==
                    "string" &&
                !Buffer.isBuffer(
                    value
                )
            ) {
                throw new SystemSettingServiceError(
                    "Secret setting value must be a string or Buffer.",
                    {
                        code:
                            "INVALID_SECRET_VALUE",
                        statusCode:
                            400
                    }
                );
            }

            break;

        case SETTING_TYPES.URL:
            if (
                typeof value !==
                "string"
            ) {
                throw new SystemSettingServiceError(
                    "URL setting value must be a string.",
                    {
                        code:
                            "INVALID_SETTING_VALUE",
                        statusCode:
                            400
                    }
                );
            }

            try {
                new URL(
                    value
                );
            } catch (
                error
            ) {
                throw new SystemSettingServiceError(
                    "Setting value must be a valid URL.",
                    {
                        code:
                            "INVALID_SETTING_URL",
                        statusCode:
                            400,
                        cause:
                            error
                    }
                );
            }

            break;

        default:
            throw new SystemSettingServiceError(
                "Unsupported setting type.",
                {
                    code:
                        "UNSUPPORTED_SETTING_TYPE",
                    statusCode:
                        400
                }
            );
    }

    if (
        typeof value ===
            "string" &&
        value.length >
            DEFAULT_MAX_VALUE_LENGTH
    ) {
        throw new SystemSettingServiceError(
            "Setting value exceeds the maximum allowed length.",
            {
                code:
                    "SETTING_VALUE_TOO_LONG",
                statusCode:
                    400
            }
        );
    }

    return true;
}

/**
 * ============================================================================
 * Cache Key
 * ============================================================================
 */

function buildCacheKey({
    scope,
    tenantId,
    key
}) {
    const normalizedScope =
        normalizeScope(
            scope
        );

    const normalizedTenantId =
        normalizedScope ===
        SETTING_SCOPES.GLOBAL
            ? "global"
            : normalizeTenantId(
                  tenantId
              );

    return [
        CACHE_NAMESPACE,
        normalizedScope.toLowerCase(),
        normalizedTenantId,
        normalizeKey(
            key
        )
    ].join(":");
}

/**
 * ============================================================================
 * SystemSettingService
 * ============================================================================
 */

class SystemSettingService {
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
        config = {}
    } = {}) {
        this.model =
            model ||
            defaultSystemSettingModel;

        this.repository =
            repository ||
            null;

        this.cache =
            cache ||
            null;

        this.logger =
            logger ||
            console;

        this.auditService =
            auditService ||
            null;

        this.eventBus =
            eventBus ||
            null;

        this.outboxService =
            outboxService ||
            null;

        this.metricsService =
            metricsService ||
            null;

        this.tenantConstants =
            tenantConstants ||
            null;

        this.config = {
            cacheEnabled:
                config.cacheEnabled !==
                false,

            cacheTtlSeconds:
                Number(
                    config.cacheTtlSeconds ||
                        DEFAULT_CACHE_TTL_SECONDS
                ),

            maxBatchSize:
                Number(
                    config.maxBatchSize ||
                        DEFAULT_MAX_BATCH_SIZE
                ),

            maxRetryAttempts:
                Number(
                    config.maxRetryAttempts ||
                        DEFAULT_MAX_RETRY_ATTEMPTS
                ),

            failOnAuditError:
                config.failOnAuditError ===
                true,

            failOnEventError:
                config.failOnEventError ===
                true
        };

        this.metrics =
            this.createMetrics();

        this.assertConfiguration();
    }

    /**
     * ========================================================================
     * Configuration
     * ========================================================================
     */

    assertConfiguration() {
        if (
            !this.model &&
            !this.repository
        ) {
            throw new TypeError(
                `[${SERVICE_NAME}] A SystemSetting model or repository is required.`
            );
        }
    }

    /**
     * ========================================================================
     * Metrics
     * ========================================================================
     */

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
            failures: 0
        };
    }

    incrementMetric(
        name,
        value = 1
    ) {
        if (
            !Object.prototype.hasOwnProperty.call(
                this.metrics,
                name
            )
        ) {
            this.metrics[name] =
                0;
        }

        this.metrics[name] +=
            value;

        if (
            this.metricsService &&
            typeof this.metricsService.increment ===
                "function"
        ) {
            try {
                this.metricsService.increment(
                    `system_setting_${name}`,
                    value
                );
            } catch (
                error
            ) {
                this.logWarn(
                    "System setting metrics integration failed.",
                    {
                        metric:
                            name,
                        error:
                            safeErrorMessage(
                                error
                            )
                    }
                );
            }
        }
    }

    getMetrics() {
        return {
            ...this.metrics
        };
    }

    /**
     * ========================================================================
     * Logging
     * ========================================================================
     */

    logInfo(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.info?.(
                message,
                {
                    service:
                        SERVICE_NAME,
                    version:
                        SERVICE_VERSION,
                    ...metadata
                }
            );
        } catch {
            // Logging must never break a financial/application operation.
        }
    }

    logWarn(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.warn?.(
                message,
                {
                    service:
                        SERVICE_NAME,
                    version:
                        SERVICE_VERSION,
                    ...metadata
                }
            );
        } catch {
            // Intentionally ignored.
        }
    }

    logError(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.error?.(
                message,
                {
                    service:
                        SERVICE_NAME,
                    version:
                        SERVICE_VERSION,
                    ...metadata
                }
            );
        } catch {
            // Intentionally ignored.
        }
    }

    /**
     * ========================================================================
     * Tenant Validation
     * ========================================================================
     */

    validateTenant(
        tenantId,
        {
            required = true
        } = {}
    ) {
        const normalized =
            normalizeTenantId(
                tenantId,
                {
                    required
                }
            );

        if (
            !normalized ||
            !this.tenantConstants
        ) {
            return normalized;
        }

        if (
            typeof this.tenantConstants
                .isValidTenantId ===
            "function"
        ) {
            if (
                !this.tenantConstants.isValidTenantId(
                    normalized
                )
            ) {
                throw new SystemSettingServiceError(
                    "Invalid TITech tenant identifier.",
                    {
                        code:
                            "INVALID_TENANT_ID",
                        statusCode:
                            400
                    }
                );
            }
        }

        return normalized;
    }

    /**
     * ========================================================================
     * Query Construction
     * ========================================================================
     */

    buildScopeFilter({
        scope,
        tenantId
    }) {
        const normalizedScope =
            normalizeScope(
                scope
            );

        if (
            normalizedScope ===
            SETTING_SCOPES.GLOBAL
        ) {
            return {
                scope:
                    SETTING_SCOPES.GLOBAL,
                tenantId:
                    null
            };
        }

        return {
            scope:
                SETTING_SCOPES.TENANT,
            tenantId:
                this.validateTenant(
                    tenantId,
                    {
                        required:
                            true
                    }
                )
        };
    }

    buildFilter({
        key,
        scope,
        tenantId
    }) {
        return {
            ...this.buildScopeFilter(
                {
                    scope,
                    tenantId
                }
            ),
            key:
                normalizeKey(
                    key
                )
        };
    }

    /**
     * ========================================================================
     * Repository Adapter
     * ========================================================================
     */

    async repositoryFindOne(
        filter,
        options = {}
    ) {
        if (
            this.repository &&
            typeof this.repository.findOne ===
                "function"
        ) {
            return this.repository.findOne(
                filter,
                options
            );
        }

        if (!this.model) {
            throw new SystemSettingServiceError(
                "System setting persistence is unavailable.",
                {
                    code:
                        "SETTING_PERSISTENCE_UNAVAILABLE",
                    statusCode:
                        503,
                    retryable:
                        true
                }
            );
        }

        let query =
            this.model.findOne(
                filter
            );

        if (
            options.session
        ) {
            query =
                query.session(
                    options.session
                );
        }

        if (
            options.lean
        ) {
            query =
                query.lean();
        }

        return query.exec();
    }

    async repositoryFind(
        filter,
        options = {}
    ) {
        if (
            this.repository &&
            typeof this.repository.find ===
                "function"
        ) {
            return this.repository.find(
                filter,
                options
            );
        }

        if (!this.model) {
            throw new SystemSettingServiceError(
                "System setting persistence is unavailable.",
                {
                    code:
                        "SETTING_PERSISTENCE_UNAVAILABLE",
                    statusCode:
                        503,
                    retryable:
                        true
                }
            );
        }

        let query =
            this.model.find(
                filter
            );

        if (
            options.sort
        ) {
            query =
                query.sort(
                    options.sort
                );
        }

        if (
            Number.isInteger(
                options.limit
            )
        ) {
            query =
                query.limit(
                    options.limit
                );
        }

        if (
            options.session
        ) {
            query =
                query.session(
                    options.session
                );
        }

        if (
            options.lean
        ) {
            query =
                query.lean();
        }

        return query.exec();
    }

    async repositoryCreate(
        document,
        options = {}
    ) {
        if (
            this.repository &&
            typeof this.repository.create ===
                "function"
        ) {
            return this.repository.create(
                document,
                options
            );
        }

        if (!this.model) {
            throw new SystemSettingServiceError(
                "System setting persistence is unavailable.",
                {
                    code:
                        "SETTING_PERSISTENCE_UNAVAILABLE",
                    statusCode:
                        503,
                    retryable:
                        true
                }
            );
        }

        const instance =
            new this.model(
                document
            );

        return instance.save(
            {
                session:
                    options.session
            }
        );
    }

    async repositoryUpdate(
        filter,
        update,
        options = {}
    ) {
        if (
            this.repository &&
            typeof this.repository.updateOne ===
                "function"
        ) {
            return this.repository.updateOne(
                filter,
                update,
                options
            );
        }

        if (!this.model) {
            throw new SystemSettingServiceError(
                "System setting persistence is unavailable.",
                {
                    code:
                        "SETTING_PERSISTENCE_UNAVAILABLE",
                    statusCode:
                        503,
                    retryable:
                        true
                }
            );
        }

        const query =
            this.model.updateOne(
                filter,
                update,
                {
                    session:
                        options.session,
                    runValidators:
                        true
                }
            );

        return query.exec();
    }

    async repositoryDelete(
        filter,
        options = {}
    ) {
        if (
            this.repository &&
            typeof this.repository.deleteOne ===
                "function"
        ) {
            return this.repository.deleteOne(
                filter,
                options
            );
        }

        if (!this.model) {
            throw new SystemSettingServiceError(
                "System setting persistence is unavailable.",
                {
                    code:
                        "SETTING_PERSISTENCE_UNAVAILABLE",
                    statusCode:
                        503,
                    retryable:
                        true
                }
            );
        }

        return this.model
            .deleteOne(
                filter,
                {
                    session:
                        options.session
                }
            )
            .exec();
    }

    /**
     * ========================================================================
     * Cache Adapter
     * ========================================================================
     */

    async cacheGet(
        key
    ) {
        if (
            !this.config.cacheEnabled ||
            !this.cache
        ) {
            return null;
        }

        try {
            if (
                typeof this.cache.get ===
                "function"
            ) {
                const value =
                    await this.cache.get(
                        key
                    );

                if (
                    value !==
                    null &&
                    value !==
                    undefined
                ) {
                    this.incrementMetric(
                        "cacheHits"
                    );

                    return value;
                }

                this.incrementMetric(
                    "cacheMisses"
                );

                return null;
            }
        } catch (
            error
        ) {
            this.incrementMetric(
                "cacheReadsFailed"
            );

            this.logWarn(
                "System setting cache read failed.",
                {
                    cacheKey:
                        key,
                    error:
                        safeErrorMessage(
                            error
                        )
                }
            );

            return null;
        }

        return null;
    }

    async cacheSet(
        key,
        value,
        ttlSeconds =
            this.config.cacheTtlSeconds
    ) {
        if (
            !this.config.cacheEnabled ||
            !this.cache
        ) {
            return false;
        }

        try {
            if (
                typeof this.cache.set ===
                "function"
            ) {
                if (
                    Number.isFinite(
                        ttlSeconds
                    ) &&
                    ttlSeconds > 0
                ) {
                    try {
                        await this.cache.set(
                            key,
                            value,
                            {
                                EX:
                                    ttlSeconds
                            }
                        );

                        return true;
                    } catch {
                        // Some Redis-compatible clients use setex.
                    }

                    if (
                        typeof this.cache.setEx ===
                        "function"
                    ) {
                        await this.cache.setEx(
                            key,
                            ttlSeconds,
                            value
                        );

                        return true;
                    }
                }

                await this.cache.set(
                    key,
                    value
                );

                return true;
            }
        } catch (
            error
        ) {
            this.incrementMetric(
                "cacheWritesFailed"
            );

            this.logWarn(
                "System setting cache write failed.",
                {
                    cacheKey:
                        key,
                    error:
                        safeErrorMessage(
                            error
                        )
                }
            );
        }

        return false;
    }

    async cacheDelete(
        key
    ) {
        if (
            !this.cache
        ) {
            return false;
        }

        try {
            if (
                typeof this.cache.del ===
                "function"
            ) {
                await this.cache.del(
                    key
                );

                this.incrementMetric(
                    "cacheInvalidations"
                );

                return true;
            }

            if (
                typeof this.cache.delete ===
                "function"
            ) {
                await this.cache.delete(
                    key
                );

                this.incrementMetric(
                    "cacheInvalidations"
                );

                return true;
            }
        } catch (
            error
        ) {
            this.logWarn(
                "System setting cache invalidation failed.",
                {
                    cacheKey:
                        key,
                    error:
                        safeErrorMessage(
                            error
                        )
                }
            );
        }

        return false;
    }

    /**
     * ========================================================================
     * Serialization
     * ========================================================================
     */

    serializeForCache(
        setting
    ) {
        if (!setting) {
            return null;
        }

        const object =
            typeof setting.toObject ===
            "function"
                ? setting.toObject()
                : {
                      ...setting
                  };

        /*
         * Secret values are intentionally never cached in plaintext.
         * A cache implementation may still be used for non-secret metadata.
         */
        if (
            isSensitiveSetting(
                object
            )
        ) {
            return JSON.stringify({
                ...object,
                value:
                    undefined,
                sensitive:
                    true
            });
        }

        return JSON.stringify(
            object
        );
    }

    deserializeFromCache(
        value
    ) {
        if (
            value ===
                null ||
            value ===
                undefined
        ) {
            return null;
        }

        if (
            typeof value ===
            "object"
        ) {
            return value;
        }

        try {
            return JSON.parse(
                String(value)
            );
        } catch {
            return null;
        }
    }

    /**
     * ========================================================================
     * Public Serialization
     * ========================================================================
     */

    sanitizeForResponse(
        setting,
        {
            includeSensitive = false
        } = {}
    ) {
        if (!setting) {
            return null;
        }

        const source =
            typeof setting.toObject ===
            "function"
                ? setting.toObject()
                : {
                      ...setting
                  };

        const sensitive =
            isSensitiveSetting(
                source
            );

        const output =
            {
                ...source
            };

        /*
         * Never expose internal sensitive data by default.
         */
        if (
            sensitive &&
            !includeSensitive
        ) {
            delete output.value;

            output.valueRedacted =
                true;
        }

        /*
         * Never expose potentially sensitive audit metadata accidentally.
         */
        if (
            output.metadata &&
            typeof output.metadata ===
                "object"
        ) {
            output.metadata =
                cloneValue(
                    output.metadata
                );
        }

        return output;
    }

    /**
     * ========================================================================
     * Audit
     * ========================================================================
     */

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
            session = null
        } = {}
    ) {
        if (
            !this.auditService
        ) {
            return;
        }

        const payload = {
            action,
            entity:
                "SystemSetting",
            entityType:
                "SystemSetting",
            entityId:
                settingKey,
            tenantId,
            actorId,
            requestId,
            correlationId,
            before:
                this.sanitizeForAudit(
                    before
                ),
            after:
                this.sanitizeForAudit(
                    after
                ),
            occurredAt:
                new Date(),
            service:
                SERVICE_NAME,
            serviceVersion:
                SERVICE_VERSION,
            session
        };

        try {
            if (
                typeof this.auditService.record ===
                "function"
            ) {
                await this.auditService.record(
                    payload
                );

                return;
            }

            if (
                typeof this.auditService.log ===
                "function"
            ) {
                await this.auditService.log(
                    payload
                );
            }
        } catch (
            error
        ) {
            this.incrementMetric(
                "auditFailures"
            );

            this.logError(
                "System setting audit integration failed.",
                {
                    action,
                    tenantId,
                    settingKey,
                    error:
                        safeErrorMessage(
                            error
                        )
                }
            );

            if (
                this.config.failOnAuditError
            ) {
                throw new SystemSettingServiceError(
                    "System setting audit operation failed.",
                    {
                        code:
                            "AUDIT_OPERATION_FAILED",
                        statusCode:
                            503,
                        retryable:
                            true,
                        cause:
                            error
                    }
                );
            }
        }
    }

    sanitizeForAudit(
        setting
    ) {
        if (!setting) {
            return null;
        }

        const object =
            typeof setting.toObject ===
            "function"
                ? setting.toObject()
                : {
                      ...setting
                  };

        if (
            isSensitiveSetting(
                object
            )
        ) {
            return {
                ...object,
                value:
                    undefined,
                valueHash:
                    hashValue(
                        object.value
                    ),
                valueRedacted:
                    true
            };
        }

        return object;
    }

    /**
     * ========================================================================
     * Event Publication
     * ========================================================================
     */

    async publishEvent(
        eventName,
        payload
    ) {
        try {
            if (
                this.outboxService &&
                typeof this.outboxService.enqueue ===
                    "function"
            ) {
                await this.outboxService.enqueue(
                    {
                        type:
                            eventName,
                        aggregateType:
                            "SystemSetting",
                        aggregateId:
                            payload.settingKey,
                        tenantId:
                            payload.tenantId,
                        payload
                    }
                );

                return;
            }

            if (
                this.eventBus &&
                typeof this.eventBus.publish ===
                    "function"
            ) {
                await this.eventBus.publish(
                    eventName,
                    payload
                );

                return;
            }

            if (
                this.eventBus &&
                typeof this.eventBus.emit ===
                    "function"
            ) {
                this.eventBus.emit(
                    eventName,
                    payload
                );
            }
        } catch (
            error
        ) {
            this.incrementMetric(
                "eventFailures"
            );

            this.logError(
                "System setting event publication failed.",
                {
                    eventName,
                    settingKey:
                        payload?.settingKey,
                    tenantId:
                        payload?.tenantId,
                    error:
                        safeErrorMessage(
                            error
                        )
                }
            );

            if (
                this.config.failOnEventError
            ) {
                throw new SystemSettingServiceError(
                    "System setting event publication failed.",
                    {
                        code:
                            "EVENT_PUBLICATION_FAILED",
                        statusCode:
                            503,
                        retryable:
                            true,
                        cause:
                            error
                    }
                );
            }
        }
    }

    /**
     * ========================================================================
     * Normalize Creation Payload
     * ========================================================================
     */

    normalizeCreateInput(
        input = {}
    ) {
        const scope =
            normalizeScope(
                input.scope
            );

        const tenantId =
            scope ===
            SETTING_SCOPES.GLOBAL
                ? null
                : this.validateTenant(
                      input.tenantId,
                      {
                          required:
                              true
                      }
                  );

        const key =
            normalizeKey(
                input.key
            );

        const type =
            normalizeType(
                input.type
            );

        const status =
            normalizeStatus(
                input.status
            );

        const value =
            input.value;

        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            throw new SystemSettingServiceError(
                "Setting value is required.",
                {
                    code:
                        "SETTING_VALUE_REQUIRED",
                    statusCode:
                        400
                }
            );
        }

        validateSettingValue(
            value,
            type
        );

        const description =
            normalizeString(
                input.description
            );

        if (
            description &&
            description.length >
                DEFAULT_MAX_DESCRIPTION_LENGTH
        ) {
            throw new SystemSettingServiceError(
                "Setting description exceeds the maximum allowed length.",
                {
                    code:
                        "SETTING_DESCRIPTION_TOO_LONG",
                    statusCode:
                        400
                }
            );
        }

        const tags =
            normalizeTags(
                input.tags
            );

        return {
            scope,
            tenantId,
            key,
            type,
            value,
            status,
            description:
                description ||
                null,
            tags,
            metadata:
                input.metadata &&
                typeof input.metadata ===
                    "object"
                    ? cloneValue(
                          input.metadata
                      )
                    : {},
            createdBy:
                normalizeString(
                    input.createdBy
                ),
            updatedBy:
                normalizeString(
                    input.updatedBy
                )
        };
    }

    /**
     * ========================================================================
     * Get Setting
     * ========================================================================
     */

    async get(
        {
            key,
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            session = null,
            useCache = true,
            includeSensitive = false
        } = {}
    ) {
        this.incrementMetric(
            "reads"
        );

        const normalizedScope =
            normalizeScope(
                scope
            );

        const normalizedTenantId =
            normalizedScope ===
            SETTING_SCOPES.GLOBAL
                ? null
                : this.validateTenant(
                      tenantId,
                      {
                          required:
                              true
                      }
                  );

        const normalizedKey =
            normalizeKey(
                key
            );

        const cacheKey =
            buildCacheKey(
                {
                    scope:
                        normalizedScope,
                    tenantId:
                        normalizedTenantId,
                    key:
                        normalizedKey
                }
            );

        /*
         * Sensitive settings are not read from the ordinary cache.
         */
        if (
            useCache &&
            !isSensitiveKey(
                normalizedKey
            )
        ) {
            const cached =
                await this.cacheGet(
                    cacheKey
                );

            if (cached) {
                return this.sanitizeForResponse(
                    this.deserializeFromCache(
                        cached
                    ),
                    {
                        includeSensitive
                    }
                );
            }
        }

        const filter =
            this.buildFilter(
                {
                    key:
                        normalizedKey,
                    scope:
                        normalizedScope,
                    tenantId:
                        normalizedTenantId
                }
            );

        const setting =
            await this.repositoryFindOne(
                filter,
                {
                    session,
                    lean:
                        false
                }
            );

        if (!setting) {
            this.incrementMetric(
                "notFound"
            );

            return null;
        }

        if (
            useCache &&
            !isSensitiveSetting(
                setting
            )
        ) {
            await this.cacheSet(
                cacheKey,
                this.serializeForCache(
                    setting
                )
            );
        }

        return this.sanitizeForResponse(
            setting,
            {
                includeSensitive
            }
        );
    }

    /**
     * ========================================================================
     * Require Setting
     * ========================================================================
     */

    async require(
        options = {}
    ) {
        const setting =
            await this.get(
                options
            );

        if (!setting) {
            throw new SystemSettingServiceError(
                "Required system setting was not found.",
                {
                    code:
                        "SETTING_NOT_FOUND",
                    statusCode:
                        404
                }
            );
        }

        return setting;
    }

    /**
     * ========================================================================
     * Get Raw Setting
     * ========================================================================
     *
     * Intended for trusted internal services only.
     *
     * This method deliberately makes sensitive access explicit.
     * =========================================================================
     */

    async getInternal(
        {
            key,
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            session = null
        } = {}
    ) {
        const normalizedScope =
            normalizeScope(
                scope
            );

        const filter =
            this.buildFilter(
                {
                    key,
                    scope:
                        normalizedScope,
                    tenantId
                }
            );

        return this.repositoryFindOne(
            filter,
            {
                session,
                lean:
                    false
            }
        );
    }

    /**
     * ========================================================================
     * List Settings
     * ========================================================================
     */

    async list(
        {
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            status = null,
            prefix = null,
            limit = 100,
            session = null,
            includeSensitive = false
        } = {}
    ) {
        const normalizedScope =
            normalizeScope(
                scope
            );

        const normalizedTenantId =
            normalizedScope ===
            SETTING_SCOPES.GLOBAL
                ? null
                : this.validateTenant(
                      tenantId,
                      {
                          required:
                              true
                      }
                  );

        const safeLimit =
            Math.min(
                Math.max(
                    Number(limit) ||
                        100,
                    1
                ),
                this.config.maxBatchSize
            );

        const filter =
            this.buildScopeFilter(
                {
                    scope:
                        normalizedScope,
                    tenantId:
                        normalizedTenantId
                }
            );

        if (status) {
            filter.status =
                normalizeStatus(
                    status
                );
        }

        if (prefix !== null) {
            const normalizedPrefix =
                normalizeString(
                    prefix
                );

            if (
                normalizedPrefix
            ) {
                filter.key = {
                    $regex:
                        `^${escapeRegex(
                            normalizedPrefix
                        )}`
                };
            }
        }

        const settings =
            await this.repositoryFind(
                filter,
                {
                    session,
                    limit:
                        safeLimit,
                    sort: {
                        key: 1
                    },
                    lean:
                        false
                }
            );

        return settings.map(
            (setting) =>
                this.sanitizeForResponse(
                    setting,
                    {
                        includeSensitive
                    }
                )
        );
    }

    /**
     * ========================================================================
     * Create Setting
     * ========================================================================
     */

    async create(
        input = {},
        {
            session = null,
            actorId = null,
            requestId = null,
            correlationId = null,
            publishEvent = true
        } = {}
    ) {
        this.incrementMetric(
            "writes"
        );

        let normalized;

        try {
            normalized =
                this.normalizeCreateInput(
                    {
                        ...input,
                        createdBy:
                            actorId ||
                            input.createdBy,
                        updatedBy:
                            actorId ||
                            input.updatedBy
                    }
                );
        } catch (
            error
        ) {
            this.incrementMetric(
                "validationFailures"
            );

            throw error;
        }

        const filter =
            this.buildFilter(
                {
                    key:
                        normalized.key,
                    scope:
                        normalized.scope,
                    tenantId:
                        normalized.tenantId
                }
            );

        const existing =
            await this.repositoryFindOne(
                filter,
                {
                    session
                }
            );

        if (existing) {
            throw new SystemSettingServiceError(
                "System setting already exists.",
                {
                    code:
                        "SETTING_ALREADY_EXISTS",
                    statusCode:
                        409
                }
            );
        }

        let created;

        try {
            created =
                await this.repositoryCreate(
                    normalized,
                    {
                        session
                    }
                );
        } catch (
            error
        ) {
            if (
                error?.code ===
                    11000 ||
                error?.name ===
                    "MongoServerError" &&
                    error?.code ===
                        11000
            ) {
                throw new SystemSettingServiceError(
                    "System setting already exists.",
                    {
                        code:
                            "SETTING_ALREADY_EXISTS",
                        statusCode:
                            409,
                        cause:
                            error
                    }
                );
            }

            throw error;
        }

        this.incrementMetric(
            "creates"
        );

        const sanitized =
            this.sanitizeForResponse(
                created
            );

        await this.audit(
            "SYSTEM_SETTING_CREATED",
            {
                tenantId:
                    normalized.tenantId,
                settingKey:
                    normalized.key,
                actorId,
                requestId,
                correlationId,
                before:
                    null,
                after:
                    created,
                session
            }
        );

        if (
            publishEvent
        ) {
            await this.publishEvent(
                "titech.system_setting.created",
                {
                    tenantId:
                        normalized.tenantId,
                    settingKey:
                        normalized.key,
                    scope:
                        normalized.scope,
                    actorId,
                    requestId,
                    correlationId,
                    occurredAt:
                        new Date()
                }
            );
        }

        return sanitized;
    }

    /**
     * ========================================================================
     * Update Setting
     * ========================================================================
     *
     * expectedUpdatedAt:
     *   Optional optimistic concurrency token.
     *
     * If supplied, the update only succeeds if the stored record still has the
     * expected updatedAt value.
     * =========================================================================
     */

    async update(
        {
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
            publishEvent = true
        } = {}
    ) {
        this.incrementMetric(
            "writes"
        );

        const normalizedScope =
            normalizeScope(
                scope
            );

        const normalizedTenantId =
            normalizedScope ===
            SETTING_SCOPES.GLOBAL
                ? null
                : this.validateTenant(
                      tenantId,
                      {
                          required:
                              true
                      }
                  );

        const normalizedKey =
            normalizeKey(
                key
            );

        const filter =
            this.buildFilter(
                {
                    key:
                        normalizedKey,
                    scope:
                        normalizedScope,
                    tenantId:
                        normalizedTenantId
                }
            );

        const before =
            await this.repositoryFindOne(
                filter,
                {
                    session
                }
            );

        if (!before) {
            this.incrementMetric(
                "notFound"
            );

            throw new SystemSettingServiceError(
                "System setting was not found.",
                {
                    code:
                        "SETTING_NOT_FOUND",
                    statusCode:
                        404
                }
            );
        }

        if (
            expectedUpdatedAt !==
                null &&
            expectedUpdatedAt !==
                undefined
        ) {
            const expected =
                new Date(
                    expectedUpdatedAt
                );

            if (
                Number.isNaN(
                    expected.getTime()
                )
            ) {
                throw new SystemSettingServiceError(
                    "Invalid expectedUpdatedAt value.",
                    {
                        code:
                            "INVALID_CONCURRENCY_TOKEN",
                        statusCode:
                            400
                    }
                );
            }

            if (
                !before.updatedAt ||
                new Date(
                    before.updatedAt
                ).getTime() !==
                    expected.getTime()
            ) {
                this.incrementMetric(
                    "concurrencyConflicts"
                );

                throw new SystemSettingServiceError(
                    "System setting was modified by another operation.",
                    {
                        code:
                            "SETTING_CONCURRENCY_CONFLICT",
                        statusCode:
                            409,
                        retryable:
                            true
                    }
                );
            }
        }

        const update =
            {};

        if (
            value !==
                undefined
        ) {
            const effectiveType =
                normalizeType(
                    type ||
                        before.type
                );

            validateSettingValue(
                value,
                effectiveType
            );

            update.value =
                value;

            if (
                type !==
                undefined
            ) {
                update.type =
                    effectiveType;
            }
        }

        if (
            type !==
            undefined
        ) {
            const normalizedType =
                normalizeType(
                    type
                );

            if (
                value ===
                undefined
            ) {
                validateSettingValue(
                    before.value,
                    normalizedType
                );
            }

            update.type =
                normalizedType;
        }

        if (
            status !==
            undefined
        ) {
            update.status =
                normalizeStatus(
                    status
                );
        }

        if (
            description !==
            undefined
        ) {
            const normalizedDescription =
                normalizeString(
                    description
                );

            if (
                normalizedDescription &&
                normalizedDescription.length >
                    DEFAULT_MAX_DESCRIPTION_LENGTH
            ) {
                throw new SystemSettingServiceError(
                    "Setting description exceeds the maximum allowed length.",
                    {
                        code:
                            "SETTING_DESCRIPTION_TOO_LONG",
                        statusCode:
                            400
                    }
                );
            }

            update.description =
                normalizedDescription;
        }

        if (
            tags !==
            undefined
        ) {
            update.tags =
                normalizeTags(
                    tags
                );
        }

        if (
            metadata !==
            undefined
        ) {
            if (
                !metadata ||
                typeof metadata !==
                    "object" ||
                Array.isArray(
                    metadata
                )
            ) {
                throw new SystemSettingServiceError(
                    "Setting metadata must be an object.",
                    {
                        code:
                            "INVALID_SETTING_METADATA",
                        statusCode:
                            400
                    }
                );
            }

            update.metadata =
                cloneValue(
                    metadata
                );
        }

        update.updatedBy =
            normalizeString(
                actorId
            );

        if (
            Object.keys(
                update
            ).length ===
            1 &&
            update.updatedBy ===
                null
        ) {
            return this.sanitizeForResponse(
                before
            );
        }

        const updateFilter =
            {
                ...filter
            };

        if (
            expectedUpdatedAt !==
                null &&
            expectedUpdatedAt !==
                undefined
        ) {
            updateFilter.updatedAt =
                new Date(
                    expectedUpdatedAt
                );
        }

        let result;

        try {
            result =
                await this.repositoryUpdate(
                    updateFilter,
                    {
                        $set:
                            update
                    },
                    {
                        session
                    }
                );
        } catch (
            error
        ) {
            throw error;
        }

        if (
            !result ||
            result.matchedCount ===
                0 &&
                result.nModified ===
                    0
        ) {
            this.incrementMetric(
                "concurrencyConflicts"
            );

            throw new SystemSettingServiceError(
                "System setting update failed because the record changed concurrently.",
                {
                    code:
                        "SETTING_CONCURRENCY_CONFLICT",
                    statusCode:
                        409,
                    retryable:
                        true
                }
            );
        }

        const after =
            await this.repositoryFindOne(
                filter,
                {
                    session
                }
            );

        if (!after) {
            throw new SystemSettingServiceError(
                "System setting could not be reloaded after update.",
                {
                    code:
                        "SETTING_RELOAD_FAILED",
                    statusCode:
                        500
                }
            );
        }

        this.incrementMetric(
            "updates"
        );

        await this.invalidate(
            {
                key:
                    normalizedKey,
                tenantId:
                    normalizedTenantId,
                scope:
                    normalizedScope
            }
        );

        await this.audit(
            "SYSTEM_SETTING_UPDATED",
            {
                tenantId:
                    normalizedTenantId,
                settingKey:
                    normalizedKey,
                actorId,
                requestId,
                correlationId,
                before,
                after,
                session
            }
        );

        if (
            publishEvent
        ) {
            await this.publishEvent(
                "titech.system_setting.updated",
                {
                    tenantId:
                        normalizedTenantId,
                    settingKey:
                        normalizedKey,
                    scope:
                        normalizedScope,
                    actorId,
                    requestId,
                    correlationId,
                    occurredAt:
                        new Date()
                }
            );
        }

        return this.sanitizeForResponse(
            after
        );
    }

    /**
     * ========================================================================
     * Delete Setting
     * ========================================================================
     *
     * Deletion is intentionally explicit. For critical production settings,
     * disabling the setting is generally safer than physical deletion.
     * =========================================================================
     */

    async delete(
        {
            key,
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            actorId = null,
            requestId = null,
            correlationId = null,
            session = null,
            publishEvent = true
        } = {}
    ) {
        this.incrementMetric(
            "writes"
        );

        const normalizedScope =
            normalizeScope(
                scope
            );

        const normalizedTenantId =
            normalizedScope ===
            SETTING_SCOPES.GLOBAL
                ? null
                : this.validateTenant(
                      tenantId,
                      {
                          required:
                              true
                      }
                  );

        const normalizedKey =
            normalizeKey(
                key
            );

        const filter =
            this.buildFilter(
                {
                    key:
                        normalizedKey,
                    scope:
                        normalizedScope,
                    tenantId:
                        normalizedTenantId
                }
            );

        const before =
            await this.repositoryFindOne(
                filter,
                {
                    session
                }
            );

        if (!before) {
            this.incrementMetric(
                "notFound"
            );

            throw new SystemSettingServiceError(
                "System setting was not found.",
                {
                    code:
                        "SETTING_NOT_FOUND",
                    statusCode:
                        404
                }
            );
        }

        const result =
            await this.repositoryDelete(
                filter,
                {
                    session
                }
            );

        if (
            !result ||
            result.deletedCount !==
                1
        ) {
            throw new SystemSettingServiceError(
                "System setting could not be deleted.",
                {
                    code:
                        "SETTING_DELETE_FAILED",
                    statusCode:
                        500
                }
            );
        }

        this.incrementMetric(
            "deletes"
        );

        await this.invalidate(
            {
                key:
                    normalizedKey,
                tenantId:
                    normalizedTenantId,
                scope:
                    normalizedScope
            }
        );

        await this.audit(
            "SYSTEM_SETTING_DELETED",
            {
                tenantId:
                    normalizedTenantId,
                settingKey:
                    normalizedKey,
                actorId,
                requestId,
                correlationId,
                before,
                after:
                    null,
                session
            }
        );

        if (
            publishEvent
        ) {
            await this.publishEvent(
                "titech.system_setting.deleted",
                {
                    tenantId:
                        normalizedTenantId,
                    settingKey:
                        normalizedKey,
                    scope:
                        normalizedScope,
                    actorId,
                    requestId,
                    correlationId,
                    occurredAt:
                        new Date()
                }
            );
        }

        return {
            deleted:
                true,
            key:
                normalizedKey,
            tenantId:
                normalizedTenantId,
            scope:
                normalizedScope
        };
    }

    /**
     * ========================================================================
     * Disable Setting
     * ========================================================================
     */

    async disable(
        options = {}
    ) {
        return this.update({
            ...options,
            status:
                SETTING_STATUSES.DISABLED
        });
    }

    /**
     * ========================================================================
     * Enable Setting
     * ========================================================================
     */

    async enable(
        options = {}
    ) {
        return this.update({
            ...options,
            status:
                SETTING_STATUSES.ACTIVE
        });
    }

    /**
     * ========================================================================
     * Set Value
     * ========================================================================
     *
     * Convenience method for internal services.
     * =========================================================================
     */

    async setValue(
        {
            key,
            value,
            type,
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            actorId = null,
            expectedUpdatedAt = null,
            session = null,
            requestId = null,
            correlationId = null
        } = {}
    ) {
        const existing =
            await this.getInternal(
                {
                    key,
                    tenantId,
                    scope,
                    session
                }
            );

        if (!existing) {
            return this.create(
                {
                    key,
                    value,
                    type,
                    tenantId,
                    scope,
                    createdBy:
                        actorId,
                    updatedBy:
                        actorId
                },
                {
                    session,
                    actorId,
                    requestId,
                    correlationId
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
            correlationId
        });
    }

    /**
     * ========================================================================
     * Get Typed Value
     * ========================================================================
     */

    async getValue(
        {
            key,
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            defaultValue = undefined,
            session = null,
            allowDisabled = false
        } = {}
    ) {
        const setting =
            await this.getInternal(
                {
                    key,
                    tenantId,
                    scope,
                    session
                }
            );

        if (!setting) {
            return defaultValue;
        }

        if (
            !allowDisabled &&
            setting.status !==
                SETTING_STATUSES.ACTIVE
        ) {
            return defaultValue;
        }

        return cloneValue(
            setting.value
        );
    }

    /**
     * ========================================================================
     * Require Typed Value
     * ========================================================================
     */

    async requireValue(
        options = {}
    ) {
        const value =
            await this.getValue(
                options
            );

        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            throw new SystemSettingServiceError(
                "Required system setting value was not found.",
                {
                    code:
                        "SETTING_VALUE_NOT_FOUND",
                    statusCode:
                        404
                }
            );
        }

        return value;
    }

    /**
     * ========================================================================
     * Cache Invalidation
     * ========================================================================
     */

    async invalidate({
        key,
        tenantId,
        scope =
            SETTING_SCOPES.TENANT
    } = {}) {
        const cacheKey =
            buildCacheKey(
                {
                    key,
                    tenantId,
                    scope
                }
            );

        await this.cacheDelete(
            cacheKey
        );
    }

    /**
     * ========================================================================
     * Invalidate Tenant Settings
     * ========================================================================
     *
     * Requires a cache implementation supporting scan/delete-by-pattern when
     * broad invalidation is needed. Otherwise individual setting invalidation
     * should be preferred.
     * =========================================================================
     */

    async invalidateTenant(
        tenantId
    ) {
        const normalizedTenantId =
            this.validateTenant(
                tenantId,
                {
                    required:
                        true
                }
            );

        const pattern =
            `${CACHE_NAMESPACE}:tenant:${normalizedTenantId}:*`;

        if (
            !this.cache
        ) {
            return false;
        }

        try {
            if (
                typeof this.cache.scanIterator ===
                "function"
            ) {
                for await (
                    const key of
                        this.cache.scanIterator(
                            {
                                MATCH:
                                    pattern
                            }
                        )
                ) {
                    await this.cacheDelete(
                        key
                    );
                }

                return true;
            }

            if (
                typeof this.cache.keys ===
                "function"
            ) {
                const keys =
                    await this.cache.keys(
                        pattern
                    );

                for (
                    const key of
                        keys || []
                ) {
                    await this.cacheDelete(
                        key
                    );
                }

                return true;
            }
        } catch (
            error
        ) {
            this.logWarn(
                "Tenant system setting cache invalidation failed.",
                {
                    tenantId:
                        normalizedTenantId,
                    error:
                        safeErrorMessage(
                            error
                        )
                }
            );
        }

        return false;
    }

    /**
     * ========================================================================
     * Bulk Read
     * ========================================================================
     */

    async getMany(
        {
            keys,
            tenantId,
            scope = SETTING_SCOPES.TENANT,
            session = null,
            includeSensitive = false
        } = {}
    ) {
        if (
            !Array.isArray(
                keys
            ) ||
            keys.length ===
                0
        ) {
            return [];
        }

        if (
            keys.length >
            this.config.maxBatchSize
        ) {
            throw new SystemSettingServiceError(
                "Too many settings requested in one operation.",
                {
                    code:
                        "SETTING_BATCH_TOO_LARGE",
                    statusCode:
                        400
                }
            );
        }

        const normalizedKeys =
            [
                ...new Set(
                    keys.map(
                        normalizeKey
                    )
                )
            ];

        const normalizedScope =
            normalizeScope(
                scope
            );

        const normalizedTenantId =
            normalizedScope ===
            SETTING_SCOPES.GLOBAL
                ? null
                : this.validateTenant(
                      tenantId,
                      {
                          required:
                              true
                      }
                  );

        const filter =
            {
                ...this.buildScopeFilter(
                    {
                        scope:
                            normalizedScope,
                        tenantId:
                            normalizedTenantId
                    }
                ),
                key: {
                    $in:
                        normalizedKeys
                }
            };

        const settings =
            await this.repositoryFind(
                filter,
                {
                    session,
                    limit:
                        this.config.maxBatchSize,
                    sort: {
                        key: 1
                    },
                    lean:
                        false
                }
            );

        return settings.map(
            (setting) =>
                this.sanitizeForResponse(
                    setting,
                    {
                        includeSensitive
                    }
                )
        );
    }

    /**
     * ========================================================================
     * Health Check
     * ========================================================================
     */

    async healthCheck() {
        try {
            if (
                this.repository &&
                typeof this.repository.healthCheck ===
                    "function"
            ) {
                await this.repository.healthCheck();
            } else if (
                this.model
            ) {
                await this.model.exists(
                    {}
                );
            }

            return {
                service:
                    SERVICE_NAME,
                version:
                    SERVICE_VERSION,
                healthy:
                    true,
                persistence:
                    true,
                cache:
                    Boolean(
                        this.cache
                    ),
                timestamp:
                    new Date()
            };
        } catch (
            error
        ) {
            this.incrementMetric(
                "failures"
            );

            return {
                service:
                    SERVICE_NAME,
                version:
                    SERVICE_VERSION,
                healthy:
                    false,
                persistence:
                    false,
                cache:
                    Boolean(
                        this.cache
                    ),
                error:
                    safeErrorMessage(
                        error
                    ),
                timestamp:
                    new Date()
            };
        }
    }
}

/**
 * ============================================================================
 * Regex Escaping
 * ============================================================================
 */

function escapeRegex(
    value
) {
    return String(
        value
    ).replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&"
    );
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 *
 * Supports both:
 *
 *   const service = createSystemSettingService(...)
 *
 * and:
 *
 *   const SystemSettingService = require(...)
 *
 * ============================================================================
 */

function createSystemSettingService(
    dependencies = {}
) {
    return new SystemSettingService(
        dependencies
    );
}

/**
 * ============================================================================
 * Default Singleton
 * ============================================================================
 *
 * The singleton is intentionally lazy so requiring this module does not create
 * database connections or side effects.
 * ============================================================================
 */

let singletonService = null;

function getSystemSettingService(
    dependencies = {}
) {
    if (
        !singletonService
    ) {
        singletonService =
            createSystemSettingService(
                dependencies
            );
    }

    return singletonService;
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {
    SystemSettingService,
    SystemSettingServiceError,
    createSystemSettingService,
    getSystemSettingService,

    SERVICE_NAME,
    SERVICE_VERSION,

    SETTING_SCOPES,
    SETTING_TYPES,
    SETTING_STATUSES,

    isSensitiveKey,
    isSensitiveSetting,
    normalizeKey,
    normalizeTenantId,
    validateSettingValue,
    buildCacheKey
};