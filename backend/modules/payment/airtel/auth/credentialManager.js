'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Credential Manager
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/credentialManager.js
 *
 * Purpose
 * -------
 * Enterprise credential lifecycle management for Airtel Money authentication.
 *
 * Responsibilities
 * ----------------
 * • Multi-tenant credential resolution
 * • Runtime credential overrides
 * • Secret-provider integration
 * • Configuration fallback
 * • Environment fallback
 * • Credential validation
 * • Secret-safe fingerprinting
 * • Credential versioning
 * • Runtime credential rotation
 * • Cache lifecycle management
 * • Cache invalidation
 * • Concurrent resolution protection
 * • Health reporting
 * • Metrics
 * • Audit events
 * • Diagnostics
 * • Correlation ID propagation
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • OAuth token acquisition
 * • Token caching
 * • HTTP transport
 * • Payment execution
 * • Payment callbacks
 * • Secret persistence
 *
 * SECURITY
 * --------
 * NEVER expose clientSecret through:
 *
 *   logs
 *   metrics
 *   audit metadata
 *   snapshots
 *   health responses
 *   thrown errors
 *
 * Runtime credentials are held in memory only.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    AuthenticationError
} = require('../../../shared/errors');

const PROVIDER = 'AIRTEL';

const DEFAULT_CACHE_TTL = 300000;

const DEFAULT_CACHE_TTL_MIN = 1000;

const DEFAULT_CACHE_TTL_MAX =
    24 * 60 * 60 * 1000;

const DEFAULT_MAX_TENANT_ID_LENGTH = 128;

const DEFAULT_MAX_CREDENTIAL_VERSION_LENGTH = 128;

/**
 * ============================================================================
 * Safe helpers
 * ============================================================================
 */

const normalizeString = (
    value,
    fallback = ''
) => {

    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    return String(value).trim();

};

const normalizeTenantId = (
    tenantId
) => {

    const value =
        normalizeString(tenantId);

    if (!value) {

        return 'default';

    }

    if (
        value.length >
        DEFAULT_MAX_TENANT_ID_LENGTH
    ) {

        throw new AuthenticationError(
            'Invalid Airtel tenant identifier'
        );

    }

    /**
     * Prevent tenant IDs from becoming ambiguous cache/audit identifiers.
     */
    if (
        /[\r\n\t]/.test(value)
    ) {

        throw new AuthenticationError(
            'Invalid Airtel tenant identifier'
        );

    }

    return value;

};

const safeCredentialVersion = (
    value
) => {

    const version =
        normalizeString(value);

    if (!version) {

        return null;

    }

    if (
        version.length >
        DEFAULT_MAX_CREDENTIAL_VERSION_LENGTH
    ) {

        throw new AuthenticationError(
            'Invalid Airtel credential version'
        );

    }

    if (
        /[\r\n\t]/.test(version)
    ) {

        throw new AuthenticationError(
            'Invalid Airtel credential version'
        );

    }

    return version;

};

const cloneCredentials = (
    credentials
) => {

    if (
        !credentials ||
        typeof credentials !== 'object'
    ) {

        return {};

    }

    return {
        ...credentials
    };

};

const freezeCredentials = (
    credentials
) => {

    return Object.freeze(
        cloneCredentials(
            credentials
        )
    );

};

/**
 * ============================================================================
 * Credential Manager
 * ============================================================================
 */

class CredentialManager {

    constructor({

        configuration,

        secretProvider = null,

        cacheTTL =
            DEFAULT_CACHE_TTL,

        logger,

        metrics,

        tracer,

        auditService

    } = {}) {

        if (!configuration) {

            throw new Error(
                'configuration is required'
            );

        }

        this.configuration =
            configuration;

        this.secretProvider =
            secretProvider;

        const numericCacheTTL =
            Number(cacheTTL);

        this.cacheTTL =
            Number.isFinite(
                numericCacheTTL
            )
                ? Math.min(
                    DEFAULT_CACHE_TTL_MAX,
                    Math.max(
                        DEFAULT_CACHE_TTL_MIN,
                        numericCacheTTL
                    )
                )
                : DEFAULT_CACHE_TTL;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.auditService =
            auditService;

        /**
         * In-memory credential cache.
         *
         * cache:
         *
         * tenantId -> {
         *     credentials,
         *     expiresAt
         * }
         */
        this.cache =
            new Map();

        /**
         * Runtime credential overrides.
         *
         * tenantId -> credentials
         */
        this.runtimeCredentials =
            new Map();

        /**
         * Per-tenant resolution locks.
         *
         * Prevents multiple concurrent requests from repeatedly hitting
         * the secret provider/configuration source.
         */
        this.resolutionLocks =
            new Map();

        /**
         * Per-tenant credential version.
         *
         * Rotation increments this value so dependent token caches can
         * distinguish old credentials from new credentials.
         */
        this.credentialVersions =
            new Map();

        this.statistics = {

            resolutions: 0,

            cacheHits: 0,

            cacheMisses: 0,

            rotations: 0,

            validations: 0,

            failures: 0,

            secretProviderResolutions: 0,

            configurationResolutions: 0,

            environmentResolutions: 0,

            runtimeResolutions: 0,

            invalidations: 0,

            concurrentResolutionsPrevented: 0

        };

    }

    /**
     * =========================================================================
     * Resolve Credentials
     * =========================================================================
     */

    async resolve({

        tenantId,

        correlationId = crypto.randomUUID()

    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const span =
            this.tracer?.startSpan?.(
                'airtel.credentials.resolve'
            );

        const cacheKey =
            normalizedTenantId;

        this.statistics.resolutions++;

        try {

            /**
             * ---------------------------------------------------------------
             * Fast cache path
             * ---------------------------------------------------------------
             */

            const cached =
                this.cache.get(
                    cacheKey
                );

            if (
                cached &&
                cached.expiresAt >
                    Date.now()
            ) {

                this.statistics.cacheHits++;

                this.metrics?.counter?.(
                    'payment_airtel_credential_cache_hit_total'
                );

                return cached.credentials;

            }

            /**
             * Remove stale cache entry.
             */

            if (cached) {

                this.cache.delete(
                    cacheKey
                );

            }

            this.statistics.cacheMisses++;

            this.metrics?.counter?.(
                'payment_airtel_credential_cache_miss_total'
            );

            /**
             * ---------------------------------------------------------------
             * Concurrent resolution protection
             * ---------------------------------------------------------------
             */

            const existingLock =
                this.resolutionLocks.get(
                    cacheKey
                );

            if (existingLock) {

                this.statistics
                    .concurrentResolutionsPrevented++;

                this.metrics?.counter?.(
                    'payment_airtel_credential_concurrent_resolution_prevented_total'
                );

                return existingLock;

            }

            const resolutionPromise =
                this.resolveFresh({

                    tenantId:
                        normalizedTenantId,

                    correlationId

                });

            this.resolutionLocks.set(
                cacheKey,
                resolutionPromise
            );

            try {

                return await resolutionPromise;

            }

            finally {

                /**
                 * Only remove the lock belonging to this resolution.
                 */
                if (
                    this.resolutionLocks.get(
                        cacheKey
                    ) === resolutionPromise
                ) {

                    this.resolutionLocks.delete(
                        cacheKey
                    );

                }

            }

        }

        catch (error) {

            this.statistics.failures++;

            this.metrics?.counter?.(
                'payment_airtel_credential_resolution_failure_total'
            );

            this.logger?.error?.({

                message:
                    'Airtel credential resolution failed',

                provider:
                    PROVIDER,

                tenantId:
                    normalizedTenantId,

                correlationId,

                error:
                    this.sanitizeError(
                        error
                    )

            });

            throw error;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * =========================================================================
     * Fresh Credential Resolution
     * =========================================================================
     */

    async resolveFresh({

        tenantId,

        correlationId

    }) {

        let credentials;

        let source;

        /**
         * ---------------------------------------------------------------------
         * Runtime override
         * ---------------------------------------------------------------------
         */

        if (
            this.runtimeCredentials.has(
                tenantId
            )
        ) {

            credentials =
                this.runtimeCredentials.get(
                    tenantId
                );

            source =
                'runtime';

            this.statistics
                .runtimeResolutions++;

        }

        /**
         * ---------------------------------------------------------------------
         * Secret provider
         * ---------------------------------------------------------------------
         */

        else if (
            this.secretProvider &&
            typeof this.secretProvider
                .getCredentials ===
                'function'
        ) {

            credentials =
                await this.secretProvider
                    .getCredentials({

                        provider:
                            PROVIDER,

                        tenantId,

                        correlationId

                    });

            source =
                'secret-provider';

            this.statistics
                .secretProviderResolutions++;

        }

        /**
         * ---------------------------------------------------------------------
         * Configuration provider
         * ---------------------------------------------------------------------
         */

        else if (
            typeof this.configuration
                .forTenant ===
            'function'
        ) {

            const tenantConfiguration =
                await this.configuration
                    .forTenant({

                        tenantId,

                        provider:
                            PROVIDER,

                        correlationId

                    });

            credentials =
                tenantConfiguration
                    ?.credentials;

            source =
                'configuration';

            this.statistics
                .configurationResolutions++;

        }

        /**
         * ---------------------------------------------------------------------
         * Static configuration credentials
         * ---------------------------------------------------------------------
         */

        else if (
            this.configuration.credentials
        ) {

            credentials =
                this.configuration
                    .credentials;

            source =
                'configuration';

            this.statistics
                .configurationResolutions++;

        }

        /**
         * ---------------------------------------------------------------------
         * Environment fallback
         * ---------------------------------------------------------------------
         */

        else {

            credentials =
                this.resolveFromEnvironment();

            source =
                'environment';

            this.statistics
                .environmentResolutions++;

        }

        /**
         * ---------------------------------------------------------------------
         * Validate
         * ---------------------------------------------------------------------
         */

        this.validate(
            credentials
        );

        /**
         * ---------------------------------------------------------------------
         * Credential version
         * ---------------------------------------------------------------------
         */

        const version =
            this.getCredentialVersion(
                tenantId,
                credentials
            );

        /**
         * ---------------------------------------------------------------------
         * Fingerprint
         * ---------------------------------------------------------------------
         */

        const fingerprint =
            this.fingerprint(
                credentials
            );

        /**
         * ---------------------------------------------------------------------
         * Immutable credential record
         * ---------------------------------------------------------------------
         *
         * The actual secret remains in memory but is never returned by
         * diagnostics or logs.
         */

        const resolved =
            freezeCredentials({

                ...credentials,

                provider:
                    PROVIDER,

                source,

                version,

                fingerprint,

                resolvedAt:
                    new Date(),

                tenantId

            });

        /**
         * ---------------------------------------------------------------------
         * Cache
         * ---------------------------------------------------------------------
         */

        this.cache.set(

            tenantId,

            {

                credentials:
                    resolved,

                expiresAt:
                    Date.now() +
                    this.cacheTTL

            }

        );

        /**
         * ---------------------------------------------------------------------
         * Metrics
         * ---------------------------------------------------------------------
         */

        this.metrics?.counter?.(
            'payment_airtel_credential_resolved_total'
        );

        /**
         * ---------------------------------------------------------------------
         * Audit
         * ---------------------------------------------------------------------
         *
         * NEVER include credentials.
         */

        await this.auditService?.record?.({

            action:
                'AIRTEL_CREDENTIAL_RESOLVED',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            metadata: {

                source,

                credentialVersion:
                    version,

                fingerprint

            }

        });

        /**
         * ---------------------------------------------------------------------
         * Logging
         * ---------------------------------------------------------------------
         */

        this.logger?.debug?.({

            message:
                'Airtel credentials resolved',

            provider:
                PROVIDER,

            tenantId,

            correlationId,

            source,

            credentialVersion:
                version,

            fingerprint

        });

        return resolved;

    }

    /**
     * =========================================================================
     * Environment Resolution
     * =========================================================================
     */

    resolveFromEnvironment() {

        return {

            clientId:
                normalizeString(
                    process.env
                        .AIRTEL_CLIENT_ID
                ),

            clientSecret:
                normalizeString(
                    process.env
                        .AIRTEL_CLIENT_SECRET
                ),

            subscriptionKey:
                normalizeString(
                    process.env
                        .AIRTEL_SUBSCRIPTION_KEY
                ),

            country:
                normalizeString(
                    process.env
                        .AIRTEL_COUNTRY
                )
                .toUpperCase(),

            currency:
                normalizeString(
                    process.env
                        .AIRTEL_CURRENCY
                )
                .toUpperCase(),

            environment:
                normalizeString(
                    process.env
                        .AIRTEL_ENVIRONMENT
                )
                .toLowerCase()

        };

    }

    /**
     * =========================================================================
     * Validate Credentials
     * =========================================================================
     */

    validate(
        credentials = {}
    ) {

        this.statistics.validations++;

        if (
            !credentials ||
            typeof credentials !== 'object'
        ) {

            throw new AuthenticationError(
                'Airtel credentials are invalid'
            );

        }

        const clientId =
            normalizeString(
                credentials.clientId
            );

        const clientSecret =
            normalizeString(
                credentials.clientSecret
            );

        if (!clientId) {

            throw new AuthenticationError(
                'Missing Airtel client ID'
            );

        }

        if (!clientSecret) {

            throw new AuthenticationError(
                'Missing Airtel client secret'
            );

        }

        /**
         * Prevent accidental whitespace-only credential material.
         */

        if (
            clientId.length >
            512
        ) {

            throw new AuthenticationError(
                'Invalid Airtel client ID'
            );

        }

        if (
            clientSecret.length >
            4096
        ) {

            throw new AuthenticationError(
                'Invalid Airtel client secret'
            );

        }

        return true;

    }

    /**
     * =========================================================================
     * Credential Version
     * =========================================================================
     *
     * Runtime rotation increments the tenant version.
     *
     * For externally managed secrets, the fingerprint acts as a deterministic
     * credential-version identity.
     * =========================================================================
     */

    getCredentialVersion(
        tenantId,
        credentials
    ) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const explicitVersion =
            safeCredentialVersion(
                credentials
                    ?.credentialVersion
            );

        if (explicitVersion) {

            return explicitVersion;

        }

        const currentVersion =
            this.credentialVersions.get(
                normalizedTenantId
            );

        if (currentVersion) {

            return currentVersion;

        }

        return this.fingerprint(
            credentials
        );

    }

    /**
     * =========================================================================
     * Rotate Credentials
     * =========================================================================
     */

    async rotate({

        tenantId,

        credentials,

        correlationId =
            crypto.randomUUID()

    }) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        this.validate(
            credentials
        );

        /**
         * Never mutate the caller's object.
         */

        const safeCredentials =
            cloneCredentials(
                credentials
            );

        /**
         * Generate a new version.
         *
         * Random version ensures that a rotation is distinguishable even
         * when an operator accidentally reuses the same credential material.
         */

        const credentialVersion =
            crypto.randomUUID();

        safeCredentials
            .credentialVersion =
            credentialVersion;

        const immutableCredentials =
            freezeCredentials(
                safeCredentials
            );

        this.runtimeCredentials.set(

            normalizedTenantId,

            immutableCredentials

        );

        this.credentialVersions.set(

            normalizedTenantId,

            credentialVersion

        );

        /**
         * Invalidate old credential cache.
         */

        this.cache.delete(
            normalizedTenantId
        );

        this.statistics.rotations++;

        this.statistics.invalidations++;

        this.metrics?.counter?.(
            'payment_airtel_credential_rotation_total'
        );

        this.metrics?.counter?.(
            'payment_airtel_credential_cache_invalidation_total'
        );

        const fingerprint =
            this.fingerprint(
                immutableCredentials
            );

        await this.auditService?.record?.({

            action:
                'AIRTEL_CREDENTIAL_ROTATED',

            provider:
                PROVIDER,

            tenantId:
                normalizedTenantId,

            correlationId,

            metadata: {

                credentialVersion,

                fingerprint

            }

        });

        this.logger?.info?.({

            message:
                'Airtel credentials rotated',

            provider:
                PROVIDER,

            tenantId:
                normalizedTenantId,

            correlationId,

            credentialVersion,

            fingerprint

        });

        /**
         * Return the newly resolved credentials.
         *
         * This guarantees the caller receives the same immutable representation
         * stored in the runtime override.
         */

        return this.resolve({

            tenantId:
                normalizedTenantId,

            correlationId

        });

    }

    /**
     * =========================================================================
     * Remove Runtime Override
     * =========================================================================
     */

    async remove({

        tenantId,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const existed =
            this.runtimeCredentials
                .delete(
                    normalizedTenantId
                );

        this.cache.delete(
            normalizedTenantId
        );

        this.credentialVersions.delete(
            normalizedTenantId
        );

        if (existed) {

            this.statistics
                .invalidations++;

            this.metrics?.counter?.(
                'payment_airtel_credential_override_removed_total'
            );

            await this.auditService?.record?.({

                action:
                    'AIRTEL_CREDENTIAL_OVERRIDE_REMOVED',

                provider:
                    PROVIDER,

                tenantId:
                    normalizedTenantId,

                correlationId

            });

        }

        return existed;

    }

    /**
     * =========================================================================
     * Cache Management
     * =========================================================================
     */

    clearCache() {

        const size =
            this.cache.size;

        this.cache.clear();

        this.statistics
            .invalidations += size;

        this.metrics?.counter?.(
            'payment_airtel_credential_cache_cleared_total'
        );

        return size;

    }

    /**
     * =========================================================================
     * Tenant Cache Invalidation
     * =========================================================================
     */

    invalidate({

        tenantId

    } = {}) {

        if (
            tenantId !== undefined &&
            tenantId !== null
        ) {

            const normalizedTenantId =
                normalizeTenantId(
                    tenantId
                );

            const existed =
                this.cache.delete(
                    normalizedTenantId
                );

            if (existed) {

                this.statistics
                    .invalidations++;

            }

            return existed;

        }

        return this.clearCache();

    }

    /**
     * =========================================================================
     * Credential Fingerprint
     * =========================================================================
     *
     * SECURITY:
     *
     * The fingerprint is intentionally NOT reversible and is only useful for
     * equality/change detection.
     *
     * The client secret participates in the digest but is never returned.
     *
     * HMAC is preferred when an application-level secret is available.
     * This implementation uses SHA-256 to keep the manager dependency-free.
     * =========================================================================
     */

    fingerprint(
        credentials = {}
    ) {

        const clientId =
            normalizeString(
                credentials.clientId
            );

        const clientSecret =
            normalizeString(
                credentials.clientSecret
            );

        const subscriptionKey =
            normalizeString(
                credentials.subscriptionKey
            );

        const country =
            normalizeString(
                credentials.country
            )
            .toUpperCase();

        const environment =
            normalizeString(
                credentials.environment
            )
            .toLowerCase();

        return crypto

            .createHash(
                'sha256'
            )

            .update(

                [
                    clientId,
                    clientSecret,
                    subscriptionKey,
                    country,
                    environment

                ].join('|'),

                'utf8'

            )

            .digest('hex')

            .substring(
                0,
                32
            );

    }

    /**
     * =========================================================================
     * Safe Error Sanitization
     * =========================================================================
     */

    sanitizeError(
        error
    ) {

        if (!error) {

            return {

                message:
                    'Unknown error'

            };

        }

        return {

            name:
                error.name,

            code:
                error.code,

            message:
                normalizeString(
                    error.message
                )
                .substring(
                    0,
                    1024
                )

        };

    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health({

        tenantId = null,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        try {

            if (
                tenantId !== null &&
                tenantId !== undefined
            ) {

                await this.resolve({

                    tenantId,

                    correlationId

                });

            }

            return {

                status:
                    'UP',

                provider:
                    PROVIDER,

                cacheEntries:
                    this.cache.size,

                runtimeOverrides:
                    this.runtimeCredentials.size,

                activeResolutionLocks:
                    this.resolutionLocks.size,

                credentialVersions:
                    this.credentialVersions.size,

                cacheTTL:
                    this.cacheTTL,

                statistics:
                    this.safeStatistics()

            };

        }

        catch (error) {

            return {

                status:
                    'DOWN',

                provider:
                    PROVIDER,

                cacheEntries:
                    this.cache.size,

                runtimeOverrides:
                    this.runtimeCredentials.size,

                activeResolutionLocks:
                    this.resolutionLocks.size,

                error:
                    this.sanitizeError(
                        error
                    )

            };

        }

    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.safeStatistics(),

            cacheEntries:
                this.cache.size,

            runtimeOverrides:
                this.runtimeCredentials.size,

            activeResolutionLocks:
                this.resolutionLocks.size,

            credentialVersions:
                this.credentialVersions.size,

            cacheTTL:
                this.cacheTTL

        };

    }

    /**
     * =========================================================================
     * Safe Statistics
     * =========================================================================
     */

    safeStatistics() {

        return Object.freeze({

            ...this.statistics

        });

    }

    /**
     * =========================================================================
     * Diagnostic Snapshot
     * =========================================================================
     *
     * IMPORTANT:
     *
     * This intentionally DOES NOT return:
     *
     *   credentials
     *   clientSecret
     *   subscriptionKey
     *   accessToken
     *
     * =========================================================================
     */

    snapshot() {

        const tenants =
            [
                ...new Set([

                    ...this.cache.keys(),

                    ...this.runtimeCredentials.keys(),

                    ...this.credentialVersions.keys()

                ])

            ];

        return {

            provider:
                PROVIDER,

            cacheEntries:
                this.cache.size,

            runtimeOverrides:
                this.runtimeCredentials.size,

            activeResolutionLocks:
                this.resolutionLocks.size,

            credentialVersions:
                this.credentialVersions.size,

            tenants,

            statistics:
                this.safeStatistics()

        };

    }

    /**
     * =========================================================================
     * Destroy
     * =========================================================================
     *
     * Clears all in-memory credential material.
     *
     * Useful during graceful shutdown, worker restart, credential-provider
     * reinitialization, and tests.
     * =========================================================================
     */

    async destroy() {

        this.cache.clear();

        this.runtimeCredentials.clear();

        this.credentialVersions.clear();

        this.resolutionLocks.clear();

        this.logger?.info?.({

            message:
                'Airtel credential manager destroyed',

            provider:
                PROVIDER

        });

        return true;

    }

}

module.exports =
    CredentialManager;