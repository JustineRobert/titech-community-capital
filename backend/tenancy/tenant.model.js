'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenant Registry Model
 * ============================================================================
 *
 * File:
 *   backend/tenancy/tenant.model.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical global tenant-registry model for TITech Community Capital.
 *
 * Technology
 * ----------------------------------------------------------------------------
 * - Objection.js
 * - Knex.js
 * - PostgreSQL-first
 * - Redis-compatible tenant metadata cache
 *
 * Scope
 * ----------------------------------------------------------------------------
 * This model manages the GLOBAL TENANT REGISTRY.
 *
 * It is NOT the per-tenant application data model.
 *
 * Responsibilities:
 *   - Tenant lifecycle
 *   - Tenant identity
 *   - Tenant status
 *   - Tenant metadata/settings
 *   - Tenant domain mapping
 *   - Provisioning state
 *   - Migration version
 *   - Soft deletion/restoration
 *   - Cache integration
 *   - Tenant storage provisioning hooks
 *
 * Security principles
 * ----------------------------------------------------------------------------
 * - Tenant IDs are strictly validated.
 * - Request-controlled values are never silently rewritten before validation.
 * - Database identifiers are generated only through tenantConstants helpers.
 * - Tenant uniqueness is enforced by the database.
 * - Financial/business logic does not belong here.
 * - Destructive storage removal requires explicit confirmation.
 * - Soft-deleted tenants are excluded from normal lookups by default.
 * - Cache is an optimization, never the authoritative tenant registry.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced by TITech Community Capital.
 *
 * ============================================================================
 */

const {
    Model,
    raw,
} =
    require('objection');

const crypto =
    require('node:crypto');

const tenantConstants =
    require('./tenant.constants');

/**
 * ============================================================================
 * Logger
 * ============================================================================
 */

const defaultLogger =
    console;

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const GLOBAL_TENANT_TABLE =
    `${tenantConstants.ENV.DB_TABLE_PREFIX}tenants`;

const TENANT_STATUS =
    Object.freeze({
        PENDING:
            'pending',

        ACTIVE:
            'active',

        SUSPENDED:
            'suspended',

        DELETED:
            'deleted',
    });

const TENANT_STATUS_VALUES =
    Object.freeze(
        Object.values(
            TENANT_STATUS
        )
    );

const TENANT_CACHE_SUFFIX =
    'meta';

const DEFAULT_CACHE_TTL =
    tenantConstants.ENV
        .CACHE_TTL_SECONDS;

const DEFAULT_PROVISION =
    true;

/**
 * ============================================================================
 * Errors
 * ============================================================================
 */

class TenantModelError extends Error {
    constructor(
        message,
        code = 'TENANT_MODEL_ERROR',
        {
            statusCode = 500,
            cause = undefined,
        } = {}
    ) {
        super(
            message
        );

        this.name =
            'TenantModelError';

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

        Error.captureStackTrace?.(
            this,
            TenantModelError
        );
    }
}

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

function generateTenantRecordId() {
    return crypto.randomUUID();
}

function normalizeTenantId(
    tenantId
) {
    if (
        tenantId ===
            undefined ||
        tenantId ===
            null
    ) {
        return null;
    }

    const value =
        String(
            tenantId
        )
            .trim()
            .toLowerCase();

    return value ||
        null;
}

function assertTenantId(
    tenantId
) {
    const normalized =
        normalizeTenantId(
            tenantId
        );

    if (
        !normalized ||
        !tenantConstants.isValidTenantId(
            normalized
        )
    ) {
        throw new TenantModelError(
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
        throw new TenantModelError(
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
        throw new TenantModelError(
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

function normalizeDomain(
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

    const value =
        String(
            domain
        )
            .trim()
            .toLowerCase();

    if (
        !tenantConstants.isValidHostname?.(
            value
        )
    ) {
        throw new TenantModelError(
            'Invalid tenant domain.',
            'INVALID_TENANT_DOMAIN',
            {
                statusCode:
                    400,
            }
        );
    }

    return value;
}

function ensurePlainObject(
    value,
    fieldName
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
        throw new TenantModelError(
            `${fieldName} must be an object.`,
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

function nowIso() {
    return new Date()
        .toISOString();
}

function safeLogger(
    logger
) {
    return logger ||
        defaultLogger;
}

function logInfo(
    logger,
    message,
    metadata = {}
) {
    try {
        logger?.info?.(
            message,
            metadata
        );
    } catch {
        // Logging must never break tenant operations.
    }
}

function logWarn(
    logger,
    message,
    metadata = {}
) {
    try {
        logger?.warn?.(
            message,
            metadata
        );
    } catch {
        // Logging must never break tenant operations.
    }
}

function logError(
    logger,
    message,
    metadata = {}
) {
    try {
        logger?.error?.(
            message,
            metadata
        );
    } catch {
        // Logging must never break tenant operations.
    }
}

function assertKnex(
    knex
) {
    if (
        !knex ||
        typeof knex.transaction !==
            'function'
    ) {
        throw new TenantModelError(
            'A configured Knex instance is required.',
            'KNEX_REQUIRED',
            {
                statusCode:
                    500,
            }
        );
    }

    return knex;
}

function cacheGet(
    cacheClient,
    key
) {
    if (
        !cacheClient ||
        typeof cacheClient.get !==
            'function'
    ) {
        return null;
    }

    return cacheClient.get(
        key
    );
}

async function cacheSet(
    cacheClient,
    key,
    value,
    ttlSeconds
) {
    if (
        !cacheClient ||
        typeof cacheClient.set !==
            'function'
    ) {
        return;
    }

    /**
     * Support both:
     *
     *   node-redis / ioredis style options
     *   legacy set(key, value, 'EX', seconds)
     */
    try {
        await cacheClient.set(
            key,
            JSON.stringify(
                value
            ),
            {
                EX:
                    ttlSeconds,
            }
        );
        return;
    } catch {
        // Fallback to legacy interface.
    }

    try {
        await cacheClient.set(
            key,
            JSON.stringify(
                value
            ),
            'EX',
            ttlSeconds
        );
    } catch {
        // Cache is non-authoritative.
    }
}

async function cacheDelete(
    cacheClient,
    key
) {
    if (
        !cacheClient ||
        typeof cacheClient.del !==
            'function'
    ) {
        return;
    }

    try {
        await cacheClient.del(
            key
        );
    } catch {
        // Cache is non-authoritative.
    }
}

function tenantCacheKey(
    tenantId,
    suffix = TENANT_CACHE_SUFFIX
) {
    return tenantConstants.tenantCacheKey(
        tenantId,
        suffix
    );
}

function buildCacheDocument(
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

/**
 * ============================================================================
 * Tenant Model
 * ============================================================================
 */

class TenantModel extends Model {
    /**
     * ------------------------------------------------------------------------
     * Table
     * ------------------------------------------------------------------------
     */

    static get tableName() {
        return GLOBAL_TENANT_TABLE;
    }

    static get idColumn() {
        return 'id';
    }

    /**
     * ------------------------------------------------------------------------
     * JSON Schema
     * ------------------------------------------------------------------------
     */

    static get jsonSchema() {
        return {
            type:
                'object',

            required:
                [
                    'id',
                    'tenant_id',
                    'name',
                    'status',
                ],

            additionalProperties:
                false,

            properties:
                {
                    id:
                        {
                            type:
                                'string',

                            format:
                                'uuid',
                        },

                    tenant_id:
                        {
                            type:
                                'string',

                            minLength:
                                3,

                            maxLength:
                                64,

                            pattern:
                                '^[a-z0-9-]{3,64}$',
                        },

                    name:
                        {
                            type:
                                'string',

                            minLength:
                                1,

                            maxLength:
                                255,
                        },

                    status:
                        {
                            type:
                                'string',

                            enum:
                                TENANT_STATUS_VALUES,
                        },

                    domain:
                        {
                            type:
                                [
                                    'string',
                                    'null',
                                ],

                            maxLength:
                                255,
                        },

                    metadata:
                        {
                            type:
                                [
                                    'object',
                                    'null',
                                ],
                        },

                    settings:
                        {
                            type:
                                [
                                    'object',
                                    'null',
                                ],
                        },

                    migration_version:
                        {
                            type:
                                [
                                    'string',
                                    'null',
                                ],

                            maxLength:
                                128,
                        },

                    created_at:
                        {
                            type:
                                'string',

                            format:
                                'date-time',
                        },

                    updated_at:
                        {
                            type:
                                'string',

                            format:
                                'date-time',
                        },

                    deleted_at:
                        {
                            type:
                                [
                                    'string',
                                    'null',
                                ],

                            format:
                                'date-time',
                        },
                },
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Modifiers
     * ------------------------------------------------------------------------
     */

    static get modifiers() {
        return {
            notDeleted(
                builder
            ) {
                builder.whereNull(
                    'deleted_at'
                );
            },

            byTenantId(
                builder,
                tenantId
            ) {
                builder.where(
                    'tenant_id',
                    assertTenantId(
                        tenantId
                    )
                );
            },

            active(
                builder
            ) {
                builder
                    .where(
                        'status',
                        TENANT_STATUS.ACTIVE
                    )
                    .whereNull(
                        'deleted_at'
                    );
            },

            pending(
                builder
            ) {
                builder
                    .where(
                        'status',
                        TENANT_STATUS.PENDING
                    )
                    .whereNull(
                        'deleted_at'
                    );
            },

            suspended(
                builder
            ) {
                builder
                    .where(
                        'status',
                        TENANT_STATUS.SUSPENDED
                    )
                    .whereNull(
                        'deleted_at'
                    );
            },
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Relations
     * ------------------------------------------------------------------------
     */

    static get relationMappings() {
        return {};
    }

    /**
     * ------------------------------------------------------------------------
     * Insert Hook
     * ------------------------------------------------------------------------
     */

    async $beforeInsert(
        queryContext
    ) {
        await super.$beforeInsert?.(
            queryContext
        );

        const now =
            nowIso();

        this.id =
            this.id ||
            generateTenantRecordId();

        this.tenant_id =
            assertTenantId(
                this.tenant_id
            );

        this.name =
            normalizeName(
                this.name
            );

        this.domain =
            normalizeDomain(
                this.domain
            );

        this.status =
            this.status ||
            TENANT_STATUS.PENDING;

        if (
            !TENANT_STATUS_VALUES.includes(
                this.status
            )
        ) {
            throw new TenantModelError(
                'Invalid tenant status.',
                'INVALID_TENANT_STATUS',
                {
                    statusCode:
                        400,
                }
            );
        }

        this.metadata =
            ensurePlainObject(
                this.metadata,
                'metadata'
            );

        this.settings =
            ensurePlainObject(
                this.settings,
                'settings'
            );

        this.created_at =
            this.created_at ||
            now;

        this.updated_at =
            now;

        if (
            this.status ===
            TENANT_STATUS.DELETED
        ) {
            this.deleted_at =
                this.deleted_at ||
                now;
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Update Hook
     * ------------------------------------------------------------------------
     */

    async $beforeUpdate(
        opt,
        queryContext
    ) {
        await super.$beforeUpdate?.(
            opt,
            queryContext
        );

        this.updated_at =
            nowIso();

        if (
            this.tenant_id
        ) {
            this.tenant_id =
                assertTenantId(
                    this.tenant_id
                );
        }

        if (
            this.name !==
                undefined
        ) {
            this.name =
                normalizeName(
                    this.name
                );
        }

        if (
            this.domain !==
                undefined
        ) {
            this.domain =
                normalizeDomain(
                    this.domain
                );
        }

        if (
            this.status !==
                undefined &&
            !TENANT_STATUS_VALUES.includes(
                this.status
            )
        ) {
            throw new TenantModelError(
                'Invalid tenant status.',
                'INVALID_TENANT_STATUS',
                {
                    statusCode:
                        400,
                }
            );
        }

        if (
            this.metadata !==
                undefined
        ) {
            this.metadata =
                ensurePlainObject(
                    this.metadata,
                    'metadata'
                );
        }

        if (
            this.settings !==
                undefined
        ) {
            this.settings =
                ensurePlainObject(
                    this.settings,
                    'settings'
                );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Soft Delete
     * ------------------------------------------------------------------------
     */

    async softDelete(
        trx = null
    ) {
        const timestamp =
            nowIso();

        return TenantModel
            .query(
                trx
            )
            .patchAndFetchById(
                this.id,
                {
                    status:
                        TENANT_STATUS.DELETED,

                    deleted_at:
                        timestamp,

                    updated_at:
                        timestamp,
                }
            );
    }

    /**
     * ------------------------------------------------------------------------
     * Restore
     * ------------------------------------------------------------------------
     */

    static async restoreByTenantId(
        tenantId,
        {
            trx = null,
            cacheClient = null,
            logger = defaultLogger,
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const timestamp =
            nowIso();

        const restored =
            await TenantModel
                .query(
                    trx
                )
                .patchAndFetch(
                    {
                        deleted_at:
                            null,

                        status:
                            TENANT_STATUS.ACTIVE,

                        updated_at:
                            timestamp,
                    }
                )
                .where(
                    'tenant_id',
                    id
                )
                .andWhereNotNull(
                    'deleted_at'
                );

        if (
            restored
        ) {
            await cacheDelete(
                cacheClient,
                tenantCacheKey(
                    id
                )
            );

            logInfo(
                logger,
                'Tenant restored',
                {
                    tenant:
                        id,
                }
            );
        }

        return restored ||
            null;
    }

    /**
     * ------------------------------------------------------------------------
     * Create Tenant
     * ------------------------------------------------------------------------
     *
     * Tenant creation is transactionally coordinated when Knex is supplied.
     *
     * Provisioning happens BEFORE activating the tenant.
     * If provisioning fails, the registry remains pending/suspended rather
     * than falsely exposing an active tenant.
     * ------------------------------------------------------------------------
     */

    static async createTenant(
        {
            tenantId,
            name,
            domain = null,
            metadata = {},
            settings = {},
            options = {},
        } = {}
    ) {
        const logger =
            safeLogger(
                options.logger
            );

        const id =
            assertTenantId(
                tenantId
            );

        const normalizedName =
            normalizeName(
                name
            );

        const normalizedDomain =
            normalizeDomain(
                domain
            );

        const normalizedMetadata =
            ensurePlainObject(
                metadata,
                'metadata'
            );

        const normalizedSettings =
            ensurePlainObject(
                settings,
                'settings'
            );

        const provision =
            options.provision !==
            undefined
                ? Boolean(
                    options.provision
                )
                : DEFAULT_PROVISION;

        const knex =
            options.knex ||
            TenantModel.knex();

        if (
            !knex
        ) {
            throw new TenantModelError(
                'Knex instance is required to create a tenant.',
                'KNEX_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        const cacheClient =
            options.cacheClient ||
            null;

        const existing =
            await TenantModel
                .query()
                .where(
                    'tenant_id',
                    id
                )
                .first();

        if (
            existing
        ) {
            throw new TenantModelError(
                'Tenant already exists.',
                'TENANT_EXISTS',
                {
                    statusCode:
                        409,
                }
            );
        }

        const inserted =
            await knex.transaction(
                async trx => {
                    /**
                     * Database uniqueness remains authoritative. The prior
                     * SELECT is only a friendly early check.
                     */
                    let record;

                    try {
                        record =
                            await TenantModel
                                .query(
                                    trx
                                )
                                .insertAndFetch(
                                    {
                                        id:
                                            generateTenantRecordId(),

                                        tenant_id:
                                            id,

                                        name:
                                            normalizedName,

                                        domain:
                                            normalizedDomain,

                                        metadata:
                                            normalizedMetadata,

                                        settings:
                                            normalizedSettings,

                                        status:
                                            TENANT_STATUS.PENDING,

                                        migration_version:
                                            null,

                                        created_at:
                                            nowIso(),

                                        updated_at:
                                            nowIso(),

                                        deleted_at:
                                            null,
                                    }
                                );
                    } catch (
                        error
                    ) {
                        if (
                            isUniqueViolation(
                                error
                            )
                        ) {
                            throw new TenantModelError(
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

                        throw error;
                    }

                    if (
                        provision
                    ) {
                        try {
                            await TenantModel
                                .provisionTenantStorage(
                                    id,
                                    {
                                        knex,

                                        logger,

                                        options:
                                            options.provisionOptions ||
                                            {},
                                    }
                                );
                        } catch (
                            error
                        ) {
                            /**
                             * Keep the registry record pending within the
                             * transaction so the create operation is atomic.
                             *
                             * If the external storage provisioning is itself
                             * non-transactional, the provisioner should expose
                             * compensation/rollback behavior.
                             */
                            throw new TenantModelError(
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
                    }

                    record =
                        await TenantModel
                            .query(
                                trx
                            )
                            .patchAndFetchById(
                                record.id,
                                {
                                    status:
                                        TENANT_STATUS.ACTIVE,

                                    updated_at:
                                        nowIso(),
                                }
                            );

                    return record;
                }
            );

        if (
            cacheClient
        ) {
            try {
                await cacheSet(
                    cacheClient,
                    tenantCacheKey(
                        id
                    ),
                    buildCacheDocument(
                        inserted
                    ),
                    DEFAULT_CACHE_TTL
                );
            } catch (
                error
            ) {
                logWarn(
                    logger,
                    'Failed to prime tenant cache',
                    {
                        tenant:
                            id,

                        error:
                            error?.message,
                    }
                );
            }
        }

        logInfo(
            logger,
            'Tenant created',
            {
                tenant:
                    id,

                status:
                    inserted.status,
            }
        );

        return inserted;
    }

    /**
     * ------------------------------------------------------------------------
     * Provision Tenant Storage
     * ------------------------------------------------------------------------
     */

    static async provisionTenantStorage(
        tenantId,
        {
            knex,
            logger = defaultLogger,
            options = {},
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const db =
            assertKnex(
                knex
            );

        const mode =
            tenantConstants.getTenancyMode();

        logInfo(
            logger,
            'Provisioning tenant storage',
            {
                tenant:
                    id,

                mode,
            }
        );

        switch (
            mode
        ) {
            case tenantConstants
                .TENANCY_MODES
                .SINGLE:
                case tenantConstants
                    .TENANCY_MODES
                    .ISOLATED:
                return {
                    mode,
                    provisioned:
                        false,
                };

            case tenantConstants
                .TENANCY_MODES
                .SCHEMA:
                return TenantModel
                    .provisionSchemaStorage(
                        id,
                        {
                            knex:
                                db,

                            logger,

                            options,
                        }
                    );

            case tenantConstants
                .TENANCY_MODES
                .DATABASE:
                return TenantModel
                    .provisionDatabaseStorage(
                        id,
                        {
                            knex:
                                db,

                            logger,

                            options,
                        }
                    );

            case tenantConstants
                .TENANCY_MODES
                .HYBRID:
                return TenantModel
                    .provisionHybridStorage(
                        id,
                        {
                            knex:
                                db,

                            logger,

                            options,
                        }
                    );

            default:
                throw new TenantModelError(
                    `Unsupported tenancy mode "${mode}".`,
                    'UNSUPPORTED_TENANCY_MODE',
                    {
                        statusCode:
                            500,
                    }
                );
        }
    }

    /**
     * ------------------------------------------------------------------------
     * Schema Provisioning
     * ------------------------------------------------------------------------
     */

    static async provisionSchemaStorage(
        tenantId,
        {
            knex,
            logger = defaultLogger,
            options = {},
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const schemaName =
            tenantConstants
                .schemaNameForTenant(
                    id
                );

        const db =
            assertKnex(
                knex
            );

        /**
         * schemaNameForTenant() has already validated the identifier.
         */
        await db.raw(
            `CREATE SCHEMA IF NOT EXISTS "${schemaName}"`
        );

        if (
            typeof options.migrate ===
            'function'
        ) {
            await options.migrate(
                id,
                {
                    knex:
                        db,

                    schema:
                        schemaName,
                }
            );
        }

        logInfo(
            logger,
            'Tenant schema provisioned',
            {
                tenant:
                    id,

                schema:
                    schemaName,
            }
        );

        return {
            mode:
                tenantConstants
                    .TENANCY_MODES
                    .SCHEMA,

            provisioned:
                true,

            schema:
                schemaName,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Database Provisioning
     * ------------------------------------------------------------------------
     *
     * Creating databases requires elevated privileges and often a separate
     * administrative connection. This method intentionally delegates the
     * actual database creation to an injected function when possible.
     * ------------------------------------------------------------------------
     */

    static async provisionDatabaseStorage(
        tenantId,
        {
            knex,
            logger = defaultLogger,
            options = {},
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const dbName =
            tenantConstants
                .databaseNameForTenant(
                    id
                );

        const db =
            assertKnex(
                knex
            );

        if (
            typeof options.createDatabase ===
            'function'
        ) {
            await options.createDatabase(
                dbName,
                {
                    tenantId:
                        id,
                }
            );
        } else {
            /**
             * PostgreSQL CREATE DATABASE must generally execute outside a
             * transaction. Therefore we do not blindly call it using the
             * current transaction-bound connection.
             */
            if (
                options.allowRawCreateDatabase !==
                true
            ) {
                throw new TenantModelError(
                    'Database provisioning requires options.createDatabase() or explicit allowRawCreateDatabase=true.',
                    'DATABASE_PROVISIONER_REQUIRED',
                    {
                        statusCode:
                            500,
                    }
                );
            }

            await db.raw(
                `CREATE DATABASE "${dbName}"`
            );
        }

        if (
            typeof options.migrate ===
            'function'
        ) {
            await options.migrate(
                id,
                {
                    database:
                        dbName,
                }
            );
        }

        logInfo(
            logger,
            'Tenant database provisioned',
            {
                tenant:
                    id,

                database:
                    dbName,
            }
        );

        return {
            mode:
                tenantConstants
                    .TENANCY_MODES
                    .DATABASE,

            provisioned:
                true,

            database:
                dbName,
        };
    }

    /**
     * ------------------------------------------------------------------------
     * Hybrid Provisioning
     * ------------------------------------------------------------------------
     *
     * The original implementation recursively called itself with unchanged
     * options, causing an infinite recursion bug.
     *
     * This implementation requires an explicit decision:
     *
     *   options.hybridDecision(tenantId, metadata)
     *
     * returning:
     *
     *   "schema"
     *   "database"
     * ------------------------------------------------------------------------
     */

    static async provisionHybridStorage(
        tenantId,
        {
            knex,
            logger = defaultLogger,
            options = {},
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        if (
            typeof options.hybridDecision !==
            'function'
        ) {
            throw new TenantModelError(
                'Hybrid tenancy requires hybridDecision().',
                'HYBRID_DECISION_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        const decision =
            String(
                await options.hybridDecision(
                    id,
                    {
                        knex,
                        logger,
                    }
                )
            )
                .trim()
                .toLowerCase();

        if (
            decision ===
            'schema'
        ) {
            return TenantModel
                .provisionSchemaStorage(
                    id,
                    {
                        knex,

                        logger,

                        options,
                    }
                );
        }

        if (
            decision ===
            'database'
        ) {
            return TenantModel
                .provisionDatabaseStorage(
                    id,
                    {
                        knex,

                        logger,

                        options,
                    }
                );
        }

        throw new TenantModelError(
            `Unsupported HYBRID provisioning decision "${decision}".`,
            'INVALID_HYBRID_DECISION',
            {
                statusCode:
                    500,
            }
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Find Tenant
     * ------------------------------------------------------------------------
     *
     * Normal tenant lookup excludes deleted records.
     * ------------------------------------------------------------------------
     */

    static async findByTenantId(
        tenantId,
        {
            cacheClient = null,
            logger = defaultLogger,
            includeDeleted = false,
            refreshCache = false,
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const cacheKey =
            tenantCacheKey(
                id
            );

        if (
            cacheClient &&
            !includeDeleted &&
            !refreshCache
        ) {
            try {
                const cached =
                    await cacheGet(
                        cacheClient,
                        cacheKey
                    );

                if (
                    cached
                ) {
                    const parsed =
                        typeof cached ===
                        'string'
                            ? JSON.parse(
                                cached
                            )
                            : cached;

                    /**
                     * Defensive cache validation.
                     */
                    if (
                        parsed &&
                        parsed.tenant_id ===
                            id &&
                        parsed.deleted_at ===
                            null
                    ) {
                        return parsed;
                    }
                }
            } catch (
                error
            ) {
                logWarn(
                    logger,
                    'Tenant cache read failed',
                    {
                        tenant:
                            id,

                        error:
                            error?.message,
                    }
                );
            }
        }

        const query =
            TenantModel
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

        const row =
            await query.first();

        if (
            !row
        ) {
            return null;
        }

        if (
            cacheClient &&
            !includeDeleted
        ) {
            try {
                await cacheSet(
                    cacheClient,
                    cacheKey,
                    buildCacheDocument(
                        row
                    ),
                    DEFAULT_CACHE_TTL
                );
            } catch (
                error
            ) {
                logWarn(
                    logger,
                    'Tenant cache write failed',
                    {
                        tenant:
                            id,

                        error:
                            error?.message,
                    }
                );
            }
        }

        return row;
    }

    /**
     * ------------------------------------------------------------------------
     * Find By Domain
     * ------------------------------------------------------------------------
     */

    static async findByDomain(
        domain,
        {
            cacheClient = null,
            logger = defaultLogger,
        } = {}
    ) {
        const normalized =
            normalizeDomain(
                domain
            );

        if (
            !normalized
        ) {
            return null;
        }

        const row =
            await TenantModel
                .query()
                .where(
                    'domain',
                    normalized
                )
                .whereNull(
                    'deleted_at'
                )
                .first();

        if (
            !row
        ) {
            return null;
        }

        if (
            cacheClient
        ) {
            try {
                await cacheSet(
                    cacheClient,
                    tenantCacheKey(
                        row.tenant_id
                    ),
                    buildCacheDocument(
                        row
                    ),
                    DEFAULT_CACHE_TTL
                );
            } catch (
                error
            ) {
                logWarn(
                    logger,
                    'Failed to refresh tenant domain cache',
                    {
                        tenant:
                            row.tenant_id,

                        error:
                            error?.message,
                    }
                );
            }
        }

        return row;
    }

    /**
     * ------------------------------------------------------------------------
     * Status Transition
     * ------------------------------------------------------------------------
     */

    static async setStatus(
        tenantId,
        status,
        {
            trx = null,
            cacheClient = null,
            logger = defaultLogger,
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        if (
            !TENANT_STATUS_VALUES.includes(
                status
            )
        ) {
            throw new TenantModelError(
                'Invalid tenant status.',
                'INVALID_TENANT_STATUS',
                {
                    statusCode:
                        400,
                }
            );
        }

        const timestamp =
            nowIso();

        const patch =
            {
                status,

                updated_at:
                    timestamp,
            };

        if (
            status ===
            TENANT_STATUS.DELETED
        ) {
            patch.deleted_at =
                timestamp;
        } else if (
            status ===
                TENANT_STATUS.ACTIVE ||
            status ===
                TENANT_STATUS.PENDING ||
            status ===
                TENANT_STATUS.SUSPENDED
        ) {
            patch.deleted_at =
                null;
        }

        const updated =
            await TenantModel
                .query(
                    trx
                )
                .patchAndFetch(
                    patch
                )
                .where(
                    'tenant_id',
                    id
                );

        if (
            !updated
        ) {
            throw new TenantModelError(
                'Tenant not found.',
                'TENANT_NOT_FOUND',
                {
                    statusCode:
                        404,
                }
            );
        }

        await cacheDelete(
            cacheClient,
            tenantCacheKey(
                id
            )
        );

        logInfo(
            logger,
            'Tenant status updated',
            {
                tenant:
                    id,

                status,
            }
        );

        return updated;
    }

    /**
     * ------------------------------------------------------------------------
     * Suspend Tenant
     * ------------------------------------------------------------------------
     */

    static async suspendTenant(
        tenantId,
        options = {}
    ) {
        return TenantModel.setStatus(
            tenantId,
            TENANT_STATUS.SUSPENDED,
            options
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Activate Tenant
     * ------------------------------------------------------------------------
     */

    static async activateTenant(
        tenantId,
        options = {}
    ) {
        return TenantModel.setStatus(
            tenantId,
            TENANT_STATUS.ACTIVE,
            options
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Update Settings
     * ------------------------------------------------------------------------
     *
     * PostgreSQL JSONB merge.
     * The implementation reads and updates inside a transaction to avoid
     * accidental overwrites when concurrent callers modify the same document.
     * ------------------------------------------------------------------------
     */

    static async updateSettings(
        tenantId,
        settingsPatch = {},
        trx = null
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const patch =
            ensurePlainObject(
                settingsPatch,
                'settingsPatch'
            );

        const execute =
            async transaction => {
                const tenant =
                    await TenantModel
                        .query(
                            transaction
                        )
                        .findOne(
                            'tenant_id',
                            id
                        )
                        .whereNull(
                            'deleted_at'
                        )
                        .forUpdate();

                if (
                    !tenant
                ) {
                    throw new TenantModelError(
                        'Tenant not found.',
                        'TENANT_NOT_FOUND',
                        {
                            statusCode:
                                404,
                        }
                    );
                }

                const currentSettings =
                    ensurePlainObject(
                        tenant.settings,
                        'settings'
                    );

                const mergedSettings =
                    {
                        ...currentSettings,
                        ...patch,
                    };

                return TenantModel
                    .query(
                        transaction
                    )
                    .patchAndFetchById(
                        tenant.id,
                        {
                            settings:
                                mergedSettings,

                            updated_at:
                                nowIso(),
                        }
                    );
            };

        if (
            trx
        ) {
            return execute(
                trx
            );
        }

        const knex =
            TenantModel.knex();

        if (
            !knex
        ) {
            throw new TenantModelError(
                'Knex instance is required.',
                'KNEX_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        return knex.transaction(
            execute
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Update Metadata
     * ------------------------------------------------------------------------
     */

    static async updateMetadata(
        tenantId,
        metadataPatch = {},
        trx = null
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const patch =
            ensurePlainObject(
                metadataPatch,
                'metadataPatch'
            );

        const execute =
            async transaction => {
                const tenant =
                    await TenantModel
                        .query(
                            transaction
                        )
                        .findOne(
                            'tenant_id',
                            id
                        )
                        .whereNull(
                            'deleted_at'
                        )
                        .forUpdate();

                if (
                    !tenant
                ) {
                    throw new TenantModelError(
                        'Tenant not found.',
                        'TENANT_NOT_FOUND',
                        {
                            statusCode:
                                404,
                        }
                    );
                }

                const currentMetadata =
                    ensurePlainObject(
                        tenant.metadata,
                        'metadata'
                    );

                return TenantModel
                    .query(
                        transaction
                    )
                    .patchAndFetchById(
                        tenant.id,
                        {
                            metadata:
                                {
                                    ...currentMetadata,
                                    ...patch,
                                },

                            updated_at:
                                nowIso(),
                        }
                    );
            };

        if (
            trx
        ) {
            return execute(
                trx
            );
        }

        const knex =
            TenantModel.knex();

        if (
            !knex
        ) {
            throw new TenantModelError(
                'Knex instance is required.',
                'KNEX_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        return knex.transaction(
            execute
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Migration State
     * ------------------------------------------------------------------------
     */

    static async runMigrations(
        tenantId,
        {
            migrateFn,
            knex,
            logger = defaultLogger,
            migrationVersion = null,
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        if (
            typeof migrateFn !==
            'function'
        ) {
            throw new TenantModelError(
                'migrateFn is required to run tenant migrations.',
                'MIGRATION_RUNNER_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        const db =
            knex ||
            TenantModel.knex();

        if (
            !db
        ) {
            throw new TenantModelError(
                'Knex instance is required to run tenant migrations.',
                'KNEX_REQUIRED',
                {
                    statusCode:
                        500,
                }
            );
        }

        logInfo(
            logger,
            'Running tenant migrations',
            {
                tenant:
                    id,
            }
        );

        const result =
            await migrateFn(
                id,
                {
                    knex:
                        db,
                }
            );

        const version =
            migrationVersion ||
            (
                typeof result ===
                    'string'
                    ? result
                    : result?.version ||
                      null
            );

        await TenantModel
            .query()
            .patch({
                migration_version:
                    version,

                updated_at:
                    nowIso(),
            })
            .where(
                'tenant_id',
                id
            );

        logInfo(
            logger,
            'Tenant migrations completed',
            {
                tenant:
                    id,

                version,
            }
        );

        return version;
    }

    /**
     * ------------------------------------------------------------------------
     * Delete Tenant
     * ------------------------------------------------------------------------
     *
     * Registry deletion is always soft deletion.
     *
     * Physical storage deletion is a separate explicit operation and requires:
     *
     *   dropStorage === true
     *   confirmTenantId === tenantId
     *   dropStorageFn()
     *
     * This protects against accidental destructive operations.
     * ------------------------------------------------------------------------
     */

    static async deleteTenant(
        tenantId,
        {
            dropStorage = false,
            confirmTenantId = null,
            dropStorageFn = null,
            cacheClient = null,
            knex = null,
            logger = defaultLogger,
        } = {}
    ) {
        const id =
            assertTenantId(
                tenantId
            );

        const tenant =
            await TenantModel
                .findByTenantId(
                    id,
                    {
                        includeDeleted:
                            true,

                        logger,
                    }
                );

        if (
            !tenant
        ) {
            throw new TenantModelError(
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
            return true;
        }

        const timestamp =
            nowIso();

        await TenantModel
            .query()
            .patch({
                status:
                    TENANT_STATUS.DELETED,

                deleted_at:
                    timestamp,

                updated_at:
                    timestamp,
            })
            .where(
                'tenant_id',
                id
            );

        await cacheDelete(
            cacheClient,
            tenantCacheKey(
                id
            )
        );

        /**
         * Physical deletion is deliberately explicit.
         */
        if (
            dropStorage
        ) {
            if (
                confirmTenantId !==
                    id
            ) {
                throw new TenantModelError(
                    'Physical tenant deletion requires an exact confirmTenantId match.',
                    'TENANT_DELETION_CONFIRMATION_REQUIRED',
                    {
                        statusCode:
                            400,
                    }
                );
            }

            if (
                typeof dropStorageFn !==
                'function'
            ) {
                throw new TenantModelError(
                    'dropStorageFn is required for physical tenant storage deletion.',
                    'TENANT_STORAGE_DELETION_HANDLER_REQUIRED',
                    {
                        statusCode:
                            500,
                    }
                );
            }

            try {
                await dropStorageFn(
                    id,
                    {
                        knex:
                            knex ||
                            TenantModel.knex(),
                    }
                );
            } catch (
                error
            ) {
                logError(
                    logger,
                    'Tenant storage deletion failed',
                    {
                        tenant:
                            id,

                        error:
                            error?.message,
                    }
                );

                throw new TenantModelError(
                    'Tenant storage deletion failed.',
                    'TENANT_STORAGE_DELETION_FAILED',
                    {
                        statusCode:
                            500,

                        cause:
                            error,
                    }
                );
            }
        }

        logInfo(
            logger,
            'Tenant deleted',
            {
                tenant:
                    id,

                storageDropped:
                    Boolean(
                        dropStorage
                    ),
            }
        );

        return true;
    }

    /**
     * ------------------------------------------------------------------------
     * Bind Knex
     * ------------------------------------------------------------------------
     */

    static bindKnex(
        knex
    ) {
        assertKnex(
            knex
        );

        Model.knex(
            knex
        );

        return TenantModel;
    }

    /**
     * ------------------------------------------------------------------------
     * Registry Table Creation
     * ------------------------------------------------------------------------
     */

    static async createRegistryTable(
        knex,
        {
            tableName =
                GLOBAL_TENANT_TABLE,
        } = {}
    ) {
        const db =
            assertKnex(
                knex
            );

        if (
            !tenantConstants.isSafeDatabaseIdentifier(
                tableName
            )
        ) {
            throw new TenantModelError(
                `Invalid tenant registry table name "${tableName}".`,
                'INVALID_TENANT_REGISTRY_TABLE',
                {
                    statusCode:
                        500,
                }
            );
        }

        const exists =
            await db.schema.hasTable(
                tableName
            );

        if (
            exists
        ) {
            return false;
        }

        await db.schema.createTable(
            tableName,
            table => {
                /**
                 * PostgreSQL UUID primary key.
                 */
                table
                    .uuid(
                        'id'
                    )
                    .primary();

                table
                    .string(
                        'tenant_id',
                        64
                    )
                    .notNullable()
                    .unique()
                    .index();

                table
                    .string(
                        'name',
                        255
                    )
                    .notNullable();

                table
                    .string(
                        'status',
                        32
                    )
                    .notNullable()
                    .defaultTo(
                        TENANT_STATUS.PENDING
                    )
                    .index();

                table
                    .string(
                        'domain',
                        255
                    )
                    .nullable()
                    .unique();

                table
                    .jsonb(
                        'metadata'
                    )
                    .notNullable()
                    .defaultTo(
                        '{}'
                    );

                table
                    .jsonb(
                        'settings'
                    )
                    .notNullable()
                    .defaultTo(
                        '{}'
                    );

                table
                    .string(
                        'migration_version',
                        128
                    )
                    .nullable();

                table
                    .timestamp(
                        'created_at',
                        {
                            useTz:
                                true,
                        }
                    )
                    .notNullable()
                    .defaultTo(
                        db.fn.now()
                    );

                table
                    .timestamp(
                        'updated_at',
                        {
                            useTz:
                                true,
                        }
                    )
                    .notNullable()
                    .defaultTo(
                        db.fn.now()
                    );

                table
                    .timestamp(
                        'deleted_at',
                        {
                            useTz:
                                true,
                        }
                    )
                    .nullable()
                    .index();
            }
        );

        /**
         * Partial unique index:
         *
         * Allows a deleted tenant record to retain its historical domain while
         * permitting a new active tenant to reuse the domain only if explicitly
         * supported by the deployment policy.
         *
         * The normal unique constraint above remains intentionally conservative.
         */

        return true;
    }

    /**
     * ------------------------------------------------------------------------
     * Registry Health
     * ------------------------------------------------------------------------
     */

    static async healthCheck(
        {
            knex = null,
        } = {}
    ) {
        const db =
            knex ||
            TenantModel.knex();

        if (
            !db
        ) {
            return {
                healthy:
                    false,

                code:
                    'KNEX_NOT_CONFIGURED',
            };
        }

        try {
            await TenantModel
                .query(db)
                .select(
                    raw('1')
                )
                .first();

            return {
                healthy:
                    true,

                table:
                    GLOBAL_TENANT_TABLE,

                timestamp:
                    nowIso(),
            };
        } catch (
            error
        ) {
            return {
                healthy:
                    false,

                code:
                    'TENANT_REGISTRY_UNAVAILABLE',

                message:
                    error?.message,
            };
        }
    }
}

/**
 * ============================================================================
 * Static Constants / Compatibility Exports
 * ============================================================================
 */

TenantModel.TENANT_STATUS =
    TENANT_STATUS;

TenantModel.GLOBAL_TENANT_TABLE =
    GLOBAL_TENANT_TABLE;

TenantModel.TENANT_CACHE_SUFFIX =
    TENANT_CACHE_SUFFIX;

/**
 * ============================================================================
 * Database Error Helpers
 * ============================================================================
 */

function isUniqueViolation(
    error
) {
    return (
        error?.code ===
            '23505' ||
        error?.nativeError?.code ===
            '23505' ||
        /unique|duplicate/i.test(
            error?.message ||
            ''
        )
    );
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    Object.freeze({
        TenantModel,

        GLOBAL_TENANT_TABLE,

        TENANT_STATUS,

        TenantModelError,
    });