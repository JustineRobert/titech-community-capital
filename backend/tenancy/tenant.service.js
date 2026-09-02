'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenant Service
 * ============================================================================
 *
 * File:
 *   backend/tenancy/tenant.service.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Application/service layer for TITech Community Capital tenant lifecycle
 * management.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Create and register tenants.
 * - Resolve active tenants.
 * - Update tenant metadata/settings.
 * - Manage tenant lifecycle/status.
 * - Provision tenant storage.
 * - Execute tenant migrations.
 * - Delete / restore tenants.
 * - Manage tenant cache.
 * - Coordinate distributed locks.
 * - Provide idempotent administrative operations.
 * - Publish operational metrics/audit signals.
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 * HTTP / Admin Controller
 *          ↓
 * TenantService
 *          ↓
 * TenantModel
 *          ├── Tenant Registry
 *          ├── Provisioning
 *          └── Migration State
 *          ↓
 * Cache / Lock / Metrics / Audit
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * This service is NOT responsible for:
 *
 *   ✗ authentication
 *   ✗ tenant authorization policy
 *   ✗ financial ledger operations
 *   ✗ wallet mutations
 *   ✗ loan accounting
 *   ✗ direct request parsing
 *
 * Tenant authorization belongs to the tenancy/authentication middleware.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const crypto =
    require('node:crypto');

const tenantConstants =
    require('./tenant.constants');

const {
    TenantModel,
    TENANT_STATUS,
    TenantModelError,
} =
    require('./tenant.model');

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_LOGGER =
    console;

const DEFAULT_OPTIONS =
    Object.freeze({
        cacheTTL:
            tenantConstants.ENV
                .CACHE_TTL_SECONDS,

        lockTTL:
            30_000,

        lockAcquireAttempts:
            10,

        lockRetryDelay:
            200,

        idempotencyTTL:
            60 * 60,

        createRetryAttempts:
            3,

        retryBaseDelay:
            150,

        retryCapDelay:
            2_000,

        failClosedOnLockUnavailable:
            true,

        failClosedOnIdempotencyUnavailable:
            false,

        allowPhysicalDeletion:
            false,

        cachePrefix:
            tenantConstants.ENV
                .CACHE_KEY_PREFIX ||
            'titech:tenant:',

        metricsPrefix:
            tenantConstants.METRICS
                .PREFIX ||
            'titech.tenancy',
    });

/**
 * ============================================================================
 * Service Errors
 * ============================================================================
 */

class TenantServiceError extends Error {
    constructor(
        message,
        code = 'TENANT_SERVICE_ERROR',
        {
            statusCode = 500,
            cause = undefined,
            details = undefined,
        } = {}
    ) {
        super(
            message
        );

        this.name =
            'TenantServiceError';

        this.code =
            code;

        this.statusCode =
            statusCode;

        if (
            cause
        ) {
            this.cause =
                cause;
        }

        if (
            details
        ) {
            this.details =
                details;
        }

        Error.captureStackTrace?.(
            this,
            TenantServiceError
        );
    }
}

/**
 * ============================================================================
 * Tenant Service
 * ============================================================================
 */

class TenantService {
    constructor({
        knex = null,
        TenantModelClass = null,
        TenantModel: InjectedTenantModel = null,
        cacheClient = null,
        lockClient = null,
        logger = DEFAULT_LOGGER,
        metrics = null,
        auditLogger = null,
        migrationRunner = null,
        options = {},
    } = {}) {
        this.knex =
            knex;

        this.TenantModel =
            TenantModelClass ||
            InjectedTenantModel ||
            TenantModel;

        if (
            !this.TenantModel
        ) {
            throw new TenantServiceError(
                'TenantModel is required.',
                'TENANT_MODEL_REQUIRED'
            );
        }

        this.cacheClient =
            cacheClient;

        this.lockClient =
            lockClient;

        this.logger =
            logger ||
            DEFAULT_LOGGER;

        this.metrics =
            metrics;

        this.auditLogger =
            auditLogger;

        this.migrationRunner =
            migrationRunner;

        this.options =
            Object.freeze({
                ...DEFAULT_OPTIONS,
                ...options,
            });

        this._validateDependencies();

        this._logInfo(
            'TITech TenantService initialized',
            {
                tenancyMode:
                    tenantConstants
                        .getTenancyMode(),
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Dependency validation
     * ------------------------------------------------------------------------
     */

    _validateDependencies() {
        if (
            typeof this.TenantModel
                .query !==
            'function'
        ) {
            throw new TenantServiceError(
                'TenantModel.query() is required.',
                'TENANT_MODEL_QUERY_UNAVAILABLE'
            );
        }

        if (
            typeof this.TenantModel
                .provisionTenantStorage !==
            'function'
        ) {
            throw new TenantServiceError(
                'TenantModel.provisionTenantStorage() is required.',
                'TENANT_MODEL_PROVISIONER_UNAVAILABLE'
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Normalization / validation
     * ------------------------------------------------------------------------
     */

    _tenantId(
        tenantId
    ) {
        try {
            return tenantConstants
                .assertValidTenantId
                ? tenantConstants
                    .assertValidTenantId(
                        tenantId
                    )
                : this._fallbackValidateTenantId(
                    tenantId
                );
        } catch (
            error
        ) {
            if (
                error instanceof
                TenantServiceError
            ) {
                throw error;
            }

            throw new TenantServiceError(
                'Invalid tenant identifier.',
                'INVALID_TENANT_ID',
                {
                    statusCode:
                        400,

                    cause:
                        error,
                }
            );
        }
    }

    _fallbackValidateTenantId(
        tenantId
    ) {
        const normalized =
            String(
                tenantId ??
                    ''
            )
                .trim()
                .toLowerCase();

        if (
            !tenantConstants.isValidTenantId(
                normalized
            )
        ) {
            throw new TenantServiceError(
                'Invalid tenant identifier.',
                'INVALID_TENANT_ID',
                {
                    statusCode:
                        400,
                }
            );
        }

        return normalized;
    }

    _normalizeDomain(
        domain
    ) {
        if (
            domain ===
                undefined ||
            domain ===
                null ||
            String(
                domain
            ).trim() ===
                ''
        ) {
            return null;
        }

        const normalized =
            String(
                domain
            )
                .trim()
                .toLowerCase();

        if (
            typeof tenantConstants
                .isValidHostname ===
                'function' &&
            !tenantConstants.isValidHostname(
                normalized
            )
        ) {
            throw new TenantServiceError(
                'Invalid tenant domain.',
                'INVALID_TENANT_DOMAIN',
                {
                    statusCode:
                        400,
                }
            );
        }

        return normalized;
    }

    _plainObject(
        value,
        field
    ) {
        if (
            value ===
                undefined ||
            value ===
                null
        ) {
            return {};
        }

        if (
            typeof value !==
                'object' ||
            Array.isArray(
                value
            )
        ) {
            throw new TenantServiceError(
                `${field} must be an object.`,
                'INVALID_TENANT_OBJECT',
                {
                    statusCode:
                        400,
                }
            );
        }

        return {
            ...value,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Cache helpers
     * ------------------------------------------------------------------------
     */

    _cacheKey(
        tenantId,
        suffix = 'meta'
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        return tenantConstants
            .tenantCacheKey
            ? tenantConstants.tenantCacheKey(
                id,
                suffix
            )
            : `${this.options.cachePrefix}${id}:${suffix}`;
    }

    _idempotencyKey(
        tenantId,
        operation,
        key
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const normalizedKey =
            String(
                key ??
                    ''
            ).trim();

        if (
            !normalizedKey
        ) {
            return null;
        }

        const digest =
            crypto
                .createHash(
                    'sha256'
                )
                .update(
                    [
                        id,
                        operation,
                        normalizedKey,
                    ].join(
                        '|'
                    ),
                    'utf8'
                )
                .digest(
                    'hex'
                );

        return `${this.options.cachePrefix}idem:${id}:${operation}:${digest}`;
    }

    async _cacheGet(
        key
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.get !==
                'function'
        ) {
            return null;
        }

        try {
            const value =
                await this.cacheClient.get(
                    key
                );

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
                    'string'
            ) {
                try {
                    return JSON.parse(
                        value
                    );
                } catch {
                    return value;
                }
            }

            return value;
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant cache read failed',
                {
                    key,
                    error:
                        error?.message,
                }
            );

            return null;
        }
    }

    async _cacheSet(
        key,
        value,
        ttlSeconds = this.options.cacheTTL
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.set !==
                'function'
        ) {
            return false;
        }

        const serialized =
            typeof value ===
                'string'
                ? value
                : JSON.stringify(
                    value
                );

        try {
            /**
             * Preferred modern Redis interface.
             */
            await this.cacheClient.set(
                key,
                serialized,
                {
                    EX:
                        ttlSeconds,
                }
            );

            return true;
        } catch {
            // Try legacy interface below.
        }

        try {
            await this.cacheClient.set(
                key,
                serialized,
                'EX',
                ttlSeconds
            );

            return true;
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant cache write failed',
                {
                    key,
                    error:
                        error?.message,
                }
            );

            return false;
        }
    }

    async _cacheDelete(
        key
    ) {
        if (
            !this.cacheClient ||
            typeof this.cacheClient.del !==
                'function'
        ) {
            return false;
        }

        try {
            await this.cacheClient.del(
                key
            );

            return true;
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant cache invalidation failed',
                {
                    key,
                    error:
                        error?.message,
                }
            );

            return false;
        }
    }

    async invalidateCache(
        tenantId
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        await this._cacheDelete(
            this._cacheKey(
                id,
                'meta'
            )
        );

        await this._cacheDelete(
            this._cacheKey(
                id,
                'settings'
            )
        );

        await this._cacheDelete(
            this._cacheKey(
                id,
                'domain'
            )
        );

        this._logDebug(
            'Invalidated tenant cache',
            {
                tenant:
                    id,
            }
        );

        return true;
    }

    /**
     * ------------------------------------------------------------------------
     * Idempotency
     * ------------------------------------------------------------------------
     *
     * Cache is treated as an optimization. For high-value lifecycle
     * operations, the distributed lock + database uniqueness remain the
     * authoritative protections.
     * ------------------------------------------------------------------------
     */

    async _getIdempotentResult(
        tenantId,
        operation,
        idempotencyKey
    ) {
        const key =
            this._idempotencyKey(
                tenantId,
                operation,
                idempotencyKey
            );

        if (
            !key
        ) {
            return null;
        }

        return this._cacheGet(
            key
        );
    }

    async _setIdempotentResult(
        tenantId,
        operation,
        idempotencyKey,
        result
    ) {
        const key =
            this._idempotencyKey(
                tenantId,
                operation,
                idempotencyKey
            );

        if (
            !key
        ) {
            return false;
        }

        return this._cacheSet(
            key,
            result,
            this.options
                .idempotencyTTL
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Distributed lock helpers
     * ------------------------------------------------------------------------
     */

    _lockKey(
        operation,
        tenantId
    ) {
        return `titech:tenant-lock:${operation}:${this._tenantId(
            tenantId
        )}`;
    }

    async _acquireLock(
        operation,
        tenantId,
        {
            ttl =
                this.options
                    .lockTTL,
            attempts =
                this.options
                    .lockAcquireAttempts,
            retryDelay =
                this.options
                    .lockRetryDelay,
        } = {}
    ) {
        if (
            !this.lockClient ||
            typeof this.lockClient.acquire !==
                'function'
        ) {
            if (
                this.options
                    .failClosedOnLockUnavailable
            ) {
                throw new TenantServiceError(
                    'Distributed tenant lock service is unavailable.',
                    'TENANT_LOCK_UNAVAILABLE',
                    {
                        statusCode:
                            503,
                    }
                );
            }

            return null;
        }

        const key =
            this._lockKey(
                operation,
                tenantId
            );

        for (
            let attempt = 0;
            attempt <
            attempts;
            attempt += 1
        ) {
            try {
                const lock =
                    await this.lockClient.acquire(
                        key,
                        ttl
                    );

                if (
                    lock
                ) {
                    this._logDebug(
                        'Tenant operation lock acquired',
                        {
                            operation,
                            tenant:
                                this._tenantId(
                                    tenantId
                                ),
                            attempt,
                        }
                    );

                    return lock;
                }
            } catch (
                error
            ) {
                this._logWarn(
                    'Tenant lock acquisition attempt failed',
                    {
                        operation,
                        tenant:
                            this._tenantId(
                                tenantId
                            ),
                        attempt,
                        error:
                            error?.message,
                    }
                );
            }

            if (
                attempt <
                attempts - 1
            ) {
                await sleep(
                    computeBackoff(
                        attempt,
                        retryDelay,
                        this.options
                            .retryCapDelay
                    )
                );
            }
        }

        throw new TenantServiceError(
            'Unable to acquire tenant operation lock.',
            'TENANT_LOCK_ACQUISITION_FAILED',
            {
                statusCode:
                    409,
            }
        );
    }

    async _releaseLock(
        lock
    ) {
        if (
            !lock ||
            !this.lockClient ||
            typeof this.lockClient.release !==
                'function'
        ) {
            return;
        }

        try {
            await this.lockClient.release(
                lock
            );
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant lock release failed',
                {
                    error:
                        error?.message,
                }
            );
        }
    }

    async _withLock(
        operation,
        tenantId,
        fn,
        options = {}
    ) {
        const lock =
            await this._acquireLock(
                operation,
                tenantId,
                options
            );

        try {
            return await fn(
                lock
            );
        } finally {
            await this._releaseLock(
                lock
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Metrics
     * ------------------------------------------------------------------------
     */

    _metricName(
        event
    ) {
        return `${this.options.metricsPrefix}.tenant.${event}`;
    }

    _increment(
        event,
        labels = {}
    ) {
        if (
            !this.metrics ||
            typeof this.metrics.increment !==
                'function'
        ) {
            return;
        }

        try {
            this.metrics.increment(
                this._metricName(
                    event
                ),
                labels
            );
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant metric increment failed',
                {
                    event,
                    error:
                        error?.message,
                }
            );
        }
    }

    _gauge(
        event,
        value,
        labels = {}
    ) {
        if (
            !this.metrics ||
            typeof this.metrics.gauge !==
                'function'
        ) {
            return;
        }

        try {
            this.metrics.gauge(
                this._metricName(
                    event
                ),
                value,
                labels
            );
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant metric gauge failed',
                {
                    event,
                    error:
                        error?.message,
                }
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Audit
     * ------------------------------------------------------------------------
     */

    _audit(
        action,
        {
            tenantId = null,
            requestId = null,
            actorId = null,
            outcome = 'success',
            meta = {},
        } = {}
    ) {
        if (
            typeof this.auditLogger !==
            'function'
        ) {
            return;
        }

        try {
            this.auditLogger({
                timestamp:
                    new Date()
                        .toISOString(),

                service:
                    'TITech.Tenancy',

                action,

                tenantId,

                requestId,

                actorId,

                outcome,

                meta:
                    sanitizeAuditMeta(
                        meta
                    ),
            });
        } catch (
            error
        ) {
            this._logWarn(
                'Tenant audit logging failed',
                {
                    action,
                    error:
                        error?.message,
                }
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Create tenant
     * ------------------------------------------------------------------------
     */

    async createTenant(
        payload = {},
        options = {}
    ) {
        const rawTenantId =
            payload.tenantId;

        if (
            !rawTenantId
        ) {
            throw new TenantServiceError(
                'tenantId is required.',
                'MISSING_TENANT_ID',
                {
                    statusCode:
                        400,
                }
            );
        }

        const tenantId =
            this._tenantId(
                rawTenantId
            );

        const name =
            normalizeName(
                payload.name
            );

        const domain =
            this._normalizeDomain(
                payload.domain
            );

        const metadata =
            this._plainObject(
                payload.metadata,
                'metadata'
            );

        const settings =
            this._plainObject(
                payload.settings,
                'settings'
            );

        const provision =
            options.provision !==
            undefined
                ? Boolean(
                    options.provision
                )
                : true;

        const idempotencyKey =
            normalizeOptionalString(
                options.idempotencyKey ||
                payload.idempotencyKey
            );

        /**
         * Idempotency result is checked before taking the lock because a
         * previously completed operation should return immediately.
         */
        if (
            idempotencyKey
        ) {
            const existing =
                await this._getIdempotentResult(
                    tenantId,
                    'create',
                    idempotencyKey
                );

            if (
                existing
            ) {
                this._logInfo(
                    'Returning idempotent tenant creation result',
                    {
                        tenant:
                            tenantId,
                    }
                );

                return existing;
            }
        }

        return this._withLock(
            'create',
            tenantId,
            async () => {
                /**
                 * Re-check after lock acquisition.
                 */
                const existing =
                    await this.getTenant(
                        tenantId,
                        {
                            bypassCache:
                                true,
                        }
                    );

                if (
                    existing
                ) {
                    /**
                     * Same logical tenant already exists.
                     *
                     * Return existing tenant rather than creating another
                     * registry record.
                     */
                    if (
                        idempotencyKey
                    ) {
                        await this._setIdempotentResult(
                            tenantId,
                            'create',
                            idempotencyKey,
                            existing
                        );
                    }

                    return existing;
                }

                const knex =
                    options.knex ||
                    this.knex;

                const provisionOptions =
                    {
                        ...(options
                            .provisionOptions ||
                            {}),
                    };

                if (
                    options.migrateFn ||
                    this.migrationRunner
                ) {
                    provisionOptions
                        .migrate =
                        options.migrateFn ||
                        this.migrationRunner;
                }

                /**
                 * Hybrid provisioning decision may be supplied here.
                 */
                if (
                    typeof options
                        .hybridDecision ===
                    'function'
                ) {
                    provisionOptions
                        .hybridDecision =
                        options.hybridDecision;
                }

                let record;

                try {
                    record =
                        await this.TenantModel
                            .createTenant({
                                tenantId,

                                name,

                                domain,

                                metadata,

                                settings,

                                options:
                                    {
                                        provision,

                                        knex,

                                        logger:
                                            this.logger,

                                        cacheClient:
                                            this.cacheClient,

                                        provisionOptions,
                                    },
                            });
                } catch (
                    error
                ) {
                    if (
                        isDuplicateError(
                            error
                        )
                    ) {
                        /**
                         * A concurrent creator can still win despite the
                         * distributed lock in a multi-process deployment.
                         */
                        const concurrent =
                            await this.getTenant(
                                tenantId,
                                {
                                    bypassCache:
                                        true,
                                }
                            );

                        if (
                            concurrent
                        ) {
                            return concurrent;
                        }
                    }

                    throw mapModelError(
                        error
                    );
                }

                await this.invalidateCache(
                    tenantId
                );

                /**
                 * Re-read the authoritative row after provisioning because
                 * the model may have transitioned status.
                 */
                const result =
                    await this.getTenant(
                        tenantId,
                        {
                            bypassCache:
                                true,

                            includeDeleted:
                                false,
                        }
                    ) ||
                    record;

                if (
                    idempotencyKey
                ) {
                    await this._setIdempotentResult(
                        tenantId,
                        'create',
                        idempotencyKey,
                        result
                    );
                }

                this._increment(
                    'created',
                    {
                        tenant:
                            tenantId,
                    }
                );

                this._audit(
                    'tenant_create',
                    {
                        tenantId,

                        outcome:
                            'success',
                    }
                );

                return result;
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Get tenant
     * ------------------------------------------------------------------------
     */

    async getTenant(
        tenantId,
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const bypassCache =
            Boolean(
                options.bypassCache
            );

        const includeDeleted =
            Boolean(
                options.includeDeleted
            );

        const cacheClient =
            options.cacheClient ||
            this.cacheClient;

        if (
            !bypassCache &&
            !includeDeleted &&
            cacheClient
        ) {
            const cached =
                await this._cacheGet(
                    this._cacheKey(
                        id
                    )
                );

            if (
                cached &&
                cached.tenant_id ===
                    id &&
                !cached.deleted_at
            ) {
                this._increment(
                    'cache_hit',
                    {
                        tenant:
                            id,
                    }
                );

                return cached;
            }

            this._increment(
                'cache_miss',
                {
                    tenant:
                        id,
                }
            );
        }

        const finder =
            typeof this.TenantModel
                .findByTenantId ===
                'function'
                ? this.TenantModel
                    .findByTenantId
                : null;

        let row;

        if (
            finder
        ) {
            row =
                await finder.call(
                    this.TenantModel,
                    id,
                    {
                        cacheClient:
                            null,

                        includeDeleted,

                        logger:
                            this.logger,
                    }
                );
        } else {
            const query =
                this.TenantModel
                    .query()
                    .where(
                        'tenant_id',
                        id
                    );

            if (
                !includeDeleted
            ) {
                query.whereNull(
                    'deleted_at'
                );
            }

            row =
                await query.first();
        }

        if (
            !row
        ) {
            return null;
        }

        if (
            !includeDeleted &&
            cacheClient
        ) {
            await this._cacheSet(
                this._cacheKey(
                    id
                ),
                serializeTenant(
                    row
                ),
                this.options
                    .cacheTTL
            );
        }

        return row;
    }

    /**
     * ------------------------------------------------------------------------
     * Get active tenant
     * ------------------------------------------------------------------------
     */

    async getActiveTenant(
        tenantId,
        options = {}
    ) {
        const tenant =
            await this.getTenant(
                tenantId,
                {
                    ...options,

                    includeDeleted:
                        false,
                }
            );

        if (
            !tenant
        ) {
            return null;
        }

        if (
            tenant.status !==
            TENANT_STATUS.ACTIVE
        ) {
            return null;
        }

        return tenant;
    }

    /**
     * ------------------------------------------------------------------------
     * Find by domain
     * ------------------------------------------------------------------------
     */

    async getTenantByDomain(
        domain,
        options = {}
    ) {
        const normalized =
            this._normalizeDomain(
                domain
            );

        if (
            !normalized
        ) {
            return null;
        }

        if (
            typeof this.TenantModel
                .findByDomain ===
                'function'
        ) {
            return this.TenantModel
                .findByDomain(
                    normalized,
                    {
                        cacheClient:
                            options.cacheClient ||
                            this.cacheClient,

                        logger:
                            this.logger,
                    }
                );
        }

        return this.TenantModel
            .query()
            .where(
                'domain',
                normalized
            )
            .whereNull(
                'deleted_at'
            )
            .first();
    }

    /**
     * ------------------------------------------------------------------------
     * Update tenant
     * ------------------------------------------------------------------------
     */

    async updateTenant(
        tenantId,
        patch = {},
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        if (
            !isPlainObject(
                patch
            )
        ) {
            throw new TenantServiceError(
                'Tenant update patch must be an object.',
                'INVALID_TENANT_PATCH',
                {
                    statusCode:
                        400,
                }
            );
        }

        const allowed =
            new Set([
                'name',
                'domain',
                'metadata',
                'settings',
                'status',
                'migration_version',
            ]);

        const update =
            {};

        for (
            const [
                key,
                value,
            ] of Object.entries(
                patch
            )
        ) {
            if (
                !allowed.has(
                    key
                )
            ) {
                continue;
            }

            update[key] =
                value;
        }

        if (
            update.name !==
                undefined
        ) {
            update.name =
                normalizeName(
                    update.name
                );
        }

        if (
            update.domain !==
                undefined
        ) {
            update.domain =
                this._normalizeDomain(
                    update.domain
                );
        }

        if (
            update.metadata !==
                undefined
        ) {
            update.metadata =
                this._plainObject(
                    update.metadata,
                    'metadata'
                );
        }

        if (
            update.settings !==
                undefined
        ) {
            update.settings =
                this._plainObject(
                    update.settings,
                    'settings'
                );
        }

        if (
            update.status !==
                undefined &&
            !Object.values(
                TENANT_STATUS
            ).includes(
                update.status
            )
        ) {
            throw new TenantServiceError(
                'Invalid tenant status.',
                'INVALID_TENANT_STATUS',
                {
                    statusCode:
                        400,
                }
            );
        }

        if (
            update.migration_version !==
                undefined &&
            update.migration_version !==
                null
        ) {
            update.migration_version =
                String(
                    update.migration_version
                ).slice(
                    0,
                    128
                );
        }

        if (
            Object.keys(
                update
            ).length ===
            0
        ) {
            return this.getTenant(
                id,
                {
                    bypassCache:
                        true,
                }
            );
        }

        const idempotencyKey =
            normalizeOptionalString(
                options.idempotencyKey
            );

        if (
            idempotencyKey
        ) {
            const replay =
                await this._getIdempotentResult(
                    id,
                    'update',
                    idempotencyKey
                );

            if (
                replay
            ) {
                return replay;
            }
        }

        return this._withLock(
            'update',
            id,
            async () => {
                let updated;

                try {
                    if (
                        typeof this.TenantModel
                            .updateByTenantId ===
                        'function'
                    ) {
                        updated =
                            await this.TenantModel
                                .updateByTenantId(
                                    id,
                                    update,
                                    {
                                        trx:
                                            options.trx ||
                                            null,
                                    }
                                );
                    } else {
                        const current =
                            await this.getTenant(
                                id,
                                {
                                    bypassCache:
                                        true,
                                }
                            );

                        if (
                            !current
                        ) {
                            throw new TenantServiceError(
                                'Tenant not found.',
                                'TENANT_NOT_FOUND',
                                {
                                    statusCode:
                                        404,
                                }
                            );
                        }

                        updated =
                            await this.TenantModel
                                .query(
                                    options.trx ||
                                        undefined
                                )
                                .patchAndFetchById(
                                    current.id,
                                    {
                                        ...update,

                                        updated_at:
                                            new Date()
                                                .toISOString(),
                                    }
                                );
                    }
                } catch (
                    error
                ) {
                    throw mapModelError(
                        error
                    );
                }

                await this.invalidateCache(
                    id
                );

                if (
                    idempotencyKey
                ) {
                    await this._setIdempotentResult(
                        id,
                        'update',
                        idempotencyKey,
                        updated
                    );
                }

                this._increment(
                    'updated',
                    {
                        tenant:
                            id,
                    }
                );

                this._audit(
                    'tenant_update',
                    {
                        tenantId:
                            id,

                        outcome:
                            'success',

                        meta:
                            {
                                fields:
                                    Object.keys(
                                        update
                                    ),
                            },
                    }
                );

                return updated;
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Update settings
     * ------------------------------------------------------------------------
     */

    async updateSettings(
        tenantId,
        settingsPatch = {},
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const patch =
            this._plainObject(
                settingsPatch,
                'settingsPatch'
            );

        const idempotencyKey =
            normalizeOptionalString(
                options.idempotencyKey
            );

        if (
            idempotencyKey
        ) {
            const replay =
                await this._getIdempotentResult(
                    id,
                    'settings',
                    idempotencyKey
                );

            if (
                replay
            ) {
                return replay;
            }
        }

        return this._withLock(
            'settings',
            id,
            async () => {
                const updated =
                    await this.TenantModel
                        .updateSettings(
                            id,
                            patch,
                            options.trx ||
                                null
                        );

                await this.invalidateCache(
                    id
                );

                if (
                    idempotencyKey
                ) {
                    await this._setIdempotentResult(
                        id,
                        'settings',
                        idempotencyKey,
                        updated
                    );
                }

                this._increment(
                    'settings_updated',
                    {
                        tenant:
                            id,
                    }
                );

                this._audit(
                    'tenant_settings_update',
                    {
                        tenantId:
                            id,

                        outcome:
                            'success',
                    }
                );

                return updated;
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Update metadata
     * ------------------------------------------------------------------------
     */

    async updateMetadata(
        tenantId,
        metadataPatch = {},
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const patch =
            this._plainObject(
                metadataPatch,
                'metadataPatch'
            );

        return this._withLock(
            'metadata',
            id,
            async () => {
                const updated =
                    await this.TenantModel
                        .updateMetadata(
                            id,
                            patch,
                            options.trx ||
                                null
                        );

                await this.invalidateCache(
                    id
                );

                this._increment(
                    'metadata_updated',
                    {
                        tenant:
                            id,
                    }
                );

                return updated;
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Suspend
     * ------------------------------------------------------------------------
     */

    async suspendTenant(
        tenantId,
        options = {}
    ) {
        return this._transitionStatus(
            tenantId,
            TENANT_STATUS.SUSPENDED,
            options
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Activate
     * ------------------------------------------------------------------------
     */

    async activateTenant(
        tenantId,
        options = {}
    ) {
        return this._transitionStatus(
            tenantId,
            TENANT_STATUS.ACTIVE,
            options
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Status transition
     * ------------------------------------------------------------------------
     */

    async _transitionStatus(
        tenantId,
        status,
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        if (
            !Object.values(
                TENANT_STATUS
            ).includes(
                status
            )
        ) {
            throw new TenantServiceError(
                'Invalid tenant status.',
                'INVALID_TENANT_STATUS',
                {
                    statusCode:
                        400,
                }
            );
        }

        const idempotencyKey =
            normalizeOptionalString(
                options.idempotencyKey
            );

        if (
            idempotencyKey
        ) {
            const replay =
                await this._getIdempotentResult(
                    id,
                    `status:${status}`,
                    idempotencyKey
                );

            if (
                replay
            ) {
                return replay;
            }
        }

        return this._withLock(
            `status:${status}`,
            id,
            async () => {
                const current =
                    await this.getTenant(
                        id,
                        {
                            bypassCache:
                                true,

                            includeDeleted:
                                true,
                        }
                    );

                if (
                    !current
                ) {
                    throw new TenantServiceError(
                        'Tenant not found.',
                        'TENANT_NOT_FOUND',
                        {
                            statusCode:
                                404,
                        }
                    );
                }

                /**
                 * Avoid invalid resurrection.
                 */
                if (
                    current.status ===
                        TENANT_STATUS.DELETED &&
                    status !==
                        TENANT_STATUS.ACTIVE
                ) {
                    throw new TenantServiceError(
                        'Deleted tenant cannot transition directly to this status.',
                        'INVALID_TENANT_STATE_TRANSITION',
                        {
                            statusCode:
                                409,
                        }
                    );
                }

                let updated;

                if (
                    typeof this.TenantModel
                        .setStatus ===
                    'function'
                ) {
                    updated =
                        await this.TenantModel
                            .setStatus(
                                id,
                                status,
                                {
                                    trx:
                                        options.trx ||
                                        null,

                                    cacheClient:
                                        null,

                                    logger:
                                        this.logger,
                                }
                            );
                } else {
                    updated =
                        await this.TenantModel
                            .query(
                                options.trx ||
                                    undefined
                            )
                            .patchAndFetchById(
                                current.id,
                                {
                                    status,

                                    deleted_at:
                                        status ===
                                        TENANT_STATUS.DELETED
                                            ? new Date()
                                                .toISOString()
                                            : null,

                                    updated_at:
                                        new Date()
                                            .toISOString(),
                                }
                            );
                }

                await this.invalidateCache(
                    id
                );

                if (
                    idempotencyKey
                ) {
                    await this._setIdempotentResult(
                        id,
                        `status:${status}`,
                        idempotencyKey,
                        updated
                    );
                }

                this._increment(
                    `status_${status}`,
                    {
                        tenant:
                            id,
                    }
                );

                this._audit(
                    `tenant_${status}`,
                    {
                        tenantId:
                            id,

                        outcome:
                            'success',
                    }
                );

                return updated;
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Restore
     * ------------------------------------------------------------------------
     */

    async restoreTenant(
        tenantId,
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        return this._withLock(
            'restore',
            id,
            async () => {
                const restored =
                    await this.TenantModel
                        .restoreByTenantId(
                            id,
                            {
                                trx:
                                    options.trx ||
                                    null,

                                cacheClient:
                                    null,

                                logger:
                                    this.logger,
                            }
                        );

                if (
                    !restored
                ) {
                    const existing =
                        await this.getTenant(
                            id,
                            {
                                bypassCache:
                                    true,

                                includeDeleted:
                                    true,
                            }
                        );

                    if (
                        !existing
                    ) {
                        throw new TenantServiceError(
                            'Tenant not found.',
                            'TENANT_NOT_FOUND',
                            {
                                statusCode:
                                    404,
                            }
                        );
                    }

                    if (
                        !existing.deleted_at
                    ) {
                        return existing;
                    }
                }

                await this.invalidateCache(
                    id
                );

                const active =
                    await this.getActiveTenant(
                        id,
                        {
                            bypassCache:
                                true,
                        }
                    );

                this._increment(
                    'restored',
                    {
                        tenant:
                            id,
                    }
                );

                this._audit(
                    'tenant_restore',
                    {
                        tenantId:
                            id,

                        outcome:
                            'success',
                    }
                );

                return active;
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Provision tenant
     * ------------------------------------------------------------------------
     */

    async provisionTenant(
        tenantId,
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const knex =
            options.knex ||
            this.knex;

        const migrateFn =
            options.migrateFn ||
            this.migrationRunner;

        return this._withLock(
            'provision',
            id,
            async () => {
                const tenant =
                    await this.getTenant(
                        id,
                        {
                            bypassCache:
                                true,

                            includeDeleted:
                                true,
                        }
                    );

                if (
                    !tenant
                ) {
                    throw new TenantServiceError(
                        'Tenant not found.',
                        'TENANT_NOT_FOUND',
                        {
                            statusCode:
                                404,
                        }
                    );
                }

                if (
                    tenant.deleted_at ||
                    tenant.status ===
                        TENANT_STATUS.DELETED
                ) {
                    throw new TenantServiceError(
                        'Deleted tenant cannot be provisioned.',
                        'TENANT_DELETED',
                        {
                            statusCode:
                                409,
                        }
                    );
                }

                if (
                    tenant.status ===
                        TENANT_STATUS.ACTIVE &&
                    !options.force
                ) {
                    return {
                        status:
                            'already_active',

                        tenant,
                    };
                }

                const provisionOptions =
                    {
                        ...(options.provisionOptions ||
                            {}),
                    };

                if (
                    migrateFn
                ) {
                    provisionOptions.migrate =
                        migrateFn;
                }

                if (
                    options.hybridDecision
                ) {
                    provisionOptions.hybridDecision =
                        options.hybridDecision;
                }

                let result;

                try {
                    result =
                        await this.TenantModel
                            .provisionTenantStorage(
                                id,
                                {
                                    knex,

                                    logger:
                                        this.logger,

                                    options:
                                        provisionOptions,
                                }
                            );
                } catch (
                    error
                ) {
                    await this._safeStatusUpdate(
                        id,
                        TENANT_STATUS.SUSPENDED
                    );

                    throw new TenantServiceError(
                        'Tenant storage provisioning failed.',
                        'TENANT_PROVISIONING_FAILED',
                        {
                            statusCode:
                                500,

                            cause:
                                error,
                        }
                    );
                }

                const active =
                    await this._safeStatusUpdate(
                        id,
                        TENANT_STATUS.ACTIVE
                    );

                await this.invalidateCache(
                    id
                );

                this._increment(
                    'provisioned',
                    {
                        tenant:
                            id,
                    }
                );

                this._audit(
                    'tenant_provision',
                    {
                        tenantId:
                            id,

                        outcome:
                            'success',

                        meta:
                            {
                                provisioning:
                                    result,
                            },
                    }
                );

                return {
                    ...result,

                    status:
                        'active',

                    tenant:
                        active,
                };
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Run migrations
     * ------------------------------------------------------------------------
     */

    async runMigrations(
        tenantId,
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const migrateFn =
            options.migrateFn ||
            this.migrationRunner;

        if (
            typeof migrateFn !==
            'function'
        ) {
            throw new TenantServiceError(
                'migrateFn is required to run migrations.',
                'MIGRATION_RUNNER_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        const knex =
            options.knex ||
            this.knex;

        return this._withLock(
            'migrate',
            id,
            async () => {
                const tenant =
                    await this.getTenant(
                        id,
                        {
                            bypassCache:
                                true,

                            includeDeleted:
                                true,
                        }
                    );

                if (
                    !tenant
                ) {
                    throw new TenantServiceError(
                        'Tenant not found.',
                        'TENANT_NOT_FOUND',
                        {
                            statusCode:
                                404,
                        }
                    );
                }

                if (
                    tenant.deleted_at
                ) {
                    throw new TenantServiceError(
                        'Deleted tenant cannot receive migrations.',
                        'TENANT_DELETED',
                        {
                            statusCode:
                                409,
                        }
                    );
                }

                const version =
                    await migrateFn(
                        id,
                        {
                            knex,
                            tenant,
                        }
                    );

                const persisted =
                    await this._persistMigrationVersion(
                        id,
                        version
                    );

                await this.invalidateCache(
                    id
                );

                this._increment(
                    'migrations',
                    {
                        tenant:
                            id,

                        version:
                            String(
                                version ??
                                    ''
                            ),
                    }
                );

                this._audit(
                    'tenant_migration',
                    {
                        tenantId:
                            id,

                        outcome:
                            'success',

                        meta:
                            {
                                version,
                            },
                    }
                );

                return {
                    version,

                    tenant:
                        persisted,
                };
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Delete tenant
     * ------------------------------------------------------------------------
     */

    async deleteTenant(
        tenantId,
        options = {}
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const lock =
            await this._acquireLock(
                'delete',
                id
            );

        try {
            const tenant =
                await this.getTenant(
                    id,
                    {
                        bypassCache:
                            true,

                        includeDeleted:
                            true,
                    }
                );

            if (
                !tenant
            ) {
                throw new TenantServiceError(
                    'Tenant not found.',
                    'TENANT_NOT_FOUND',
                    {
                        statusCode:
                            404,
                    }
                );
            }

            if (
                tenant.deleted_at
            ) {
                return {
                    deleted:
                        true,

                    alreadyDeleted:
                        true,
                };
            }

            /**
             * Physical deletion is intentionally disabled unless explicitly
             * enabled through service configuration and exact confirmation.
             */
            const dropStorage =
                Boolean(
                    options.dropStorage
                );

            if (
                dropStorage &&
                !this.options
                    .allowPhysicalDeletion
            ) {
                throw new TenantServiceError(
                    'Physical tenant storage deletion is disabled.',
                    'PHYSICAL_TENANT_DELETION_DISABLED',
                    {
                        statusCode:
                            403,
                    }
                );
            }

            const confirmTenantId =
                normalizeOptionalString(
                    options.confirmTenantId
                );

            if (
                dropStorage &&
                confirmTenantId !==
                    id
            ) {
                throw new TenantServiceError(
                    'Exact tenant deletion confirmation is required.',
                    'TENANT_DELETION_CONFIRMATION_REQUIRED',
                    {
                        statusCode:
                            400,
                    }
                );
            }

            const result =
                await this.TenantModel
                    .deleteTenant(
                        id,
                        {
                            dropStorage,

                            confirmTenantId,

                            dropStorageFn:
                                options
                                    .dropStorageFn,

                            cacheClient:
                                null,

                            knex:
                                options.knex ||
                                this.knex,

                            logger:
                                this.logger,
                        }
                    );

            await this.invalidateCache(
                id
            );

            this._increment(
                'deleted',
                {
                    tenant:
                        id,
                }
            );

            this._audit(
                'tenant_delete',
                {
                    tenantId:
                        id,

                    outcome:
                        'success',

                    meta:
                        {
                            storageDropped:
                                dropStorage,
                        },
                }
            );

            return {
                deleted:
                    Boolean(
                        result
                    ),

                storageDropped:
                    dropStorage,
            };
        } finally {
            await this._releaseLock(
                lock
            );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * List tenants
     * ------------------------------------------------------------------------
     */

    async listTenants(
        filter = {},
        options = {}
    ) {
        const page =
            parsePositiveInteger(
                options.page,
                1,
                1,
                1_000_000
            );

        const pageSize =
            parsePositiveInteger(
                options.pageSize,
                50,
                1,
                500
            );

        const query =
            this.TenantModel
                .query();

        /**
         * Deleted tenants are excluded unless explicitly requested.
         */
        if (
            !options.includeDeleted
        ) {
            query.whereNull(
                'deleted_at'
            );
        }

        if (
            filter.status
        ) {
            if (
                !Object.values(
                    TENANT_STATUS
                ).includes(
                    filter.status
                )
            ) {
                throw new TenantServiceError(
                    'Invalid tenant status filter.',
                    'INVALID_TENANT_STATUS',
                    {
                        statusCode:
                            400,
                    }
                );
            }

            query.where(
                'status',
                filter.status
            );
        }

        if (
            filter.q
        ) {
            const search =
                `%${String(
                    filter.q
                )
                    .trim()
                    .replace(
                        /[%_]/g,
                        '\\$&'
                    )}%`;

            /**
             * PostgreSQL path.
             *
             * For databases without ILIKE, integrators should provide a
             * repository-specific search implementation.
             */
            query.where(
                builder => {
                    builder
                        .where(
                            'tenant_id',
                            'ilike',
                            search
                        )
                        .orWhere(
                            'name',
                            'ilike',
                            search
                        )
                        .orWhere(
                            'domain',
                            'ilike',
                            search
                        );
                }
            );
        }

        if (
            typeof query
                .resultSize ===
            'function'
        ) {
            const total =
                await query.resultSize();

            const items =
                await query
                    .clone()
                    .orderBy(
                        'created_at',
                        'desc'
                    )
                    .offset(
                        (
                            page -
                            1
                        ) *
                            pageSize
                    )
                    .limit(
                        pageSize
                    );

            return {
                page,

                pageSize,

                total,

                totalPages:
                    Math.ceil(
                        total /
                            pageSize
                    ),

                items,
            };
        }

        const items =
            await query
                .orderBy(
                    'created_at',
                    'desc'
                )
                .offset(
                    (
                        page -
                        1
                    ) *
                        pageSize
                )
                .limit(
                    pageSize
                );

        return {
            page,

            pageSize,

            total:
                items.length,

            totalPages:
                items.length ===
                    pageSize
                    ? page + 1
                    : page,

            items,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Tenant existence
     * ------------------------------------------------------------------------
     */

    async tenantExists(
        tenantId
    ) {
        const id =
            this._tenantId(
                tenantId
            );

        const tenant =
            await this.getTenant(
                id,
                {
                    bypassCache:
                        false,
                }
            );

        return Boolean(
            tenant
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Health
     * ------------------------------------------------------------------------
     */

    async healthCheck() {
        if (
            typeof this.TenantModel
                .healthCheck !==
            'function'
        ) {
            return {
                healthy:
                    false,

                code:
                    'TENANT_MODEL_HEALTHCHECK_UNAVAILABLE',
            };
        }

        return this.TenantModel
            .healthCheck({
                knex:
                    this.knex,
            });
    }

    /**
     * ------------------------------------------------------------------------
     * Internal model update helpers
     * ------------------------------------------------------------------------
     */

    async _safeStatusUpdate(
        tenantId,
        status
    ) {
        if (
            typeof this.TenantModel
                .setStatus ===
            'function'
        ) {
            return this.TenantModel
                .setStatus(
                    tenantId,
                    status,
                    {
                        cacheClient:
                            null,

                        logger:
                            this.logger,
                    }
                );
        }

        const tenant =
            await this.getTenant(
                tenantId,
                {
                    bypassCache:
                        true,

                    includeDeleted:
                        true,
                }
            );

        if (
            !tenant
        ) {
            throw new TenantServiceError(
                'Tenant not found.',
                'TENANT_NOT_FOUND',
                {
                    statusCode:
                        404,
                }
            );
        }

        return this.TenantModel
            .query()
            .patchAndFetchById(
                tenant.id,
                {
                    status,

                    deleted_at:
                        status ===
                        TENANT_STATUS.DELETED
                            ? new Date()
                                .toISOString()
                            : null,

                    updated_at:
                        new Date()
                            .toISOString(),
                }
            );
    }

    async _persistMigrationVersion(
        tenantId,
        version
    ) {
        const tenant =
            await this.getTenant(
                tenantId,
                {
                    bypassCache:
                        true,

                    includeDeleted:
                        true,
                }
            );

        if (
            !tenant
        ) {
            throw new TenantServiceError(
                'Tenant not found.',
                'TENANT_NOT_FOUND',
                {
                    statusCode:
                        404,
                }
            );
        }

        return this.TenantModel
            .query()
            .patchAndFetchById(
                tenant.id,
                {
                    migration_version:
                        version ===
                                undefined ||
                            version ===
                                null
                            ? null
                            : String(
                                version
                            ).slice(
                                0,
                                128
                            ),

                    updated_at:
                        new Date()
                            .toISOString(),
                }
            );
    }

    /**
     * ------------------------------------------------------------------------
     * Logging
     * ------------------------------------------------------------------------
     */

    _logInfo(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.info?.(
                message,
                sanitizeLogMeta(
                    metadata
                )
            );
        } catch {
            // Do not break service execution on logging failures.
        }
    }

    _logWarn(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.warn?.(
                message,
                sanitizeLogMeta(
                    metadata
                )
            );
        } catch {
            // Do not break service execution.
        }
    }

    _logDebug(
        message,
        metadata = {}
    ) {
        try {
            this.logger?.debug?.(
                message,
                sanitizeLogMeta(
                    metadata
                )
            );
        } catch {
            // Do not break service execution.
        }
    }
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createTenantService(
    dependencies = {}
) {
    return new TenantService(
        dependencies
    );
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function sleep(
    milliseconds
) {
    return new Promise(
        resolve =>
            setTimeout(
                resolve,
                milliseconds
            )
    );
}

function computeBackoff(
    attempt,
    base,
    cap
) {
    const exponential =
        Math.min(
            cap,
            base *
                Math.pow(
                    2,
                    attempt
                )
        );

    const jitter =
        Math.floor(
            Math.random() *
                Math.max(
                    1,
                    base
                )
        );

    return (
        exponential +
        jitter
    );
}

function normalizeOptionalString(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return (
        normalized ||
        null
    );
}

function normalizeName(
    name
) {
    const value =
        String(
            name ??
                ''
        ).trim();

    if (
        !value
    ) {
        throw new TenantServiceError(
            'Tenant name is required.',
            'TENANT_NAME_REQUIRED',
            {
                statusCode:
                    400,
            }
        );
    }

    if (
        value.length >
        255
    ) {
        throw new TenantServiceError(
            'Tenant name exceeds 255 characters.',
            'TENANT_NAME_TOO_LONG',
            {
                statusCode:
                    400,
            }
        );
    }

    return value;
}

function parsePositiveInteger(
    value,
    fallback,
    min,
    max
) {
    const parsed =
        Number(
            value
        );

    if (
        !Number.isInteger(
            parsed
        ) ||
        parsed <
            min ||
        parsed >
            max
    ) {
        return fallback;
    }

    return parsed;
}

function isPlainObject(
    value
) {
    return (
        value !==
            null &&
        typeof value ===
            'object' &&
        !Array.isArray(
            value
        )
    );
}

function isDuplicateError(
    error
) {
    return (
        error?.code ===
            'TENANT_EXISTS' ||
        error?.code ===
            '23505' ||
        /duplicate|unique/i.test(
            error?.message ||
                ''
        )
    );
}

function mapModelError(
    error
) {
    if (
        error instanceof
        TenantServiceError
    ) {
        return error;
    }

    if (
        error instanceof
        TenantModelError
    ) {
        return new TenantServiceError(
            error.message,
            error.code,
            {
                statusCode:
                    error.statusCode ||
                    500,

                cause:
                    error,
            }
        );
    }

    if (
        isDuplicateError(
            error
        )
    ) {
        return new TenantServiceError(
            'Tenant already exists.',
            'TENANT_EXISTS',
            {
                statusCode:
                    409,

                cause:
                    error,
            }
        );
    }

    return error;
}

function serializeTenant(
    tenant
) {
    if (
        !tenant
    ) {
        return null;
    }

    return {
        id:
            tenant.id,

        tenant_id:
            tenant.tenant_id,

        name:
            tenant.name,

        status:
            tenant.status,

        domain:
            tenant.domain,

        metadata:
            tenant.metadata ||
            {},

        settings:
            tenant.settings ||
            {},

        migration_version:
            tenant.migration_version,

        created_at:
            tenant.created_at,

        updated_at:
            tenant.updated_at,

        deleted_at:
            tenant.deleted_at,
    };
}

function sanitizeAuditMeta(
    meta
) {
    if (
        !isPlainObject(
            meta
        )
    ) {
        return {};
    }

    const result =
        {};

    const sensitive =
        /password|secret|token|authorization|cookie|credential|private.?key|api.?key/i;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            meta
        )
    ) {
        if (
            sensitive.test(
                key
            )
        ) {
            result[key] =
                '[REDACTED]';

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

function sanitizeLogMeta(
    meta
) {
    if (
        !isPlainObject(
            meta
        )
    ) {
        return {};
    }

    const result =
        {};

    const sensitive =
        /password|secret|token|authorization|cookie|credential|private.?key|api.?key/i;

    for (
        const [
            key,
            value,
        ] of Object.entries(
            meta
        )
    ) {
        if (
            sensitive.test(
                key
            )
        ) {
            result[key] =
                '[REDACTED]';

            continue;
        }

        if (
            typeof value ===
                'string' &&
            value.length >
                1000
        ) {
            result[key] =
                `${value.slice(
                    0,
                    1000
                )}…`;

            continue;
        }

        result[key] =
            value;
    }

    return result;
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    Object.freeze({
        TenantService,

        TenantServiceError,

        createTenantService,
    });