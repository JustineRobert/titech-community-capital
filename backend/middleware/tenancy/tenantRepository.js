'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/middleware/tenancy/tenantRepository.js
 *
 * Enterprise Tenant Repository Foundation
 *
 * -----------------------------------------------------------------------------
 * Purpose
 * -----------------------------------------------------------------------------
 *
 * Provides the shared enterprise foundation for the tenant repository
 * subsystem responsible for:
 *
 * • Tenant lookup
 * • Cache integration
 * • Metadata loading
 * • Feature loading
 * • Plan resolution
 * • Lifecycle validation
 * • Repository diagnostics
 *
 * This file intentionally contains only the shared infrastructure.
 * Concrete persistence implementations are added in subsequent phases.
 *
 * =============================================================================
 */

const os = require('os');
const crypto = require('crypto');

/* ============================================================================
 * Optional Enterprise Dependencies
 * ========================================================================== */

let ConfigurationProvider;
let LoggerFactory;
let StructuredLogger;
let MetricsRegistry;
let RequestMetrics;
let TraceContext;
let EventBus;
let AuditService;
let TenantModel;
let mongoose;

try {
    ConfigurationProvider = require('../../config/ConfigurationProvider');
} catch (_) {}

try {
    LoggerFactory = require('../../shared/logging/LoggerFactory');
} catch (_) {}

try {
    StructuredLogger = require('../../shared/logging/StructuredLogger');
} catch (_) {}

try {
    MetricsRegistry = require('../../shared/metrics/MetricsRegistry');
} catch (_) {}

try {
    RequestMetrics = require('../../shared/metrics/RequestMetrics');
} catch (_) {}

try {
    TraceContext = require('../../shared/tracing/TraceContext');
} catch (_) {}

try {
    EventBus = require('../../shared/events/EventBus');
} catch (_) {}

try {
    AuditService = require('../../shared/audit/AuditService');
} catch (_) {}

try {
    TenantModel = require('../../models/Tenant');
} catch (_) {}

try {
    mongoose = require('mongoose');
} catch (_) {}

/* ============================================================================
 * Repository Constants
 * ========================================================================== */

const COMPONENT_NAME = 'EnterpriseTenantRepository';

const COMPONENT_VERSION = '1.0.0';

const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const DEFAULT_QUERY_TIMEOUT_MS = 10000;

const DEFAULT_CACHE_NAMESPACE = 'tenant';

const DEFAULT_PLAN = 'starter';

const REPOSITORY_STATUS = Object.freeze({

    INITIALIZING: 'initializing',

    READY: 'ready',

    DEGRADED: 'degraded',

    FAILED: 'failed'

});

const TENANT_STATUS = Object.freeze({

    ACTIVE: 'active',

    SUSPENDED: 'suspended',

    DISABLED: 'disabled',

    DELETED: 'deleted',

    ARCHIVED: 'archived'

});

/* ============================================================================
 * Repository Metadata
 * ========================================================================== */

const METADATA = Object.freeze({

    name: COMPONENT_NAME,

    version: COMPONENT_VERSION,

    category: 'tenancy',

    layer: 'repository',

    critical: true,

    supportsCaching: true,

    supportsDiagnostics: true,

    supportsMongoDB: true,

    supportsRedis: true,

    supportsTracing: true,

    supportsMetrics: true

});

/* ============================================================================
 * Runtime State
 * ========================================================================== */

const INTERNAL_STATE = Object.seal({

    initialized: false,

    initializedAt: null,

    status: REPOSITORY_STATUS.INITIALIZING,

    hostname: os.hostname(),

    processId: process.pid,

    cacheEnabled: false,

    cacheHits: 0,

    cacheMisses: 0,

    databaseQueries: 0,

    lastLookup: null,

    lastHealthCheck: null,

    lastReadinessCheck: null,

    configurationHash: null

});

/* ============================================================================
 * Configuration Resolver
 * ========================================================================== */

function resolveConfiguration(overrides = {}) {

    const configuration =

        typeof ConfigurationProvider?.get === 'function'

            ? ConfigurationProvider.get('tenantRepository')

            : {};

    const resolved = Object.freeze({

        cache: {

            enabled:

                configuration.cache?.enabled ?? true,

            ttl:

                configuration.cache?.ttl ??

                DEFAULT_CACHE_TTL_MS

        },

        database: {

            timeout:

                configuration.database?.timeout ??

                DEFAULT_QUERY_TIMEOUT_MS

        },

        diagnostics: {

            enabled:

                configuration.diagnostics?.enabled ?? true

        },

        tracing: {

            enabled:

                configuration.tracing?.enabled ?? true

        },

        metrics: {

            enabled:

                configuration.metrics?.enabled ?? true

        },

        ...overrides

    });

    INTERNAL_STATE.configurationHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(resolved))
        .digest('hex');

    return resolved;

}

/* ============================================================================
 * Repository Contract
 * ========================================================================== */

class TenantRepository {

    async findById(/* tenantId */) {

        throw new Error('findById() not implemented.');

    }

    async findByCode(/* tenantCode */) {

        throw new Error('findByCode() not implemented.');

    }

    async findByHostname(/* hostname */) {

        throw new Error('findByHostname() not implemented.');

    }

    async findByApiClient(/* clientId */) {

        throw new Error('findByApiClient() not implemented.');

    }

    async exists(/* tenantId */) {

        throw new Error('exists() not implemented.');

    }

    async warmCache() {

        throw new Error('warmCache() not implemented.');

    }

}

/* ============================================================================
 * Shared Repository Utilities
 * ========================================================================== */

function updateLookupStatistics(identifier) {

    INTERNAL_STATE.lastLookup = {

        identifier,

        timestamp: new Date().toISOString()

    };

    INTERNAL_STATE.databaseQueries++;

}

function recordCacheHit() {

    INTERNAL_STATE.cacheHits++;

}

function recordCacheMiss() {

    INTERNAL_STATE.cacheMisses++;

}

function initializeRepositoryRuntime() {

    INTERNAL_STATE.initialized = true;

    INTERNAL_STATE.initializedAt = new Date().toISOString();

    INTERNAL_STATE.status = REPOSITORY_STATUS.READY;

    return INTERNAL_STATE;

}



/**
 * ============================================================================
 * Phase 3.2 — Enterprise Tenant Repository Abstraction
 * ============================================================================
 */

/**
 * Enterprise repository contract.
 *
 * All concrete implementations (MongoDB, Redis-backed, cached, etc.)
 * MUST implement this interface.
 */
class TenantRepository {

    constructor(options = {}) {

        this.options = Object.freeze({
            cacheEnabled: options.cacheEnabled ?? true,
            tracingEnabled: options.tracingEnabled ?? true,
            metricsEnabled: options.metricsEnabled ?? true,
            ...options
        });

    }

    /**
     * Find tenant by internal identifier.
     *
     * @param {string} tenantId
     * @param {object} [options]
     * @returns {Promise<object|null>}
     */
    async findById(/* tenantId, options */) {

        throw new Error(
            'TenantRepository.findById() must be implemented.'
        );

    }

    /**
     * Find tenant by unique tenant code.
     *
     * Example:
     * TIT001
     * COMMUNITY_CAPITAL
     *
     * @param {string} tenantCode
     * @param {object} [options]
     * @returns {Promise<object|null>}
     */
    async findByCode(/* tenantCode, options */) {

        throw new Error(
            'TenantRepository.findByCode() must be implemented.'
        );

    }

    /**
     * Resolve tenant from hostname.
     *
     * Supports:
     *
     * tenant.example.com
     * client.company.com
     * custom domains
     *
     * @param {string} hostname
     * @param {object} [options]
     * @returns {Promise<object|null>}
     */
    async findByHostname(/* hostname, options */) {

        throw new Error(
            'TenantRepository.findByHostname() must be implemented.'
        );

    }

    /**
     * Resolve tenant from an API client.
     *
     * API Key
     *      ↓
     * API Client
     *      ↓
     * Tenant
     *
     * @param {string} apiClientId
     * @param {object} [options]
     * @returns {Promise<object|null>}
     */
    async findByApiClient(/* apiClientId, options */) {

        throw new Error(
            'TenantRepository.findByApiClient() must be implemented.'
        );

    }

    /**
     * Determine whether a tenant exists.
     *
     * @param {string} tenantId
     * @param {object} [options]
     * @returns {Promise<boolean>}
     */
    async exists(/* tenantId, options */) {

        throw new Error(
            'TenantRepository.exists() must be implemented.'
        );

    }

    /**
     * Warm repository caches.
     *
     * Used during:
     *
     * • startup
     * • cache rebuild
     * • failover recovery
     * • deployment
     *
     * @param {object} [options]
     * @returns {Promise<object>}
     */
    async warmCache(/* options */) {

        throw new Error(
            'TenantRepository.warmCache() must be implemented.'
        );

    }

    /**
     * Optional cleanup hook.
     */
    async dispose() {

        return undefined;

    }

}


/* ============================================================================
 * Phase 3.3 — Enterprise MongoDB Repository
 * ============================================================================
 */

/**
 * Enterprise MongoDB implementation of the TenantRepository.
 *
 * Responsibilities:
 *
 * • Mongoose persistence
 * • Projection enforcement
 * • Read preference selection
 * • Lean query optimization
 * • Query timeout enforcement
 * • Retry policy
 *
 * Non-Responsibilities:
 *
 * • Tenant validation
 * • Feature loading
 * • Plan resolution
 * • Cache orchestration
 *
 * Those are implemented in later phases.
 */

class MongoTenantRepository extends TenantRepository {

    constructor(options = {}) {

        super(options);

        if (!TenantModel) {

            throw new Error(
                'TenantModel is not available.'
            );

        }

        this.model =

            options.model ||

            TenantModel;

        this.defaultProjection = Object.freeze({

            __v: 0

        });

        this.defaultReadPreference =

            options.readPreference ||

            'primaryPreferred';

        this.defaultTimeout =

            options.queryTimeout ||

            DEFAULT_QUERY_TIMEOUT_MS;

        this.maxRetries =

            options.maxRetries ||

            2;

    }

    /* =======================================================================
     * Internal Query Builder
     * ===================================================================== */

    buildQuery(filter = {}, projection = {}) {

        return this.model
            .findOne(filter, {

                ...this.defaultProjection,

                ...projection

            })
            .read(this.defaultReadPreference)
            .lean({ virtuals: true })
            .maxTimeMS(this.defaultTimeout);

    }

    /* =======================================================================
     * Retry Wrapper
     * ===================================================================== */

    async execute(operation) {

        let lastError;

        for (

            let attempt = 0;

            attempt <= this.maxRetries;

            attempt++

        ) {

            try {

                INTERNAL_STATE.databaseQueries++;

                return await operation();

            }

            catch (error) {

                lastError = error;

                const retryable =

                    this.isRetryable(error);

                if (

                    !retryable ||

                    attempt === this.maxRetries

                ) {

                    throw error;

                }

            }

        }

        throw lastError;

    }

    isRetryable(error) {

        if (!error) {

            return false;

        }

        return (

            error.name === 'MongoNetworkError' ||

            error.name === 'MongoServerSelectionError' ||

            error.code === 91 ||

            error.code === 189 ||

            error.code === 11600

        );

    }

    /* =======================================================================
     * Repository API
     * ===================================================================== */

    async findById(tenantId, options = {}) {

        updateLookupStatistics(tenantId);

        return this.execute(() =>

            this.buildQuery(

                {

                    _id: tenantId

                },

                options.projection

            )

        );

    }

    async findByCode(tenantCode, options = {}) {

        updateLookupStatistics(tenantCode);

        return this.execute(() =>

            this.buildQuery(

                {

                    code: tenantCode

                },

                options.projection

            )

        );

    }

    async findByHostname(hostname, options = {}) {

        updateLookupStatistics(hostname);

        return this.execute(() =>

            this.buildQuery(

                {

                    hostnames: hostname

                },

                options.projection

            )

        );

    }

    async findByApiClient(apiClientId, options = {}) {

        updateLookupStatistics(apiClientId);

        return this.execute(() =>

            this.buildQuery(

                {

                    apiClients: apiClientId

                },

                options.projection

            )

        );

    }

    async exists(tenantId) {

        return this.execute(async () => {

            const count =

                await this.model
                    .countDocuments({

                        _id: tenantId

                    })
                    .maxTimeMS(

                        this.defaultTimeout

                    );

            return count > 0;

        });

    }

    /**
     * Cache warm-up placeholder.
     *
     * Full implementation arrives in Phase 3.4.
     */
    async warmCache() {

        return {

            warmed: false,

            reason:

                'Cache layer not yet implemented.'

        };

    }

}


/* ============================================================================
 * Phase 3.4 — Enterprise Cache Layer
 * ============================================================================
 */

/**
 * Enterprise cache-enabled repository.
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 *
 * • L1 in-process memory cache
 * • L2 Redis cache
 * • Cache invalidation
 * • Cache warming
 * • TTL management
 * • Stampede protection
 *
 * The cache layer decorates an underlying TenantRepository implementation.
 */

class CachedTenantRepository extends TenantRepository {

    constructor(repository, options = {}) {

        super(options);

        if (!(repository instanceof TenantRepository)) {

            throw new TypeError(
                'repository must implement TenantRepository.'
            );

        }

        this.repository = repository;

        this.memoryCache = new Map();

        this.pendingLoads = new Map();

        this.redis = options.redis || null;

        this.memoryTtl =
            options.memoryTtl ??
            DEFAULT_CACHE_TTL_MS;

        this.redisTtl =
            options.redisTtl ??
            DEFAULT_CACHE_TTL_MS;

    }

    /* =======================================================================
     * Cache Helpers
     * ===================================================================== */

    cacheKey(namespace, value) {

        return `${DEFAULT_CACHE_NAMESPACE}:${namespace}:${value}`;

    }

    now() {

        return Date.now();

    }

    isExpired(entry) {

        return !entry || entry.expiresAt <= this.now();

    }

    /* =======================================================================
     * Memory Cache
     * ===================================================================== */

    getMemory(key) {

        const entry = this.memoryCache.get(key);

        if (this.isExpired(entry)) {

            this.memoryCache.delete(key);

            return null;

        }

        recordCacheHit();

        return entry.value;

    }

    setMemory(key, value) {

        this.memoryCache.set(key, {

            value,

            expiresAt:

                this.now() +

                this.memoryTtl

        });

    }

    /* =======================================================================
     * Redis Cache
     * ===================================================================== */

    async getRedis(key) {

        if (!this.redis) {

            return null;

        }

        try {

            const payload =
                await this.redis.get(key);

            if (!payload) {

                return null;

            }

            recordCacheHit();

            return JSON.parse(payload);

        }

        catch (_) {

            return null;

        }

    }

    async setRedis(key, value) {

        if (!this.redis) {

            return;

        }

        try {

            await this.redis.set(

                key,

                JSON.stringify(value),

                'PX',

                this.redisTtl

            );

        }

        catch (_) {

            // Redis failures should never block request processing.
        }

    }

    /* =======================================================================
     * Stampede Protection
     * ===================================================================== */

    async loadOnce(key, loader) {

        if (this.pendingLoads.has(key)) {

            return this.pendingLoads.get(key);

        }

        const promise = (async () => {

            try {

                return await loader();

            }

            finally {

                this.pendingLoads.delete(key);

            }

        })();

        this.pendingLoads.set(key, promise);

        return promise;

    }

    /* =======================================================================
     * Unified Lookup
     * ===================================================================== */

    async lookup(namespace, value, loader) {

        const key =
            this.cacheKey(namespace, value);

        const memory =
            this.getMemory(key);

        if (memory) {

            return memory;

        }

        const redis =
            await this.getRedis(key);

        if (redis) {

            this.setMemory(key, redis);

            return redis;

        }

        recordCacheMiss();

        return this.loadOnce(

            key,

            async () => {

                const entity =
                    await loader();

                if (!entity) {

                    return null;

                }

                this.setMemory(key, entity);

                await this.setRedis(

                    key,

                    entity

                );

                return entity;

            }

        );

    }

    /* =======================================================================
     * Repository Methods
     * ===================================================================== */

    async findById(id) {

        return this.lookup(

            'id',

            id,

            () =>

                this.repository.findById(id)

        );

    }

    async findByCode(code) {

        return this.lookup(

            'code',

            code,

            () =>

                this.repository.findByCode(code)

        );

    }

    async findByHostname(hostname) {

        return this.lookup(

            'hostname',

            hostname,

            () =>

                this.repository.findByHostname(hostname)

        );

    }

    async findByApiClient(clientId) {

        return this.lookup(

            'api-client',

            clientId,

            () =>

                this.repository.findByApiClient(clientId)

        );

    }

    async exists(id) {

        return this.repository.exists(id);

    }

    /* =======================================================================
     * Cache Invalidation
     * ===================================================================== */

    async invalidate(namespace, value) {

        const key =
            this.cacheKey(namespace, value);

        this.memoryCache.delete(key);

        if (this.redis) {

            try {

                await this.redis.del(key);

            }

            catch (_) {

                // Ignore Redis invalidation failures.
            }

        }

    }

    async invalidateTenant(tenant) {

        if (!tenant) {

            return;

        }

        if (tenant._id) {

            await this.invalidate(
                'id',
                tenant._id.toString()
            );

        }

        if (tenant.code) {

            await this.invalidate(
                'code',
                tenant.code
            );

        }

        if (Array.isArray(tenant.hostnames)) {

            for (const hostname of tenant.hostnames) {

                await this.invalidate(
                    'hostname',
                    hostname
                );

            }

        }

    }

    /* =======================================================================
     * Cache Warming
     * ===================================================================== */

    async warmCache() {

        const tenants =
            await this.repository
                .model
                ?.find({}, { _id: 1, code: 1 })
                .lean();

        if (!Array.isArray(tenants)) {

            return {

                warmed: 0

            };

        }

        for (const tenant of tenants) {

            await this.findById(
                tenant._id.toString()
            );

        }

        return {

            warmed:

                tenants.length

        };

    }

    /* =======================================================================
     * TTL Management
     * ===================================================================== */

    setMemoryTtl(milliseconds) {

        this.memoryTtl = milliseconds;

    }

    setRedisTtl(milliseconds) {

        this.redisTtl = milliseconds;

    }

    clearMemory() {

        this.memoryCache.clear();

    }

}


/* ============================================================================
 * Phase 3.5 — Enterprise Tenant Validation Engine
 * ============================================================================
 */

/**
 * Enterprise tenant lifecycle validator.
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 *
 * • Validate tenant existence.
 * • Enforce lifecycle state.
 * • Verify subscription status.
 * • Prevent access to inactive tenants.
 *
 * This engine is intentionally independent of persistence and caching.
 */

class TenantValidationEngine {

    constructor(options = {}) {

        this.options = Object.freeze({

            allowArchived:
                options.allowArchived ?? false,

            allowSuspended:
                options.allowSuspended ?? false,

            allowLocked:
                options.allowLocked ?? false,

            allowDeleted:
                options.allowDeleted ?? false

        });

    }

    /**
     * Validate a tenant document.
     *
     * @param {object|null} tenant
     * @returns {object}
     * @throws {TenantNotFoundError}
     * @throws {TenantInactiveError}
     * @throws {TenantSuspendedError}
     * @throws {TenantUnauthorizedError}
     */
    validate(tenant) {

        this.ensureExists(tenant);

        this.ensureNotDeleted(tenant);

        this.ensureNotArchived(tenant);

        this.ensureNotLocked(tenant);

        this.ensureNotSuspended(tenant);

        this.ensureSubscriptionValid(tenant);

        this.ensureActive(tenant);

        return Object.freeze(tenant);

    }

    ensureExists(tenant) {

        if (!tenant) {

            throw new TenantNotFoundError(
                'Tenant could not be found.'
            );

        }

    }

    ensureNotDeleted(tenant) {

        if (

            tenant.deleted === true ||

            tenant.status === TENANT_STATUS.DELETED

        ) {

            throw new TenantInactiveError(
                'Tenant has been deleted.',
                {
                    tenantId: tenant._id
                }
            );

        }

    }

    ensureNotArchived(tenant) {

        if (

            this.options.allowArchived

        ) {

            return;

        }

        if (

            tenant.archived === true ||

            tenant.status === TENANT_STATUS.ARCHIVED

        ) {

            throw new TenantInactiveError(
                'Tenant has been archived.',
                {
                    tenantId: tenant._id
                }
            );

        }

    }

    ensureNotLocked(tenant) {

        if (

            this.options.allowLocked

        ) {

            return;

        }

        if (

            tenant.locked === true ||

            tenant.security?.locked === true

        ) {

            throw new TenantUnauthorizedError(
                'Tenant has been locked.',
                {
                    tenantId: tenant._id
                }
            );

        }

    }

    ensureNotSuspended(tenant) {

        if (

            this.options.allowSuspended

        ) {

            return;

        }

        if (

            tenant.status === TENANT_STATUS.SUSPENDED ||

            tenant.suspended === true

        ) {

            throw new TenantSuspendedError(
                'Tenant account is suspended.',
                {
                    tenantId: tenant._id
                }
            );

        }

    }

    ensureSubscriptionValid(tenant) {

        const expiry =

            tenant.subscription?.expiresAt ||

            tenant.plan?.expiresAt;

        if (!expiry) {

            return;

        }

        if (

            new Date(expiry) < new Date()

        ) {

            throw new TenantPolicyViolationError(
                'Tenant subscription has expired.',
                {
                    tenantId: tenant._id,
                    expiresAt: expiry
                }
            );

        }

    }

    ensureActive(tenant) {

        if (

            tenant.active === false ||

            (
                tenant.status &&

                tenant.status !== TENANT_STATUS.ACTIVE
            )

        ) {

            throw new TenantInactiveError(
                'Tenant is not active.',
                {
                    tenantId: tenant._id,
                    status: tenant.status
                }
            );

        }

    }

}


/* ============================================================================
 * Phase 3.6 — Enterprise Tenant Metadata Loader
 * ============================================================================
 */

/**
 * Enterprise Tenant Metadata Loader.
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 *
 * • Branding normalization
 * • Locale normalization
 * • Currency resolution
 * • Timezone resolution
 * • Country metadata
 * • Regulatory profile loading
 * • Contact information
 * • Immutable metadata construction
 */

class TenantMetadataLoader {

    constructor(options = {}) {

        this.options = Object.freeze({

            defaultLocale:
                options.defaultLocale || 'en-UG',

            defaultCurrency:
                options.defaultCurrency || 'UGX',

            defaultTimezone:
                options.defaultTimezone || 'Africa/Kampala',

            defaultCountry:
                options.defaultCountry || 'UG',

            defaultRegulator:
                options.defaultRegulator || 'UNKNOWN'

        });

    }

    /**
     * Load enterprise tenant metadata.
     */
    load(tenant) {

        if (!tenant) {

            throw new TenantValidationError(
                'Tenant metadata cannot be loaded from an empty tenant.'
            );

        }

        return Object.freeze({

            branding:
                this.loadBranding(tenant),

            locale:
                this.loadLocale(tenant),

            currency:
                this.loadCurrency(tenant),

            timezone:
                this.loadTimezone(tenant),

            country:
                this.loadCountry(tenant),

            regulatory:
                this.loadRegulatoryProfile(tenant),

            contact:
                this.loadContactInformation(tenant)

        });

    }

    /* =======================================================================
     * Branding
     * ===================================================================== */

    loadBranding(tenant) {

        return Object.freeze({

            name:
                tenant.branding?.name ||
                tenant.name,

            shortName:
                tenant.branding?.shortName ||
                tenant.shortName ||
                tenant.name,

            logo:
                tenant.branding?.logo || null,

            favicon:
                tenant.branding?.favicon || null,

            primaryColor:
                tenant.branding?.primaryColor || '#0B5FFF',

            secondaryColor:
                tenant.branding?.secondaryColor || '#005B96'

        });

    }

    /* =======================================================================
     * Locale
     * ===================================================================== */

    loadLocale(tenant) {

        return Object.freeze({

            language:
                tenant.locale?.language || 'en',

            locale:
                tenant.locale?.code ||
                tenant.locale ||
                this.options.defaultLocale

        });

    }

    /* =======================================================================
     * Currency
     * ===================================================================== */

    loadCurrency(tenant) {

        return Object.freeze({

            code:
                tenant.currency?.code ||
                tenant.currency ||
                this.options.defaultCurrency,

            symbol:
                tenant.currency?.symbol || null,

            decimals:
                tenant.currency?.decimals ?? 2

        });

    }

    /* =======================================================================
     * Timezone
     * ===================================================================== */

    loadTimezone(tenant) {

        return Object.freeze({

            timezone:
                tenant.timezone ||
                this.options.defaultTimezone

        });

    }

    /* =======================================================================
     * Country
     * ===================================================================== */

    loadCountry(tenant) {

        return Object.freeze({

            code:
                tenant.country?.code ||
                tenant.country ||
                this.options.defaultCountry,

            name:
                tenant.country?.name || null,

            region:
                tenant.country?.region || null

        });

    }

    /* =======================================================================
     * Regulatory Profile
     * ===================================================================== */

    loadRegulatoryProfile(tenant) {

        return Object.freeze({

            regulator:
                tenant.regulatory?.authority ||
                this.options.defaultRegulator,

            amlEnabled:
                tenant.regulatory?.amlEnabled ?? true,

            kycRequired:
                tenant.regulatory?.kycRequired ?? true,

            auditRetentionDays:
                tenant.regulatory?.auditRetentionDays ?? 2555,

            dataResidency:
                tenant.regulatory?.dataResidency || null,

            reportingProfile:
                tenant.regulatory?.reportingProfile || null

        });

    }

    /* =======================================================================
     * Contact Information
     * ===================================================================== */

    loadContactInformation(tenant) {

        return Object.freeze({

            email:
                tenant.contact?.email || null,

            phone:
                tenant.contact?.phone || null,

            website:
                tenant.contact?.website || null,

            supportEmail:
                tenant.contact?.supportEmail || null,

            supportPhone:
                tenant.contact?.supportPhone || null,

            address:
                Object.freeze({

                    line1:
                        tenant.contact?.address?.line1 || null,

                    line2:
                        tenant.contact?.address?.line2 || null,

                    city:
                        tenant.contact?.address?.city || null,

                    state:
                        tenant.contact?.address?.state || null,

                    postalCode:
                        tenant.contact?.address?.postalCode || null,

                    country:
                        tenant.contact?.address?.country || null

                })

        });

    }

}


/* ============================================================================
 * Phase 3.7 — Enterprise Feature Loader
 * ============================================================================
 */

/**
 * Enterprise Feature Loader.
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 *
 * • Feature flag normalization
 * • Enabled module resolution
 * • Usage limits
 * • License capabilities
 * • Experiment assignments
 * • Runtime overrides
 *
 * This loader does not make authorization decisions. It produces an immutable
 * feature context that other layers (authorization, billing, UI, jobs, etc.)
 * can consume consistently.
 */

class TenantFeatureLoader {

    constructor(options = {}) {

        this.options = Object.freeze({

            defaultModules: options.defaultModules || [],

            defaultFlags: options.defaultFlags || {},

            defaultLimits: options.defaultLimits || {},

            defaultLicenseTier: options.defaultLicenseTier || 'starter',

            enableExperiments:
                options.enableExperiments ?? true

        });

    }

    /**
     * Build the immutable feature context.
     *
     * @param {object} tenant
     * @returns {object}
     */
    load(tenant) {

        if (!tenant) {

            throw new TenantValidationError(
                'Cannot load features without a tenant.'
            );

        }

        return Object.freeze({

            featureFlags:
                this.loadFeatureFlags(tenant),

            modules:
                this.loadModules(tenant),

            limits:
                this.loadLimits(tenant),

            licensing:
                this.loadLicensing(tenant),

            experiments:
                this.loadExperiments(tenant),

            runtime:
                this.loadRuntimeOverrides(tenant)

        });

    }

    /* =======================================================================
     * Feature Flags
     * ===================================================================== */

    loadFeatureFlags(tenant) {

        const flags = {

            ...this.options.defaultFlags,

            ...(tenant.features?.flags || {})

        };

        return Object.freeze(flags);

    }

    /* =======================================================================
     * Enabled Modules
     * ===================================================================== */

    loadModules(tenant) {

        const modules = new Set([

            ...this.options.defaultModules,

            ...(tenant.features?.modules || [])

        ]);

        return Object.freeze([...modules]);

    }

    /* =======================================================================
     * Limits
     * ===================================================================== */

    loadLimits(tenant) {

        return Object.freeze({

            users:
                tenant.limits?.users ?? null,

            groups:
                tenant.limits?.groups ?? null,

            savingsAccounts:
                tenant.limits?.savingsAccounts ?? null,

            loanAccounts:
                tenant.limits?.loanAccounts ?? null,

            apiRequestsPerMinute:
                tenant.limits?.apiRequestsPerMinute ?? null,

            storageMb:
                tenant.limits?.storageMb ?? null

        });

    }

    /* =======================================================================
     * Licensing
     * ===================================================================== */

    loadLicensing(tenant) {

        return Object.freeze({

            tier:
                tenant.license?.tier ||
                this.options.defaultLicenseTier,

            status:
                tenant.license?.status || 'active',

            expiresAt:
                tenant.license?.expiresAt || null,

            issuedAt:
                tenant.license?.issuedAt || null,

            capabilities:
                Object.freeze(

                    tenant.license?.capabilities || []

                )

        });

    }

    /* =======================================================================
     * Experiments
     * ===================================================================== */

    loadExperiments(tenant) {

        if (!this.options.enableExperiments) {

            return Object.freeze([]);

        }

        return Object.freeze(

            tenant.features?.experiments || []

        );

    }

    /* =======================================================================
     * Runtime Overrides
     * ===================================================================== */

    loadRuntimeOverrides(tenant) {

        return Object.freeze({

            maintenanceMode:
                tenant.runtime?.maintenanceMode ?? false,

            debugEnabled:
                tenant.runtime?.debugEnabled ?? false,

            betaAccess:
                tenant.runtime?.betaAccess ?? false,

            forceReadOnly:
                tenant.runtime?.forceReadOnly ?? false,

            overrides:
                Object.freeze(

                    tenant.runtime?.overrides || {}

                )

        });

    }

}


/* ============================================================================
 * Phase 3.8 — Enterprise Plan Resolver
 * ============================================================================
 */

/**
 * Enterprise SaaS Plan Resolver.
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 *
 * • Effective subscription plan resolution
 * • Usage quota normalization
 * • Billing entitlement loading
 * • Runtime limit calculation
 * • Commercial capability resolution
 *
 * This component does not perform billing operations. It only resolves the
 * tenant's effective commercial configuration into an immutable runtime object.
 */

class TenantPlanResolver {

    constructor(options = {}) {

        this.options = Object.freeze({

            defaultPlan: 'starter',

            plans: Object.freeze({

                free: {

                    users: 10,
                    apiRequestsPerMinute: 100,
                    storageMb: 512,
                    customBranding: false,
                    prioritySupport: false

                },

                starter: {

                    users: 100,
                    apiRequestsPerMinute: 1000,
                    storageMb: 5120,
                    customBranding: true,
                    prioritySupport: false

                },

                professional: {

                    users: 1000,
                    apiRequestsPerMinute: 5000,
                    storageMb: 51200,
                    customBranding: true,
                    prioritySupport: true

                },

                enterprise: {

                    users: Number.MAX_SAFE_INTEGER,
                    apiRequestsPerMinute: Number.MAX_SAFE_INTEGER,
                    storageMb: Number.MAX_SAFE_INTEGER,
                    customBranding: true,
                    prioritySupport: true

                }

            })

        });

    }

    /**
     * Resolve the tenant's effective plan.
     *
     * @param {object} tenant
     * @returns {object}
     */
    resolve(tenant) {

        if (!tenant) {

            throw new TenantValidationError(
                'Cannot resolve a plan without a tenant.'
            );

        }

        const planName =
            (tenant.subscription?.plan ||
             tenant.plan?.name ||
             this.options.defaultPlan)
                .toLowerCase();

        const basePlan =
            this.options.plans[planName] ||
            this.options.plans[this.options.defaultPlan];

        const customLimits =
            tenant.subscription?.limits ||
            tenant.plan?.limits ||
            {};

        return Object.freeze({

            name: planName,

            quotas:
                this.resolveQuotas(basePlan, customLimits),

            billing:
                this.resolveBilling(tenant),

            capabilities:
                this.resolveCapabilities(basePlan, tenant),

            custom:
                this.resolveCustomPlan(tenant)

        });

    }

    /* =======================================================================
     * Usage Quotas
     * ===================================================================== */

    resolveQuotas(basePlan, overrides) {

        return Object.freeze({

            users:
                overrides.users ??
                basePlan.users,

            apiRequestsPerMinute:
                overrides.apiRequestsPerMinute ??
                basePlan.apiRequestsPerMinute,

            storageMb:
                overrides.storageMb ??
                basePlan.storageMb

        });

    }

    /* =======================================================================
     * Billing
     * ===================================================================== */

    resolveBilling(tenant) {

        return Object.freeze({

            billingEnabled:
                tenant.billing?.enabled ?? false,

            accountId:
                tenant.billing?.accountId || null,

            customerId:
                tenant.billing?.customerId || null,

            subscriptionId:
                tenant.billing?.subscriptionId || null,

            status:
                tenant.billing?.status || 'inactive',

            renewalDate:
                tenant.billing?.renewalDate || null,

            trialEndsAt:
                tenant.billing?.trialEndsAt || null

        });

    }

    /* =======================================================================
     * Commercial Capabilities
     * ===================================================================== */

    resolveCapabilities(basePlan, tenant) {

        const customCapabilities =
            tenant.subscription?.capabilities ||
            tenant.plan?.capabilities ||
            [];

        return Object.freeze({

            customBranding:
                basePlan.customBranding,

            prioritySupport:
                basePlan.prioritySupport,

            capabilities:
                Object.freeze(customCapabilities)

        });

    }

    /* =======================================================================
     * Custom Plan
     * ===================================================================== */

    resolveCustomPlan(tenant) {

        if (!tenant.plan?.custom) {

            return null;

        }

        return Object.freeze({

            id:
                tenant.plan.id || null,

            name:
                tenant.plan.name || 'custom',

            description:
                tenant.plan.description || null,

            effectiveFrom:
                tenant.plan.effectiveFrom || null,

            effectiveUntil:
                tenant.plan.effectiveUntil || null

        });

    }

}


/* ============================================================================
 * Phase 3.9 — Enterprise Tenant Repository Orchestrator
 * ============================================================================
 */

/**
 * Enterprise Tenant Repository Orchestrator.
 *
 * Responsibilities
 * ---------------------------------------------------------------------------
 *
 * • Coordinate cache lookup
 * • Coordinate database retrieval
 * • Execute tenant validation
 * • Load metadata
 * • Load features
 * • Resolve subscription plan
 * • Produce immutable tenant context
 *
 * This is the single entry point consumed by:
 *
 * • tenantResolver.js
 * • authentication.js
 * • authorization.js
 * • tenantSecurity.js
 * • background workers
 * • payment integrations
 * • scheduled jobs
 */

class TenantRepositoryOrchestrator {


    constructor({

        repository,

        validator,

        metadataLoader,

        featureLoader,

        planResolver,

        logger,

        metrics,

        eventBus,

        traceContext

    } = {}) {


        if (!repository) {

            throw new Error(
                'Tenant repository is required.'
            );

        }


        this.repository = repository;


        this.validator =
            validator ||
            new TenantValidationEngine();


        this.metadataLoader =
            metadataLoader ||
            new TenantMetadataLoader();


        this.featureLoader =
            featureLoader ||
            new TenantFeatureLoader();


        this.planResolver =
            planResolver ||
            new TenantPlanResolver();


        this.logger = logger;

        this.metrics = metrics;

        this.eventBus = eventBus;

        this.traceContext = traceContext;


    }



    /* ========================================================================
     * Main Tenant Resolution Entry Point
     * ====================================================================== */


    async resolve({

        tenantId,

        tenantCode,

        hostname,

        apiClientId

    } = {}) {


        const startedAt =
            process.hrtime.bigint();



        try {


            /*
             * ---------------------------------------------------------------
             * 1. Cache / Repository Lookup
             * ---------------------------------------------------------------
             */


            const tenant =

                await this.lookupTenant({

                    tenantId,

                    tenantCode,

                    hostname,

                    apiClientId

                });



            /*
             * ---------------------------------------------------------------
             * 2. Lifecycle Validation
             * ---------------------------------------------------------------
             */


            const validatedTenant =

                this.validator.validate(

                    tenant

                );



            /*
             * ---------------------------------------------------------------
             * 3. Metadata Loading
             * ---------------------------------------------------------------
             */


            const metadata =

                this.metadataLoader.load(

                    validatedTenant

                );



            /*
             * ---------------------------------------------------------------
             * 4. Feature Loading
             * ---------------------------------------------------------------
             */


            const features =

                this.featureLoader.load(

                    validatedTenant

                );



            /*
             * ---------------------------------------------------------------
             * 5. Plan Resolution
             * ---------------------------------------------------------------
             */


            const plan =

                this.planResolver.resolve(

                    validatedTenant

                );



            /*
             * ---------------------------------------------------------------
             * 6. Build Immutable Tenant Context
             * ---------------------------------------------------------------
             */


            const context =

                this.buildContext({

                    tenant:

                        validatedTenant,

                    metadata,

                    features,

                    plan

                });



            await this.publishEvent(

                context

            );


            this.recordMetrics(

                startedAt,

                context

            );


            return context;


        }

        catch(error) {


            this.handleFailure(

                error

            );


            throw error;


        }


    }




    /* ========================================================================
     * Tenant Lookup Strategy
     * ====================================================================== */


    async lookupTenant({

        tenantId,

        tenantCode,

        hostname,

        apiClientId

    }) {



        if (tenantId) {


            return this.repository.findById(

                tenantId

            );


        }



        if (tenantCode) {


            return this.repository.findByCode(

                tenantCode

            );


        }



        if (hostname) {


            return this.repository.findByHostname(

                hostname

            );


        }



        if (apiClientId) {


            return this.repository.findByApiClient(

                apiClientId

            );


        }



        throw new TenantResolutionError(

            'No tenant lookup identifier supplied.'

        );


    }





    /* ========================================================================
     * Tenant Context Builder
     * ====================================================================== */


    buildContext({

        tenant,

        metadata,

        features,

        plan

    }) {


        return Object.freeze({


            tenantId:

                tenant._id?.toString(),



            code:

                tenant.code,



            status:

                tenant.status,



            tenant:



                Object.freeze({

                    id:

                        tenant._id,

                    name:

                        tenant.name,

                    createdAt:

                        tenant.createdAt,

                    updatedAt:

                        tenant.updatedAt

                }),



            metadata,


            features,


            plan,



            security:

                Object.freeze({

                    tenantIsolation:

                        true,

                    validated:

                        true

                }),



            resolvedAt:

                new Date().toISOString()


        });


    }




    /* ========================================================================
     * Observability
     * ====================================================================== */


    async publishEvent(context) {


        if (!this.eventBus) {

            return;

        }


        await this.eventBus.publish(

            'tenant.context.resolved',

            {

                tenantId:

                    context.tenantId,


                plan:

                    context.plan.name

            }

        );


    }





    recordMetrics(

        startedAt,

        context

    ) {


        if (!this.metrics) {

            return;

        }



        const duration =

            Number(

                process.hrtime.bigint()

                -

                startedAt

            )

            /

            1000000;



        this.metrics.record(

            'tenant_context_resolution_duration',

            duration,

            {

                plan:

                    context.plan.name

            }

        );


    }





    handleFailure(error) {


        this.logger?.error(

            'Tenant context resolution failed',

            {

                error:

                    error.toJSON?.() ||

                    error

            }

        );


    }


}




/* ============================================================================
 * Diagnostics
 * ========================================================================== */

function healthCheck() {

    INTERNAL_STATE.lastHealthCheck = new Date().toISOString();

    return Object.freeze({

        status: INTERNAL_STATE.status,

        initialized: INTERNAL_STATE.initialized,

        cacheEnabled: INTERNAL_STATE.cacheEnabled,

        timestamp: INTERNAL_STATE.lastHealthCheck

    });

}

function readinessCheck() {

    INTERNAL_STATE.lastReadinessCheck = new Date().toISOString();

    return Object.freeze({

        ready:

            INTERNAL_STATE.status === REPOSITORY_STATUS.READY,

        timestamp:

            INTERNAL_STATE.lastReadinessCheck

    });

}

function diagnostics() {

    return Object.freeze({

        metadata: METADATA,

        runtime: { ...INTERNAL_STATE }

    });

}

/* ============================================================================
 * Public Exports
 * ========================================================================== */

module.exports = Object.freeze({

    TenantRepository,

    resolveConfiguration,

    initializeRepositoryRuntime,

    updateLookupStatistics,

    recordCacheHit,

    recordCacheMiss,

    healthCheck,

    readinessCheck,

    diagnostics,

    metadata: METADATA,

    constants: Object.freeze({

        COMPONENT_NAME,

        COMPONENT_VERSION,

        DEFAULT_CACHE_TTL_MS,

        DEFAULT_QUERY_TIMEOUT_MS,

        DEFAULT_CACHE_NAMESPACE,

        DEFAULT_PLAN,

        REPOSITORY_STATUS,

        TENANT_STATUS

    }),

    dependencies: Object.freeze({

        ConfigurationProvider,

        LoggerFactory,

        StructuredLogger,

        MetricsRegistry,

        RequestMetrics,

        TraceContext,

        EventBus,

        AuditService,

        TenantModel,

        mongoose

    })

});