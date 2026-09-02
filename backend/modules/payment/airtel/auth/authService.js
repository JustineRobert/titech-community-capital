'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Authentication Service
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/airtelAuthService.js
 *
 * Purpose:
 *   Enterprise orchestration layer for the complete Airtel Money OAuth
 *   authentication lifecycle.
 *
 * Responsibilities:
 *   - Authentication orchestration
 *   - Access token acquisition
 *   - Token cache coordination
 *   - Automatic token refresh
 *   - Credential resolution
 *   - Runtime credential rotation
 *   - Multi-tenant isolation
 *   - Correlation ID propagation
 *   - OpenTelemetry instrumentation
 *   - Prometheus metrics
 *   - Structured audit logging
 *   - Provider authentication health state
 *   - Authentication single-flight protection
 *   - Defensive token normalization
 *   - Safe error handling
 *
 * Explicitly NOT Responsible For:
 *   - HTTP transport implementation
 *   - Payment collections
 *   - Disbursements
 *   - Settlement
 *   - Callback processing
 *   - Payment business validation
 *
 * Security Principles:
 *   - Never log access tokens
 *   - Never log client secrets
 *   - Never return provider credentials
 *   - Never mix tenant token namespaces
 *   - Never mutate cached token objects
 *   - Never allow invalid tenant context
 *   - Normalize provider errors before propagation
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError,
    AuthenticationError
} = require('../../shared/errors');

const authConstants = require('./authConstants');

/**
 * ============================================================================
 * Local Constants
 * ============================================================================
 */

const {

    PROVIDER,

    ERROR_CODES,

    TOKEN,

    SECURITY,

    RETRY,

    CONFIG

} = authConstants;

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

/**
 * Generate a cryptographically strong correlation ID.
 *
 * crypto.randomUUID() is preferred, with a fallback for environments where
 * randomUUID is unavailable.
 */
function generateCorrelationId() {

    if (
        typeof crypto.randomUUID === 'function'
    ) {

        return crypto.randomUUID();

    }

    return crypto
        .randomBytes(16)
        .toString('hex');

}

/**
 * Validate tenant identity without imposing a project-specific tenant model.
 */
function normalizeTenantId(tenantId) {

    if (
        tenantId === undefined ||
        tenantId === null
    ) {

        throw new AuthenticationError(
            'tenantId is required',
            {
                code:
                    'AIRTEL_TENANT_ID_REQUIRED'
            }
        );

    }

    const normalized =
        String(tenantId).trim();

    if (!normalized) {

        throw new AuthenticationError(
            'tenantId cannot be empty',
            {
                code:
                    'AIRTEL_TENANT_ID_INVALID'
            }
        );

    }

    if (
        normalized.length >
        128
    ) {

        throw new AuthenticationError(
            'tenantId exceeds maximum length',
            {
                code:
                    'AIRTEL_TENANT_ID_INVALID'
            }
        );

    }

    return normalized;

}

/**
 * Correlation ID normalization.
 */
function normalizeCorrelationId(
    correlationId
) {

    if (
        correlationId === undefined ||
        correlationId === null ||
        String(correlationId).trim() === ''
    ) {

        return generateCorrelationId();

    }

    const normalized =
        String(correlationId).trim();

    if (
        normalized.length >
        SECURITY?.REQUEST?.MAX_ID_LENGTH ||
        normalized.length > 128
    ) {

        throw new AuthenticationError(
            'correlationId exceeds maximum length',
            {
                code:
                    'AIRTEL_CORRELATION_ID_INVALID'
            }
        );

    }

    return normalized;

}

/**
 * Determine whether an object resembles an Airtel access token response.
 */
function hasAccessToken(value) {

    if (
        typeof value === 'string'
    ) {

        return value.trim().length > 0;

    }

    if (
        !value ||
        typeof value !== 'object'
    ) {

        return false;

    }

    return (
        typeof value.accessToken === 'string' &&
        value.accessToken.trim().length > 0
    ) ||
    (
        typeof value.access_token === 'string' &&
        value.access_token.trim().length > 0
    );

}

/**
 * Normalize token response while preserving compatibility with existing
 * tokenManager implementations.
 *
 * IMPORTANT:
 * The returned object contains the access token because it is passed
 * internally to tokenManager. It must NEVER be logged or audited.
 */
function normalizeToken(token) {

    if (!hasAccessToken(token)) {

        throw new AuthenticationError(
            'Airtel OAuth response did not contain a valid access token',
            {
                code:
                    ERROR_CODES?.INVALID_TOKEN_RESPONSE ||
                    'AIRTEL_INVALID_TOKEN_RESPONSE'
            }
        );

    }

    if (
        typeof token === 'string'
    ) {

        return Object.freeze({

            accessToken:
                token.trim(),

            tokenType:
                TOKEN?.RESPONSE_FIELDS
                    ? 'Bearer'
                    : 'Bearer',

        });

    }

    const accessToken =
        token.accessToken ||
        token.access_token;

    const expiresIn =
        token.expiresIn ??
        token.expires_in ??
        null;

    const tokenType =
        token.tokenType ||
        token.token_type ||
        'Bearer';

    const normalized = {

        ...token,

        accessToken:
            String(accessToken).trim(),

        tokenType:
            String(tokenType).trim() ||
            'Bearer',

    };

    if (
        expiresIn !== null &&
        expiresIn !== undefined
    ) {

        const numericExpiresIn =
            Number(expiresIn);

        if (
            Number.isFinite(numericExpiresIn) &&
            numericExpiresIn > 0
        ) {

            normalized.expiresIn =
                numericExpiresIn;

            normalized.expiresAt =
                token.expiresAt ||
                authConstants.calculateExpiresAt(
                    numericExpiresIn
                );

        }

    }

    /**
     * Never persist snake_case-only token aliases unless the existing token
     * manager explicitly requires them. accessToken is the canonical internal
     * representation.
     */
    delete normalized.access_token;

    return Object.freeze(normalized);

}

/**
 * Safe authentication error representation.
 *
 * Prevents accidental credential/token leakage into logs or audit systems.
 */
function sanitizeError(error) {

    if (!error) {

        return {

            name: 'Error',

            message:
                'Unknown Airtel authentication error'

        };

    }

    const normalized =
        typeof error.toJSON === 'function'
            ? error.toJSON()
            : error;

    if (
        typeof normalized !== 'object' ||
        normalized === null
    ) {

        return {

            name:
                error.name ||
                'Error',

            message:
                String(normalized)

        };

    }

    const sanitized = {

        name:
            normalized.name ||
            error.name ||
            'Error',

        message:
            normalized.message ||
            error.message ||
            'Airtel authentication failed',

        code:
            normalized.code ||
            error.code,

        statusCode:
            normalized.statusCode ||
            error.statusCode,

        providerCode:
            normalized.providerCode ||
            error.providerCode,

    };

    /**
     * Explicitly exclude potentially sensitive fields.
     */
    for (
        const field of SECURITY?.SENSITIVE_FIELDS || []
    ) {

        delete sanitized[field];

    }

    delete sanitized.stack;
    delete sanitized.config;
    delete sanitized.request;
    delete sanitized.response;
    delete sanitized.headers;
    delete sanitized.credentials;

    return sanitized;

}

/**
 ============================================================================
 * AirtelAuthService
 * ============================================================================
 */

class AirtelAuthService {

    constructor({

        configuration,

        credentialManager,

        tokenManager,

        oauthClient,

        refreshManager,

        observability,

        auditService,

        logger,

        metrics,

        tracer,

        clock = Date

    } = {}) {

        /**
         * ---------------------------------------------------------------
         * Dependency validation
         * ---------------------------------------------------------------
         */

        if (!configuration) {

            throw new Error(
                'AirtelAuthService: configuration is required'
            );

        }

        if (!credentialManager) {

            throw new Error(
                'AirtelAuthService: credentialManager is required'
            );

        }

        if (!tokenManager) {

            throw new Error(
                'AirtelAuthService: tokenManager is required'
            );

        }

        if (!oauthClient) {

            throw new Error(
                'AirtelAuthService: oauthClient is required'
            );

        }

        /**
         * ---------------------------------------------------------------
         * Dependencies
         * ---------------------------------------------------------------
         */

        this.configuration =
            configuration;

        this.credentialManager =
            credentialManager;

        this.tokenManager =
            tokenManager;

        this.oauthClient =
            oauthClient;

        this.refreshManager =
            refreshManager || null;

        this.observability =
            observability || null;

        this.auditService =
            auditService || null;

        this.logger =
            logger || null;

        this.metrics =
            metrics || null;

        this.tracer =
            tracer || null;

        this.clock =
            clock;

        /**
         * ---------------------------------------------------------------
         * Runtime state
         * ---------------------------------------------------------------
         */

        this.startedAt =
            new this.clock();

        this.initialized =
            false;

        this.initializingPromise =
            null;

        this.healthState = {

            status: 'UNKNOWN',

            initialized: false,

            lastAuthentication: null,

            lastFailure: null,

            lastFailureCode: null,

            consecutiveFailures: 0,

            totalAuthentications: 0,

            totalFailures: 0,

            lastCorrelationId: null,

        };

        /**
         * ---------------------------------------------------------------
         * Authentication single-flight map
         * ---------------------------------------------------------------
         *
         * Prevents multiple concurrent requests for the same tenant from
         * simultaneously requesting multiple Airtel OAuth tokens.
         *
         * Key:
         *   tenantId
         *
         * Value:
         *   Promise
         */

        this.authenticationFlights =
            new Map();

        /**
         * ---------------------------------------------------------------
         * Refresh single-flight map
         * ---------------------------------------------------------------
         */

        this.refreshFlights =
            new Map();

    }

    /**
     * ========================================================================
     * Initialize Authentication Subsystem
     * ========================================================================
     */

    async initialize() {

        if (this.initialized) {

            return true;

        }

        if (this.initializingPromise) {

            return this.initializingPromise;

        }

        this.initializingPromise =
            this._initialize();

        try {

            return await this.initializingPromise;

        } finally {

            this.initializingPromise =
                null;

        }

    }

    async _initialize() {

        try {

            /**
             * Support both:
             *
             * configuration.validate()
             * configuration.validateAsync()
             */

            if (
                typeof this.configuration
                    .validateAsync === 'function'
            ) {

                await this.configuration
                    .validateAsync();

            } else if (
                typeof this.configuration
                    .validate === 'function'
            ) {

                await this.configuration
                    .validate();

            }

            /**
             * Validate static Airtel auth configuration where the enhanced
             * constants module is available.
             */

            if (
                typeof authConstants
                    .validateConfiguration === 'function'
            ) {

                const validation =
                    authConstants
                        .validateConfiguration();

                if (!validation.valid) {

                    const error =
                        new AuthenticationError(
                            'Airtel authentication configuration is invalid',
                            {
                                code:
                                    ERROR_CODES
                                        ?.PROVIDER_CONFIGURATION_ERROR ||
                                    'AIRTEL_PROVIDER_CONFIGURATION_ERROR',

                                details:
                                    validation.errors
                            }
                        );

                    throw error;

                }

            }

            this.initialized = true;

            this.healthState.initialized =
                true;

            this.healthState.status =
                'READY';

            this._incrementMetric(
                'payment_airtel_auth_initialize_total'
            );

            this._logInfo(
                'Airtel authentication initialized',
                {
                    provider:
                        PROVIDER?.CODE ||
                        'AIRTEL_MONEY',

                    environment:
                        PROVIDER?.ENVIRONMENT,

                    country:
                        PROVIDER?.COUNTRY,

                    currency:
                        PROVIDER?.CURRENCY,

                }
            );

            return true;

        } catch (error) {

            this.healthState.status =
                'DOWN';

            this.healthState.lastFailure =
                new this.clock();

            this.healthState.lastFailureCode =
                error.code;

            this._incrementMetric(
                'payment_airtel_auth_initialize_failure_total'
            );

            this._logError(
                'Airtel authentication initialization failed',
                {
                    error:
                        sanitizeError(error)
                }
            );

            throw normalizeError(error);

        }

    }

    /**
     * ========================================================================
     * Assert Initialized
     * ========================================================================
     */

    _assertInitialized() {

        if (!this.initialized) {

            throw new AuthenticationError(
                'Airtel authentication service is not initialized',
                {
                    code:
                        'AIRTEL_AUTH_SERVICE_NOT_INITIALIZED'
                }
            );

        }

    }

    /**
     * ========================================================================
     * Authenticate
     * ========================================================================
     */

    async authenticate({

        tenantId,

        correlationId

    } = {}) {

        this._assertInitialized();

        const normalizedTenantId =
            normalizeTenantId(tenantId);

        const normalizedCorrelationId =
            normalizeCorrelationId(correlationId);

        /**
         * ---------------------------------------------------------------
         * Single-flight authentication
         * ---------------------------------------------------------------
         *
         * Multiple requests arriving simultaneously for the same tenant
         * share one OAuth request.
         */

        const existingFlight =
            this.authenticationFlights.get(
                normalizedTenantId
            );

        if (existingFlight) {

            this._incrementMetric(
                'payment_airtel_auth_singleflight_join_total'
            );

            return existingFlight;

        }

        const authenticationPromise =
            this._authenticateInternal({

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId

            });

        this.authenticationFlights.set(
            normalizedTenantId,
            authenticationPromise
        );

        try {

            return await authenticationPromise;

        } finally {

            if (
                this.authenticationFlights.get(
                    normalizedTenantId
                ) === authenticationPromise
            ) {

                this.authenticationFlights.delete(
                    normalizedTenantId
                );

            }

        }

    }

    async _authenticateInternal({

        tenantId,

        correlationId

    }) {

        const startedAt =
            this.clock.now
                ? this.clock.now()
                : Date.now();

        const span =
            this._startSpan(
                'airtel.auth.authenticate',
                {
                    tenantId,
                    correlationId
                }
            );

        try {

            this.healthState.lastCorrelationId =
                correlationId;

            this.observability
                ?.authenticationStarted
                ?.({
                    tenantId,
                    correlationId,
                });

            this._incrementMetric(
                'payment_airtel_auth_attempt_total'
            );

            /**
             * -----------------------------------------------------------
             * Credential resolution
             * -----------------------------------------------------------
             */

            const credentials =
                await this.credentialManager.resolve({

                    tenantId,

                    correlationId,

                    provider:
                        PROVIDER?.NAME ||
                        'airtel',

                });

            if (!credentials) {

                throw new AuthenticationError(
                    'Airtel credentials not found',
                    {
                        code:
                            ERROR_CODES
                                ?.MISSING_CLIENT_ID ||
                            'AIRTEL_CREDENTIALS_NOT_FOUND'
                    }
                );

            }

            /**
             * -----------------------------------------------------------
             * Credential sanity validation
             * -----------------------------------------------------------
             *
             * Do not log the actual values.
             */

            if (
                !credentials.clientId &&
                !credentials.client_id
            ) {

                throw new AuthenticationError(
                    'Airtel client ID is not configured',
                    {
                        code:
                            ERROR_CODES
                                ?.MISSING_CLIENT_ID ||
                            'AIRTEL_MISSING_CLIENT_ID'
                    }
                );

            }

            if (
                !credentials.clientSecret &&
                !credentials.client_secret
            ) {

                throw new AuthenticationError(
                    'Airtel client secret is not configured',
                    {
                        code:
                            ERROR_CODES
                                ?.MISSING_CLIENT_SECRET ||
                            'AIRTEL_MISSING_CLIENT_SECRET'
                    }
                );

            }

            /**
             * -----------------------------------------------------------
             * OAuth authentication
             * -----------------------------------------------------------
             */

            const rawToken =
                await this.oauthClient.authenticate({

                    credentials,

                    tenantId,

                    correlationId,

                    provider:
                        PROVIDER?.NAME ||
                        'airtel',

                });

            const token =
                normalizeToken(rawToken);

            /**
             * -----------------------------------------------------------
             * Token persistence
             * -----------------------------------------------------------
             */

            await this.tokenManager.store({

                tenantId,

                token,

                correlationId,

                provider:
                    PROVIDER?.NAME ||
                    'airtel',

            });

            /**
             * -----------------------------------------------------------
             * Update health state
             * -----------------------------------------------------------
             */

            this.healthState.status =
                'UP';

            this.healthState.lastAuthentication =
                new this.clock();

            this.healthState.lastFailure =
                null;

            this.healthState.lastFailureCode =
                null;

            this.healthState.consecutiveFailures =
                0;

            this.healthState.totalAuthentications +=
                1;

            /**
             * -----------------------------------------------------------
             * Metrics
             * -----------------------------------------------------------
             */

            this._incrementMetric(
                'payment_airtel_auth_success_total'
            );

            this._observeMetric(
                'payment_airtel_auth_duration_ms',
                this._elapsedMilliseconds(
                    startedAt
                )
            );

            /**
             * -----------------------------------------------------------
             * Audit
             * -----------------------------------------------------------
             *
             * NEVER include token or credentials.
             */

            await this.auditService
                ?.record
                ?.({

                    action:
                        'AIRTEL_AUTH_SUCCESS',

                    provider:
                        PROVIDER?.CODE ||
                        'AIRTEL_MONEY',

                    tenantId,

                    correlationId,

                    environment:
                        PROVIDER?.ENVIRONMENT,

                });

            this._logInfo(
                'Airtel authentication successful',
                {
                    provider:
                        PROVIDER?.CODE ||
                        'AIRTEL_MONEY',

                    tenantId,

                    correlationId,

                    durationMs:
                        this._elapsedMilliseconds(
                            startedAt
                        )
                }
            );

            this.observability
                ?.authenticationSucceeded
                ?.({

                    tenantId,

                    correlationId,

                    durationMs:
                        this._elapsedMilliseconds(
                            startedAt
                        )

                });

            /**
             * Return canonical token representation.
             */
            return token;

        } catch (error) {

            const normalizedError =
                normalizeError(error);

            const safeError =
                sanitizeError(normalizedError);

            this.healthState.status =
                'DOWN';

            this.healthState.lastFailure =
                new this.clock();

            this.healthState.lastFailureCode =
                normalizedError.code;

            this.healthState.consecutiveFailures +=
                1;

            this.healthState.totalFailures +=
                1;

            this._incrementMetric(
                'payment_airtel_auth_failure_total'
            );

            this._observeMetric(
                'payment_airtel_auth_duration_ms',
                this._elapsedMilliseconds(
                    startedAt
                )
            );

            this._incrementMetricWithLabels?.(
                'payment_airtel_auth_failure_by_code_total',
                {
                    code:
                        normalizedError.code ||
                        'UNKNOWN'
                }
            );

            this.observability
                ?.authenticationFailed
                ?.({

                    tenantId,

                    correlationId,

                    error:
                        safeError,

                    durationMs:
                        this._elapsedMilliseconds(
                            startedAt
                        )

                });

            await this.auditService
                ?.record
                ?.({

                    action:
                        'AIRTEL_AUTH_FAILURE',

                    provider:
                        PROVIDER?.CODE ||
                        'AIRTEL_MONEY',

                    tenantId,

                    correlationId,

                    errorCode:
                        normalizedError.code,

                    environment:
                        PROVIDER?.ENVIRONMENT,

                })
                .catch?.(() => {});

            this._logError(
                'Airtel authentication failed',
                {
                    tenantId,

                    correlationId,

                    error:
                        safeError,

                    durationMs:
                        this._elapsedMilliseconds(
                            startedAt
                        )
                }
            );

            throw normalizedError;

        } finally {

            span?.end?.();

        }

    }

    /**
     * ========================================================================
     * Retrieve Valid Access Token
     * ========================================================================
     */

    async getAccessToken({

        tenantId,

        correlationId

    } = {}) {

        this._assertInitialized();

        const normalizedTenantId =
            normalizeTenantId(tenantId);

        const normalizedCorrelationId =
            normalizeCorrelationId(correlationId);

        let cached;

        try {

            cached =
                await this.tokenManager.get({

                    tenantId:
                        normalizedTenantId,

                    correlationId:
                        normalizedCorrelationId,

                    provider:
                        PROVIDER?.NAME ||
                        'airtel',

                });

        } catch (error) {

            this._incrementMetric(
                'payment_airtel_token_cache_error_total'
            );

            this._logError(
                'Airtel token cache retrieval failed',
                {
                    tenantId:
                        normalizedTenantId,

                    correlationId:
                        normalizedCorrelationId,

                    error:
                        sanitizeError(error)
                }
            );

            throw normalizeError(error);

        }

        /**
         * ---------------------------------------------------------------
         * Cache miss
         * ---------------------------------------------------------------
         */

        if (!cached) {

            this._incrementMetric(
                'payment_airtel_token_cache_miss_total'
            );

            const token =
                await this.authenticate({

                    tenantId:
                        normalizedTenantId,

                    correlationId:
                        normalizedCorrelationId

                });

            return token.accessToken;

        }

        /**
         * ---------------------------------------------------------------
         * Defensive token validation
         * ---------------------------------------------------------------
         */

        if (!hasAccessToken(cached)) {

            this._incrementMetric(
                'payment_airtel_token_cache_invalid_total'
            );

            await this.tokenManager.remove({

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

            }).catch(() => {});

            const token =
                await this.authenticate({

                    tenantId:
                        normalizedTenantId,

                    correlationId:
                        normalizedCorrelationId

                });

            return token.accessToken;

        }

        /**
         * ---------------------------------------------------------------
         * Cache hit
         * ---------------------------------------------------------------
         */

        this._incrementMetric(
            'payment_airtel_token_cache_hit_total'
        );

        /**
         * ---------------------------------------------------------------
         * Token expiry
         * ---------------------------------------------------------------
         */

        let expiringSoon = false;

        if (
            typeof this.tokenManager
                .isExpiringSoon === 'function'
        ) {

            expiringSoon =
                await this.tokenManager
                    .isExpiringSoon(
                        cached
                    );

        } else if (
            cached.expiresAt
        ) {

            expiringSoon =
                !authConstants.isTokenUsable({

                    expiresAt:
                        cached.expiresAt,

                    minimumValiditySeconds:
                        TOKEN?.MIN_VALIDITY_SECONDS ||
                        30

                });

        }

        if (expiringSoon) {

            this._incrementMetric(
                'payment_airtel_token_refresh_required_total'
            );

            return this.refreshToken({

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId

            });

        }

        return (
            cached.accessToken ||
            cached.access_token
        );

    }

    /**
     * ========================================================================
     * Refresh Access Token
     * ========================================================================
     */

    async refreshToken({

        tenantId,

        correlationId

    } = {}) {

        this._assertInitialized();

        const normalizedTenantId =
            normalizeTenantId(tenantId);

        const normalizedCorrelationId =
            normalizeCorrelationId(correlationId);

        /**
         * ---------------------------------------------------------------
         * Preferred external refresh manager
         * ---------------------------------------------------------------
         */

        if (this.refreshManager) {

            return this.refreshManager.execute({

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

                provider:
                    PROVIDER?.NAME ||
                    'airtel',

                refresh:
                    async () =>
                        this.authenticate({

                            tenantId:
                                normalizedTenantId,

                            correlationId:
                                normalizedCorrelationId

                        })

            });

        }

        /**
         * ---------------------------------------------------------------
         * Local single-flight fallback
         * ---------------------------------------------------------------
         */

        const existingFlight =
            this.refreshFlights.get(
                normalizedTenantId
            );

        if (existingFlight) {

            this._incrementMetric(
                'payment_airtel_refresh_singleflight_join_total'
            );

            const token =
                await existingFlight;

            return token.accessToken;

        }

        const refreshPromise =
            this.authenticate({

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId

            });

        this.refreshFlights.set(
            normalizedTenantId,
            refreshPromise
        );

        try {

            const token =
                await refreshPromise;

            return token.accessToken;

        } finally {

            if (
                this.refreshFlights.get(
                    normalizedTenantId
                ) === refreshPromise
            ) {

                this.refreshFlights.delete(
                    normalizedTenantId
                );

            }

        }

    }

    /**
     * ========================================================================
     * Invalidate Cached Token
     * ========================================================================
     */

    async invalidate({

        tenantId,

        correlationId

    } = {}) {

        this._assertInitialized();

        const normalizedTenantId =
            normalizeTenantId(tenantId);

        const normalizedCorrelationId =
            normalizeCorrelationId(correlationId);

        await this.tokenManager.remove({

            tenantId:
                normalizedTenantId,

            correlationId:
                normalizedCorrelationId,

            provider:
                PROVIDER?.NAME ||
                'airtel',

        });

        this._incrementMetric(
            'payment_airtel_token_invalidation_total'
        );

        await this.auditService
            ?.record
            ?.({

                action:
                    'AIRTEL_TOKEN_INVALIDATED',

                provider:
                    PROVIDER?.CODE ||
                    'AIRTEL_MONEY',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

            });

        this._logInfo(
            'Airtel token invalidated',
            {
                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId
            }
        );

        return true;

    }

    /**
     * ========================================================================
     * Rotate Credentials
     * ========================================================================
     */

    async rotateCredentials({

        tenantId,

        credentials,

        correlationId

    } = {}) {

        this._assertInitialized();

        const normalizedTenantId =
            normalizeTenantId(tenantId);

        const normalizedCorrelationId =
            normalizeCorrelationId(correlationId);

        if (
            !credentials ||
            typeof credentials !== 'object'
        ) {

            throw new AuthenticationError(
                'Airtel credentials are required for rotation',
                {
                    code:
                        'AIRTEL_ROTATION_CREDENTIALS_REQUIRED'
                }
            );

        }

        /**
         * Never accept an empty credential set.
         */

        const clientId =
            credentials.clientId ||
            credentials.client_id;

        const clientSecret =
            credentials.clientSecret ||
            credentials.client_secret;

        if (!clientId) {

            throw new AuthenticationError(
                'Airtel client ID is required for credential rotation',
                {
                    code:
                        ERROR_CODES
                            ?.MISSING_CLIENT_ID ||
                        'AIRTEL_MISSING_CLIENT_ID'
                }
            );

        }

        if (!clientSecret) {

            throw new AuthenticationError(
                'Airtel client secret is required for credential rotation',
                {
                    code:
                        ERROR_CODES
                            ?.MISSING_CLIENT_SECRET ||
                        'AIRTEL_MISSING_CLIENT_SECRET'
                }
            );

        }

        /**
         * ---------------------------------------------------------------
         * Credential rotation
         * ---------------------------------------------------------------
         */

        await this.credentialManager.rotate({

            tenantId:
                normalizedTenantId,

            credentials,

            correlationId:
                normalizedCorrelationId,

            provider:
                PROVIDER?.NAME ||
                'airtel',

        });

        /**
         * ---------------------------------------------------------------
         * Invalidate previous token
         * ---------------------------------------------------------------
         */

        await this.invalidate({

            tenantId:
                normalizedTenantId,

            correlationId:
                normalizedCorrelationId

        });

        this._incrementMetric(
            'payment_airtel_credential_rotation_total'
        );

        await this.auditService
            ?.record
            ?.({

                action:
                    'AIRTEL_CREDENTIALS_ROTATED',

                provider:
                    PROVIDER?.CODE ||
                    'AIRTEL_MONEY',

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId,

            });

        this._logInfo(
            'Airtel credentials rotated',
            {
                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId
            }
        );

        /**
         * Authenticate using the new credentials.
         */
        const token =
            await this.authenticate({

                tenantId:
                    normalizedTenantId,

                correlationId:
                    normalizedCorrelationId

            });

        return token;

    }

    /**
     * ========================================================================
     * Warm Token Cache
     * ========================================================================
     */

    async warm({

        tenantId,

        correlationId

    } = {}) {

        return this.getAccessToken({

            tenantId,

            correlationId

        });

    }

    /**
     * ========================================================================
     * Health Check
     * ========================================================================
     */

    async health() {

        const cacheEntries =
            await this._resolveCacheSize();

        const uptimeMs =
            this._elapsedSince(
                this.startedAt
            );

        return Object.freeze({

            provider:
                PROVIDER?.CODE ||
                'AIRTEL_MONEY',

            providerName:
                PROVIDER?.NAME ||
                'airtel',

            module:
                'authentication',

            environment:
                PROVIDER?.ENVIRONMENT,

            country:
                PROVIDER?.COUNTRY,

            currency:
                PROVIDER?.CURRENCY,

            status:
                this.healthState.status,

            initialized:
                this.healthState.initialized,

            uptimeMs,

            startedAt:
                this.startedAt,

            cacheEntries,

            activeAuthenticationFlights:
                this.authenticationFlights.size,

            activeRefreshFlights:
                this.refreshFlights.size,

            lastAuthentication:
                this.healthState
                    .lastAuthentication,

            lastFailure:
                this.healthState
                    .lastFailure,

            lastFailureCode:
                this.healthState
                    .lastFailureCode,

            consecutiveFailures:
                this.healthState
                    .consecutiveFailures,

            totalAuthentications:
                this.healthState
                    .totalAuthentications,

            totalFailures:
                this.healthState
                    .totalFailures,

        });

    }

    /**
     * ========================================================================
     * Readiness
     * ========================================================================
     */

    isReady() {

        return (
            this.initialized === true &&
            this.healthState.status !== 'DOWN'
        );

    }

    /**
     * ========================================================================
     * Runtime Capabilities
     * ========================================================================
     */

    capabilities() {

        return Object.freeze({

            provider:
                PROVIDER?.CODE ||
                'AIRTEL_MONEY',

            providerName:
                PROVIDER?.NAME ||
                'airtel',

            environment:
                PROVIDER?.ENVIRONMENT,

            oauth: true,

            clientCredentialsGrant:
                true,

            tokenCaching:
                true,

            automaticRefresh:
                true,

            singleFlightAuthentication:
                true,

            singleFlightRefresh:
                true,

            credentialRotation:
                true,

            multiTenant:
                true,

            correlationIds:
                true,

            audit:
                !!this.auditService,

            tracing:
                !!this.tracer,

            metrics:
                !!this.metrics,

            observability:
                !!this.observability,

            cache:
                !!this.tokenManager,

            refreshManager:
                !!this.refreshManager,

        });

    }

    /**
     * ========================================================================
     * Shutdown
     * ========================================================================
     *
     * Authentication service does not own the underlying Redis/HTTP clients,
     * so it does not close them here. It only clears local coordination state.
     */

    async shutdown() {

        this.authenticationFlights.clear();

        this.refreshFlights.clear();

        this.initialized =
            false;

        this.healthState.initialized =
            false;

        this.healthState.status =
            'STOPPED';

        this._incrementMetric(
            'payment_airtel_auth_shutdown_total'
        );

        this._logInfo(
            'Airtel authentication service stopped'
        );

        return true;

    }

    /**
     * ========================================================================
     * Private: Metric Helpers
     * ========================================================================
     */

    _incrementMetric(
        name,
        value = 1
    ) {

        try {

            if (
                typeof this.metrics?.counter ===
                'function'
            ) {

                this.metrics.counter(
                    name,
                    value
                );

            } else if (
                typeof this.metrics?.increment ===
                'function'
            ) {

                this.metrics.increment(
                    name,
                    value
                );

            }

        } catch (error) {

            /**
             * Metrics must never break payment authentication.
             */

            this._logWarn(
                'Airtel authentication metric emission failed',
                {
                    metric: name
                }
            );

        }

    }

    _observeMetric(
        name,
        value
    ) {

        try {

            if (
                typeof this.metrics?.histogram ===
                'function'
            ) {

                this.metrics.histogram(
                    name,
                    value
                );

            } else if (
                typeof this.metrics?.observe ===
                'function'
            ) {

                this.metrics.observe(
                    name,
                    value
                );

            }

        } catch (error) {

            this._logWarn(
                'Airtel authentication histogram emission failed',
                {
                    metric: name
                }
            );

        }

    }

    /**
     * ========================================================================
     * Private: Logging Helpers
     * ========================================================================
     */

    _logInfo(
        message,
        metadata = {}
    ) {

        try {

            this.logger?.info?.({

                message,

                provider:
                    PROVIDER?.CODE ||
                    'AIRTEL_MONEY',

                ...metadata

            });

        } catch (error) {

            /**
             * Logging must never interrupt authentication.
             */

        }

    }

    _logWarn(
        message,
        metadata = {}
    ) {

        try {

            this.logger?.warn?.({

                message,

                provider:
                    PROVIDER?.CODE ||
                    'AIRTEL_MONEY',

                ...metadata

            });

        } catch (error) {

            /**
             * Intentionally ignored.
             */

        }

    }

    _logError(
        message,
        metadata = {}
    ) {

        try {

            this.logger?.error?.({

                message,

                provider:
                    PROVIDER?.CODE ||
                    'AIRTEL_MONEY',

                ...metadata

            });

        } catch (error) {

            /**
             * Intentionally ignored.
             */

        }

    }

    /**
     * ========================================================================
     * Private: Tracing
     * ========================================================================
     */

    _startSpan(
        name,
        attributes = {}
    ) {

        try {

            if (
                typeof this.tracer?.startSpan !==
                'function'
            ) {

                return null;

            }

            const span =
                this.tracer.startSpan(
                    name
                );

            /**
             * Never attach tenant credentials, tokens, or secrets.
             */

            if (
                typeof span?.setAttribute ===
                'function'
            ) {

                span.setAttribute(
                    'payment.provider',
                    'airtel'
                );

                span.setAttribute(
                    'payment.operation',
                    'authentication'
                );

                if (
                    attributes.correlationId
                ) {

                    span.setAttribute(
                        'correlation.id',
                        attributes.correlationId
                    );

                }

                if (
                    attributes.tenantId
                ) {

                    span.setAttribute(
                        'tenant.id',
                        attributes.tenantId
                    );

                }

            }

            return span;

        } catch (error) {

            return null;

        }

    }

    /**
     * ========================================================================
     * Private: Cache Size
     * ========================================================================
     */

    async _resolveCacheSize() {

        try {

            if (
                typeof this.tokenManager.size ===
                'function'
            ) {

                return await this.tokenManager.size();

            }

            if (
                typeof this.tokenManager.count ===
                'function'
            ) {

                return await this.tokenManager.count();

            }

        } catch (error) {

            return null;

        }

        return null;

    }

    /**
     * ========================================================================
     * Private: Time Helpers
     * ========================================================================
     */

    _elapsedMilliseconds(
        startedAt
    ) {

        const now =
            this.clock.now
                ? this.clock.now()
                : Date.now();

        return Math.max(
            0,
            now - startedAt
        );

    }

    _elapsedSince(
        startedAt
    ) {

        if (
            !(startedAt instanceof Date)
        ) {

            return null;

        }

        return Math.max(
            0,
            Date.now() -
            startedAt.getTime()
        );

    }

}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports = AirtelAuthService;