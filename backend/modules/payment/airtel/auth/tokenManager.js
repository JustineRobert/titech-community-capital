'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Token Manager
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/tokenManager.js
 *
 * Purpose
 * -------
 * Centralized enterprise OAuth token lifecycle management for Airtel Money.
 *
 * Responsibilities
 * ----------------
 * • Airtel OAuth token storage
 * • Tenant-isolated token storage
 * • Credential-version binding
 * • Environment-aware token isolation
 * • Token expiration tracking
 * • Refresh-window management
 * • Atomic token replacement
 * • Cache invalidation
 * • Distributed cache compatibility
 * • Local memory fallback
 * • Token validation
 * • Token health monitoring
 * • Runtime statistics
 * • Safe diagnostics
 * • Metrics
 * • Structured logging
 * • Correlation propagation
 * • Concurrent access coordination
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • OAuth authentication
 * • HTTP transport
 * • Credential resolution
 * • Payment processing
 * • Collections
 * • Disbursements
 * • Credential rotation
 *
 * Security
 * --------
 * Access tokens are NEVER included in:
 *
 *   • logs
 *   • metrics
 *   • audit metadata
 *   • snapshots
 *   • health responses
 *   • statistics
 *   • error messages
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    TOKEN_PROVIDER,
    PROVIDER,
    TOKEN,
    CACHE,
    OAUTH,
    HTTP,
    buildTokenCacheKey,
    buildTokenLockKey,
    calculateTokenTtlSeconds,
    calculateExpiresAt,
    isTokenUsable,
    isSuccessfulTokenResponse,
    normalizeTokenType,
} = (() => {

    /**
     * ------------------------------------------------------------------------
     * Resolve authConstants defensively.
     *
     * This keeps the manager compatible with the enhanced constants module
     * while allowing the module to fail clearly if a deployment accidentally
     * provides an incomplete constants implementation.
     * ------------------------------------------------------------------------
     */

    const constants =
        require('./authConstants');

    return {

        ...constants,

        TOKEN_PROVIDER:
            constants.PROVIDER?.CODE ||
            'AIRTEL_MONEY',

    };

})();

/**
 * ============================================================================
 * Internal provider identity
 * ============================================================================
 */

const PROVIDER_CODE =
    PROVIDER?.CODE ||
    'AIRTEL_MONEY';

const PROVIDER_NAME =
    PROVIDER?.NAME ||
    'airtel';

const DEFAULT_REFRESH_BUFFER_SECONDS =
    TOKEN?.SKEW_SECONDS ??
    60;

const DEFAULT_MIN_VALIDITY_SECONDS =
    TOKEN?.MIN_VALIDITY_SECONDS ??
    30;

const DEFAULT_TOKEN_TTL_SECONDS =
    TOKEN?.DEFAULT_TTL_SECONDS ??
    3600;

const DEFAULT_MAX_TOKEN_TTL_SECONDS =
    TOKEN?.MAX_CACHE_TTL_SECONDS ??
    24 * 60 * 60;

const DEFAULT_MEMORY_CACHE_MAX_ENTRIES =
    10000;

const DEFAULT_MAX_TENANT_ID_LENGTH =
    128;

const DEFAULT_LOCK_WAIT_MS =
    CACHE?.LOCK_WAIT_MS ??
    100;

const DEFAULT_LOCK_MAX_WAIT_MS =
    CACHE?.LOCK_MAX_WAIT_MS ??
    5000;

/**
 * ============================================================================
 * Utility helpers
 * ============================================================================
 */

const normalizeTenantId = (
    tenantId
) => {

    if (
        tenantId === undefined ||
        tenantId === null
    ) {

        throw new Error(
            'tenantId required'
        );

    }

    const normalized =
        String(
            tenantId
        ).trim();

    if (!normalized) {

        throw new Error(
            'tenantId required'
        );

    }

    if (
        normalized.length >
        DEFAULT_MAX_TENANT_ID_LENGTH
    ) {

        throw new Error(
            'Invalid tenantId'
        );

    }

    if (
        /[\r\n\t]/.test(
            normalized
        )
    ) {

        throw new Error(
            'Invalid tenantId'
        );

    }

    return normalized;

};

const toFinitePositiveNumber = (
    value,
    fallback
) => {

    const number =
        Number(value);

    if (
        !Number.isFinite(number) ||
        number <= 0
    ) {

        return fallback;

    }

    return number;

};

const safeDate = (
    value
) => {

    if (
        value instanceof Date
    ) {

        const time =
            value.getTime();

        return Number.isFinite(time)
            ? new Date(time)
            : null;

    }

    const date =
        new Date(value);

    return Number.isFinite(
        date.getTime()
    )
        ? date
        : null;

};

const safeClone = (
    value
) => {

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return value;

    }

    return {
        ...value
    };

};

/**
 * ============================================================================
 * Token Manager
 * ============================================================================
 */

class TokenManager {

    constructor({

        cache = null,

        refreshBufferSeconds =
            DEFAULT_REFRESH_BUFFER_SECONDS,

        logger,

        metrics,

        tracer,

        clock = Date,

        maxMemoryEntries =
            DEFAULT_MEMORY_CACHE_MAX_ENTRIES,

        environment =
            PROVIDER?.ENVIRONMENT,

        country =
            PROVIDER?.COUNTRY,

        currency =
            PROVIDER?.CURRENCY

    } = {}) {

        this.cache =
            cache;

        const refreshSeconds =
            Number(
                refreshBufferSeconds
            );

        this.refreshBufferMs =
            Number.isFinite(
                refreshSeconds
            )
                ? Math.max(
                    0,
                    refreshSeconds * 1000
                )
                : DEFAULT_REFRESH_BUFFER_SECONDS *
                    1000;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.clock =
            clock;

        this.environment =
            environment;

        this.country =
            country;

        this.currency =
            currency;

        this.maxMemoryEntries =
            Math.max(
                1,
                Number(
                    maxMemoryEntries
                ) ||
                DEFAULT_MEMORY_CACHE_MAX_ENTRIES
            );

        /**
         * ---------------------------------------------------------------------
         * Local fallback cache.
         *
         * tenantId -> immutable token record
         * ---------------------------------------------------------------------
         */

        this.memoryCache =
            new Map();

        /**
         * ---------------------------------------------------------------------
         * Per-tenant replacement locks.
         *
         * Used to prevent simultaneous token replacement operations from
         * overwriting each other.
         * ---------------------------------------------------------------------
         */

        this.locks =
            new Map();

        /**
         * ---------------------------------------------------------------------
         * Statistics.
         * ---------------------------------------------------------------------
         */

        this.statistics = {

            hits: 0,

            misses: 0,

            stores: 0,

            replacements: 0,

            removals: 0,

            expirations: 0,

            refreshes: 0,

            invalidTokens: 0,

            distributedCacheHits: 0,

            distributedCacheMisses: 0,

            distributedCacheFailures: 0,

            memoryFallbackHits: 0,

            memoryFallbackWrites: 0,

            lockContentions: 0,

            lockTimeouts: 0

        };

    }

    /**
     * =========================================================================
     * Store Access Token
     * =========================================================================
     */

    async store({

        tenantId,

        token,

        correlationId =
            crypto.randomUUID(),

        credentialVersion = null

    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const span =
            this.tracer?.startSpan?.(
                'airtel.token.store'
            );

        try {

            const record =
                this.createTokenRecord({

                    tenantId:
                        normalizedTenantId,

                    token,

                    correlationId,

                    credentialVersion

                });

            await this.write(

                normalizedTenantId,

                record

            );

            this.statistics.stores++;

            this.metrics?.counter?.(
                'payment_airtel_token_store_total'
            );

            this.logger?.debug?.({

                message:
                    'Airtel OAuth token stored',

                provider:
                    PROVIDER_CODE,

                tenantId:
                    normalizedTenantId,

                correlationId,

                credentialVersion,

                expiresAt:
                    record.expiresAt,

                tokenFingerprint:
                    record.tokenFingerprint

            });

            return record;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * =========================================================================
     * Create Immutable Token Record
     * =========================================================================
     */

    createTokenRecord({

        tenantId,

        token,

        correlationId,

        credentialVersion

    }) {

        if (
            !token ||
            typeof token !== 'object'
        ) {

            this.statistics.invalidTokens++;

            throw new Error(
                'Airtel token response is invalid'
            );

        }

        const accessToken =
            String(

                token.accessToken ??
                token.access_token ??
                ''

            ).trim();

        if (!accessToken) {

            this.statistics.invalidTokens++;

            throw new Error(
                'Airtel access token is missing'
            );

        }

        const rawExpiresIn =
            token.expiresIn ??
            token.expires_in ??
            DEFAULT_TOKEN_TTL_SECONDS;

        const expiresIn =
            toFinitePositiveNumber(

                rawExpiresIn,

                DEFAULT_TOKEN_TTL_SECONDS

            );

        const boundedExpiresIn =
            Math.min(

                expiresIn,

                DEFAULT_MAX_TOKEN_TTL_SECONDS

            );

        const now =
            new this.clock();

        const expiresAt =
            calculateExpiresAt
                ? calculateExpiresAt(
                    boundedExpiresIn,
                    now.getTime()
                )
                : new Date(
                    now.getTime() +
                    boundedExpiresIn *
                    1000
                );

        if (!expiresAt) {

            this.statistics.invalidTokens++;

            throw new Error(
                'Airtel token expiration is invalid'
            );

        }

        const tokenType =
            normalizeTokenType
                ? normalizeTokenType(
                    token.tokenType ??
                    token.token_type ??
                    OAUTH?.TOKEN_TYPE ??
                    'Bearer'
                )
                : 'Bearer';

        /**
         * Token fingerprint allows diagnostics to determine whether the
         * cached token changed without exposing the actual token.
         */

        const tokenFingerprint =
            crypto
                .createHash('sha256')
                .update(
                    accessToken,
                    'utf8'
                )
                .digest('hex')
                .substring(
                    0,
                    32
                );

        /**
         * Never store refresh tokens in this manager unless explicitly
         * required by a future Airtel authentication flow.
         */

        const record = {

            tenantId,

            provider:
                PROVIDER_CODE,

            providerName:
                PROVIDER_NAME,

            environment:
                this.environment,

            country:
                this.country,

            currency:
                this.currency,

            accessToken,

            tokenType,

            expiresIn:
                boundedExpiresIn,

            createdAt:
                now,

            expiresAt,

            correlationId,

            credentialVersion,

            tokenFingerprint

        };

        /**
         * Make the record immutable.
         */

        return Object.freeze(
            record
        );

    }

    /**
     * =========================================================================
     * Retrieve Token
     * =========================================================================
     */

    async get({

        tenantId

    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const token =
            await this.read(
                normalizedTenantId
            );

        if (!token) {

            this.statistics.misses++;

            this.metrics?.counter?.(
                'payment_airtel_token_cache_miss_total'
            );

            return null;

        }

        if (
            !this.isValidToken(
                token
            )
        ) {

            this.statistics.expirations++;

            await this.remove({

                tenantId:
                    normalizedTenantId

            });

            this.metrics?.counter?.(
                'payment_airtel_token_expired_total'
            );

            return null;

        }

        this.statistics.hits++;

        this.metrics?.counter?.(
            'payment_airtel_token_cache_hit_total'
        );

        return token;

    }

    /**
     * =========================================================================
     * Replace Existing Token
     * =========================================================================
     */

    async replace({

        tenantId,

        token,

        correlationId =
            crypto.randomUUID(),

        credentialVersion = null

    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        this.statistics.replacements++;

        this.statistics.refreshes++;

        return this.withLock(

            normalizedTenantId,

            async () => {

                const record =
                    await this.store({

                        tenantId:
                            normalizedTenantId,

                        token,

                        correlationId,

                        credentialVersion

                    });

                this.metrics?.counter?.(
                    'payment_airtel_token_replace_total'
                );

                return record;

            }

        );

    }

    /**
     * =========================================================================
     * Remove Token
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

        let removed =
            false;

        const cacheKey =
            this.key(
                normalizedTenantId
            );

        /**
         * Distributed cache.
         */

        if (
            this.cache &&
            typeof this.cache.delete ===
            'function'
        ) {

            try {

                const result =
                    await this.cache.delete(
                        cacheKey
                    );

                removed =
                    result === true ||
                    Boolean(result);

            }

            catch (error) {

                this.statistics
                    .distributedCacheFailures++;

                this.metrics?.counter?.(
                    'payment_airtel_token_distributed_cache_error_total'
                );

                this.logger?.warn?.({

                    message:
                        'Airtel distributed token cache removal failed; continuing with local cache invalidation',

                    provider:
                        PROVIDER_CODE,

                    tenantId:
                        normalizedTenantId,

                    correlationId,

                    error:
                        this.safeError(
                            error
                        )

                });

            }

        }

        /**
         * Local cache.
         */

        if (
            this.memoryCache.delete(
                normalizedTenantId
            )
        ) {

            removed = true;

        }

        if (removed) {

            this.statistics.removals++;

            this.metrics?.counter?.(
                'payment_airtel_token_removed_total'
            );

        }

        return removed;

    }

    /**
     * =========================================================================
     * Invalidate
     * =========================================================================
     */

    async invalidate({

        tenantId,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        return this.remove({

            tenantId,

            correlationId

        });

    }

    /**
     * =========================================================================
     * Expiration Checks
     * =========================================================================
     */

    isExpired(
        token
    ) {

        if (!token) {

            return true;

        }

        const expiresAt =
            safeDate(
                token.expiresAt
            );

        if (!expiresAt) {

            return true;

        }

        return (
            this.now() >=
            expiresAt.getTime()
        );

    }

    /**
     * =========================================================================
     * Expiring Soon
     * =========================================================================
     */

    isExpiringSoon(
        token
    ) {

        if (!token) {

            return true;

        }

        const expiresAt =
            safeDate(
                token.expiresAt
            );

        if (!expiresAt) {

            return true;

        }

        const refreshPoint =
            expiresAt.getTime() -
            this.refreshBufferMs;

        return (
            this.now() >=
            refreshPoint
        );

    }

    /**
     * =========================================================================
     * Usability Check
     * =========================================================================
     */

    isUsable(
        token,
        minimumValiditySeconds =
            DEFAULT_MIN_VALIDITY_SECONDS
    ) {

        if (!token) {

            return false;

        }

        const expiresAt =
            safeDate(
                token.expiresAt
            );

        if (!expiresAt) {

            return false;

        }

        if (
            typeof isTokenUsable ===
            'function'
        ) {

            return isTokenUsable({

                expiresAt,

                nowMs:
                    this.now(),

                minimumValiditySeconds

            });

        }

        return (

            expiresAt.getTime() -
            this.now()

        ) >

            Number(
                minimumValiditySeconds
            ) *
            1000;

    }

    /**
     * =========================================================================
     * Full Token Validity
     * =========================================================================
     */

    isValidToken(
        token
    ) {

        if (!token) {

            return false;

        }

        if (
            typeof token.accessToken !==
            'string' ||
            !token.accessToken.trim()
        ) {

            return false;

        }

        if (
            this.isExpired(
                token
            )
        ) {

            return false;

        }

        return this.isUsable(
            token,
            0
        );

    }

    /**
     * =========================================================================
     * Authorization Header
     * =========================================================================
     */

    getAuthorizationHeader(
        token
    ) {

        if (
            !this.isUsable(
                token
            )
        ) {

            return null;

        }

        const tokenType =
            normalizeTokenType
                ? normalizeTokenType(
                    token.tokenType
                )
                : (
                    token.tokenType ||
                    'Bearer'
                );

        return `${tokenType} ${token.accessToken}`;

    }

    /**
     * =========================================================================
     * Cache Write
     * =========================================================================
     */

    async write(
        tenantId,
        value
    ) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const cacheKey =
            this.key(
                normalizedTenantId
            );

        const ttlSeconds =
            calculateTokenTtlSeconds
                ? calculateTokenTtlSeconds(
                    value.expiresIn
                )
                : Math.max(
                    1,
                    Math.floor(
                        value.expiresIn
                    )
                );

        /**
         * Distributed cache.
         */

        if (
            this.cache &&
            typeof this.cache.set ===
            'function'
        ) {

            try {

                await this.writeDistributed(
                    cacheKey,
                    value,
                    ttlSeconds
                );

            }

            catch (error) {

                this.statistics
                    .distributedCacheFailures++;

                this.metrics?.counter?.(
                    'payment_airtel_token_distributed_cache_write_error_total'
                );

                this.logger?.warn?.({

                    message:
                        'Airtel distributed token cache write failed; using memory fallback',

                    provider:
                        PROVIDER_CODE,

                    tenantId:
                        normalizedTenantId,

                    error:
                        this.safeError(
                            error
                        )

                });

            }

        }

        /**
         * Always maintain local fallback.
         */

        this.enforceMemoryCacheLimit();

        this.memoryCache.set(

            normalizedTenantId,

            value

        );

        this.statistics
            .memoryFallbackWrites++;

    }

    /**
     * =========================================================================
     * Distributed Cache Write Adapter
     * =========================================================================
     *
     * Supports common cache APIs:
     *
     *   cache.set(key, value, ttl)
     *   cache.set(key, value, { ttl })
     * =========================================================================
     */

    async writeDistributed(
        key,
        value,
        ttlSeconds
    ) {

        /**
         * Most existing project cache implementations use:
         *
         *   set(key, value, ttl)
         *
         * Keep that as the primary contract.
         */

        await this.cache.set(

            key,

            value,

            ttlSeconds

        );

    }

    /**
     * =========================================================================
     * Cache Read
     * =========================================================================
     */

    async read(
        tenantId
    ) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const cacheKey =
            this.key(
                normalizedTenantId
            );

        /**
         * Distributed cache first.
         */

        if (
            this.cache &&
            typeof this.cache.get ===
            'function'
        ) {

            try {

                const cached =
                    await this.cache.get(
                        cacheKey
                    );

                if (cached) {

                    this.statistics
                        .distributedCacheHits++;

                    /**
                     * Validate distributed cache data before trusting it.
                     */

                    if (
                        this.isValidToken(
                            cached
                        )
                    ) {

                        this.memoryCache.set(

                            normalizedTenantId,

                            Object.freeze(
                                safeClone(
                                    cached
                                )
                            )

                        );

                        return cached;

                    }

                    /**
                     * Remove malformed/stale distributed token.
                     */

                    this.statistics
                        .distributedCacheMisses++;

                }

                else {

                    this.statistics
                        .distributedCacheMisses++;

                }

            }

            catch (error) {

                this.statistics
                    .distributedCacheFailures++;

                this.metrics?.counter?.(
                    'payment_airtel_token_distributed_cache_error_total'
                );

                this.logger?.warn?.({

                    message:
                        'Airtel distributed token cache read failed; using memory fallback',

                    provider:
                        PROVIDER_CODE,

                    tenantId:
                        normalizedTenantId,

                    error:
                        this.safeError(
                            error
                        )

                });

            }

        }

        /**
         * Local fallback.
         */

        const memoryToken =
            this.memoryCache.get(
                normalizedTenantId
            );

        if (memoryToken) {

            this.statistics
                .memoryFallbackHits++;

            return memoryToken;

        }

        return null;

    }

    /**
     * =========================================================================
     * Clear Cache
     * =========================================================================
     */

    async clear({

        correlationId =
            crypto.randomUUID()

    } = {}) {

        const tenantIds =
            [
                ...this.memoryCache.keys()
            ];

        /**
         * Remove known distributed entries first.
         *
         * We intentionally only attempt keys known locally because generic
         * cache interfaces do not safely expose namespace-wide deletion.
         */

        for (
            const tenantId of tenantIds
        ) {

            try {

                await this.remove({

                    tenantId,

                    correlationId

                });

            }

            catch (error) {

                this.logger?.warn?.({

                    message:
                        'Airtel token cache clear failed for tenant',

                    provider:
                        PROVIDER_CODE,

                    tenantId,

                    correlationId,

                    error:
                        this.safeError(
                            error
                        )

                });

            }

        }

        this.memoryCache.clear();

        this.metrics?.counter?.(
            'payment_airtel_token_cache_cleared_total'
        );

        return true;

    }

    /**
     * =========================================================================
     * Cache Key
     * =========================================================================
     *
     * Uses authConstants.js as the canonical cache-key generator.
     *
     * Example:
     *
     * airtel:payment:auth:v1:UG:UGX:production
     *
     * Tenant identity is appended to guarantee tenant isolation.
     * =========================================================================
     */

    key(
        tenantId
    ) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        let baseKey;

        if (
            typeof buildTokenCacheKey ===
            'function'
        ) {

            baseKey =
                buildTokenCacheKey({

                    country:
                        this.country,

                    currency:
                        this.currency,

                    environment:
                        this.environment

                });

        }

        else {

            baseKey = [

                'airtel',

                'payment',

                'auth',

                'v1',

                this.country,

                this.currency,

                this.environment

            ].join(':');

        }

        return [

            baseKey,

            'tenant',

            encodeURIComponent(
                normalizedTenantId
            )

        ].join(':');

    }

    /**
     * =========================================================================
     * Lock Key
     * =========================================================================
     */

    lockKey(
        tenantId
    ) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        if (
            typeof buildTokenLockKey ===
            'function'
        ) {

            return [

                buildTokenLockKey({

                    country:
                        this.country,

                    currency:
                        this.currency,

                    environment:
                        this.environment

                }),

                'tenant',

                encodeURIComponent(
                    normalizedTenantId
                )

            ].join(':');

        }

        return `${this.key(
            normalizedTenantId
        )}:lock`;

    }

    /**
     * =========================================================================
     * Distributed Lock / Concurrency Guard
     * =========================================================================
     *
     * The local lock prevents duplicate refreshes inside one Node.js process.
     *
     * A distributed cache lock should be supplied by the higher-level refresh
     * manager when multiple application instances are involved.
     * =========================================================================
     */

    async withLock(
        tenantId,
        operation
    ) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const existing =
            this.locks.get(
                normalizedTenantId
            );

        if (existing) {

            this.statistics
                .lockContentions++;

            this.metrics?.counter?.(
                'payment_airtel_token_lock_contention_total'
            );

            return existing;

        }

        const promise =
            Promise.resolve()
                .then(
                    operation
                );

        this.locks.set(

            normalizedTenantId,

            promise

        );

        try {

            return await promise;

        }

        finally {

            if (
                this.locks.get(
                    normalizedTenantId
                ) === promise
            ) {

                this.locks.delete(
                    normalizedTenantId
                );

            }

        }

    }

    /**
     * =========================================================================
     * Wait For Refresh
     * =========================================================================
     *
     * Useful to callers that want to wait briefly for another request to
     * populate a token rather than immediately authenticating again.
     * =========================================================================
     */

    async waitForToken({

        tenantId,

        timeoutMs =
            DEFAULT_LOCK_MAX_WAIT_MS,

        intervalMs =
            DEFAULT_LOCK_WAIT_MS

    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const started =
            this.now();

        while (
            this.now() -
            started <
            timeoutMs
        ) {

            const token =
                await this.get({

                    tenantId:
                        normalizedTenantId

                });

            if (token) {

                return token;

            }

            await this.sleep(
                intervalMs
            );

        }

        this.statistics
            .lockTimeouts++;

        this.metrics?.counter?.(
            'payment_airtel_token_wait_timeout_total'
        );

        return null;

    }

    /**
     * =========================================================================
     * Memory Cache Protection
     * =========================================================================
     */

    enforceMemoryCacheLimit() {

        if (
            this.memoryCache.size <
            this.maxMemoryEntries
        ) {

            return;

        }

        const firstKey =
            this.memoryCache
                .keys()
                .next()
                .value;

        if (
            firstKey !== undefined
        ) {

            this.memoryCache.delete(
                firstKey
            );

        }

        this.metrics?.counter?.(
            'payment_airtel_token_memory_cache_eviction_total'
        );

    }

    /**
     * =========================================================================
     * Current Time
     * =========================================================================
     */

    now() {

        const date =
            new this.clock();

        return date.getTime();

    }

    /**
     * =========================================================================
     * Sleep
     * =========================================================================
     */

    sleep(
        milliseconds
    ) {

        return new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    Math.max(
                        0,
                        milliseconds
                    )
                )
        );

    }

    /**
     * =========================================================================
     * Statistics
     * =========================================================================
     */

    stats() {

        return {

            ...this.statistics,

            cachedTokens:
                this.memoryCache.size,

            activeLocks:
                this.locks.size,

            refreshBufferMs:
                this.refreshBufferMs,

            environment:
                this.environment,

            country:
                this.country,

            currency:
                this.currency,

            maxMemoryEntries:
                this.maxMemoryEntries

        };

    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    health() {

        let distributedCache =
            'NOT_CONFIGURED';

        if (
            this.cache
        ) {

            distributedCache =
                'AVAILABLE';

        }

        return {

            provider:
                PROVIDER_CODE,

            providerName:
                PROVIDER_NAME,

            status:
                'UP',

            distributedCache,

            memoryCache:
                'AVAILABLE',

            cachedTokens:
                this.memoryCache.size,

            activeLocks:
                this.locks.size,

            environment:
                this.environment,

            country:
                this.country,

            currency:
                this.currency,

            statistics:
                this.stats()

        };

    }

    /**
     * =========================================================================
     * Safe Snapshot
     * =========================================================================
     *
     * NEVER return accessToken.
     * =========================================================================
     */

    snapshot() {

        return Array

            .from(
                this.memoryCache.values()
            )

            .map(
                token => ({

                    tenantId:
                        token.tenantId,

                    provider:
                        token.provider,

                    providerName:
                        token.providerName,

                    environment:
                        token.environment,

                    country:
                        token.country,

                    currency:
                        token.currency,

                    tokenType:
                        token.tokenType,

                    expiresIn:
                        token.expiresIn,

                    expiresAt:
                        token.expiresAt,

                    createdAt:
                        token.createdAt,

                    credentialVersion:
                        token.credentialVersion,

                    tokenFingerprint:
                        token.tokenFingerprint

                })
            );

    }

    /**
     * =========================================================================
     * Safe Error
     * =========================================================================
     */

    safeError(
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
                String(
                    error.message ||
                    'Unknown error'
                )
                .substring(
                    0,
                    512
                )

        };

    }

    /**
     * =========================================================================
     * Destroy
     * =========================================================================
     */

    async destroy({

        correlationId =
            crypto.randomUUID()

    } = {}) {

        await this.clear({

            correlationId

        });

        this.locks.clear();

        this.logger?.info?.({

            message:
                'Airtel token manager destroyed',

            provider:
                PROVIDER_CODE,

            correlationId

        });

        return true;

    }

}


/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    TokenManager;