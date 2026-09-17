'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Authentication Module
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth.js
 *
 * Architectural Role
 * ------------------
 * Public composition root and stable facade for the Airtel Money
 * authentication subsystem.
 *
 * The module composes and exposes the canonical authentication lifecycle:
 *
 *   auth.js
 *      │
 *      ├── auth/
 *      │     ├── authService.js
 *      │     ├── credentialManager.js
 *      │     ├── oauthClient.js
 *      │     ├── tokenManager.js
 *      │     ├── observability.js
 *      │     └── healthMonitor.js
 *      │
 *      ├── refreshManager.js
 *      │
 *      └── shared/
 *            ├── configuration.js
 *            ├── errors.js
 *            └── requestBuilder.js
 *
 * Responsibilities
 * ----------------
 * • Compose the Airtel authentication subsystem.
 * • Expose a stable public authentication API.
 * • Initialize authentication dependencies safely.
 * • Delegate OAuth authentication to authService.
 * • Delegate credential lifecycle to credentialManager.
 * • Delegate token caching/lifecycle to tokenManager.
 * • Delegate refresh/concurrency behavior to refreshManager.
 * • Expose health and diagnostics without exposing secrets.
 * • Preserve tenant context and request correlation context.
 * • Validate critical dependency contracts.
 *
 * Does NOT:
 * ----------
 * • Perform Airtel payment collection.
 * • Perform Airtel disbursement.
 * • Handle provider callbacks.
 * • Reconcile transactions.
 * • Post ledger entries.
 * • Modify balances.
 * • Persist access tokens as application business data.
 * • Implement OAuth protocol logic directly.
 * • Log client secrets, API keys, access tokens or refresh tokens.
 *
 * Security Principles
 * -------------------
 * • Tenant context must remain explicit.
 * • Authentication secrets must remain inside credential/OAuth boundaries.
 * • Access tokens must not be returned through diagnostics or health output.
 * • Authentication dependencies are injected where possible.
 * • Provider configuration is Airtel-specific and must not silently depend on
 *   MTN-specific configuration classes.
 * • Initialization is idempotent.
 * • Authentication failures are propagated rather than converted to success.
 *
 * Compatibility
 * -------------
 * This facade preserves the existing public API:
 *
 *   initialize()
 *   authenticate()
 *   getAccessToken()
 *   refreshToken()
 *   invalidate()
 *   rotateCredentials()
 *   health()
 *
 * CommonJS module format is retained to match the current backend.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const AirtelConfiguration =
    require('../shared/configuration');

const AuthService =
    require('./auth/authService');

const CredentialManager =
    require('./auth/credentialManager');

const OAuthClient =
    require('./auth/oauthClient');

const TokenManager =
    require('./auth/tokenManager');

const RefreshManager =
    require('./refreshManager');

const Observability =
    require('./auth/observability');

const HealthMonitor =
    require('./auth/healthMonitor');


const PROVIDER = 'AIRTEL';


const AUTH_STATUS = Object.freeze({
    CREATED: 'CREATED',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED'
});


function isFunction(value) {
    return typeof value === 'function';
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function safeError(error) {
    if (!error) {
        return null;
    }

    if (
        isFunction(error.toJSON)
    ) {
        try {
            return error.toJSON();
        } catch (_) {
            // Fall through to safe fields.
        }
    }

    return {
        name:
            error.name,
        code:
            error.code,
        message:
            error.message
    };
}


function generateOperationId() {
    return crypto.randomUUID();
}


class AirtelAuthentication {

    constructor({
        configuration,

        credentialManager,
        tokenManager,
        oauthClient,
        refreshManager,
        observability,
        healthMonitor,

        authService,

        auditService,
        tenantResolver,

        logger,
        metrics,
        tracer
    } = {}) {

        /**
         * Airtel must use the shared Airtel-aware configuration boundary.
         *
         * Backward-compatible configuration exports are supported because
         * existing repositories may currently export the class directly or
         * as a named property.
         */
        this.configuration =
            configuration ||
            this.createConfiguration();

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.auditService =
            auditService;

        this.tenantResolver =
            tenantResolver;

        this.credentialManager =
            credentialManager ||
            new CredentialManager({
                configuration:
                    this.configuration,
                logger,
                metrics,
                auditService,
                tenantResolver
            });

        this.tokenManager =
            tokenManager ||
            new TokenManager({
                logger,
                metrics,
                tracer
            });

        this.refreshManager =
            refreshManager ||
            new RefreshManager({
                logger,
                metrics,
                tracer
            });

        this.observability =
            observability ||
            new Observability({
                logger,
                metrics,
                tracer
            });

        this.oauthClient =
            oauthClient ||
            new OAuthClient({
                configuration:
                    this.configuration,
                credentialManager:
                    this.credentialManager,
                logger,
                metrics,
                tracer
            });

        this.healthMonitor =
            healthMonitor ||
            new HealthMonitor({
                logger,
                metrics,
                tracer
            });

        this.authService =
            authService ||
            new AuthService({
                configuration:
                    this.configuration,

                credentialManager:
                    this.credentialManager,

                tokenManager:
                    this.tokenManager,

                oauthClient:
                    this.oauthClient,

                refreshManager:
                    this.refreshManager,

                observability:
                    this.observability,

                auditService:
                    this.auditService,

                tenantResolver:
                    this.tenantResolver,

                logger:
                    this.logger,

                metrics:
                    this.metrics,

                tracer:
                    this.tracer
            });

        this.state = {
            status:
                AUTH_STATUS.CREATED,

            initialized:
                false,

            initializing:
                false,

            initializedAt:
                null,

            lastInitializationAt:
                null,

            lastFailureAt:
                null,

            lastFailure:
                null
        };

        this.initializationPromise =
            null;
    }


    /**
     * =========================================================================
     * Configuration Composition
     * =========================================================================
     *
     * The original implementation instantiated MTNConfiguration for Airtel.
     * That creates a provider-boundary violation and can silently load the
     * wrong endpoints, credentials or environment names.
     */
    createConfiguration() {
        const Configuration =
            AirtelConfiguration?.AirtelConfiguration ||
            AirtelConfiguration?.Configuration ||
            AirtelConfiguration?.default ||
            AirtelConfiguration;

        if (!isFunction(Configuration)) {
            throw new Error(
                'Airtel configuration constructor is unavailable'
            );
        }

        return new Configuration({
            provider: PROVIDER
        });
    }


    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     *
     * Initialization is intentionally single-flight and idempotent.
     */
    async initialize(options = {}) {
        if (
            this.state.initialized
        ) {
            return this.initializationResult();
        }

        if (
            this.initializationPromise
        ) {
            return this.initializationPromise;
        }

        const operationId =
            options.operationId ||
            generateOperationId();

        this.initializationPromise =
            this.initializeInternal({
                ...options,
                operationId
            })
                .finally(() => {
                    this.initializationPromise =
                        null;
                });

        return this.initializationPromise;
    }


    async initializeInternal({
        operationId,
        correlationId,
        tenantId,
        context = {}
    } = {}) {
        this.state.initializing = true;
        this.state.status =
            AUTH_STATUS.INITIALIZING;

        const startedAt =
            Date.now();

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.authentication.initialize'
            );

        try {
            this.validateDependencies();

            const resolvedTenantId =
                await this.resolveTenant({
                    tenantId,
                    context
                });

            const initializationOptions = {
                operationId,
                correlationId,
                tenantId:
                    resolvedTenantId,
                context
            };

            if (
                isFunction(
                    this.authService.initialize
                )
            ) {
                await this.authService.initialize(
                    initializationOptions
                );
            }

            this.state.initialized =
                true;

            this.state.initializing =
                false;

            this.state.status =
                AUTH_STATUS.READY;

            this.state.initializedAt =
                new Date();

            this.state.lastInitializationAt =
                new Date();

            this.metrics?.increment?.(
                'payment_airtel_auth_initialize_success_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_auth_initialize_success_total'
            );

            await this.recordAudit({
                action:
                    'AIRTEL_AUTH_INITIALIZED',
                tenantId:
                    resolvedTenantId,
                correlationId,
                operationId
            });

            return this.initializationResult();
        } catch (error) {
            this.state.initialized =
                false;

            this.state.initializing =
                false;

            this.state.status =
                AUTH_STATUS.FAILED;

            this.state.lastFailureAt =
                new Date();

            this.state.lastFailure =
                safeError(error);

            this.metrics?.increment?.(
                'payment_airtel_auth_initialize_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_auth_initialize_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel authentication initialization failed',
                provider:
                    PROVIDER,
                operationId,
                correlationId,
                tenantId,
                error:
                    safeError(error)
            });

            await this.recordAudit({
                action:
                    'AIRTEL_AUTH_INITIALIZATION_FAILED',
                tenantId,
                correlationId,
                operationId,
                metadata: {
                    error:
                        safeError(error)
                }
            });

            throw error;
        } finally {
            span?.end?.({
                duration:
                    Date.now() - startedAt
            });
        }
    }


    /**
     * =========================================================================
     * Authenticate
     * =========================================================================
     */
    async authenticate(options = {}) {
        const operationId =
            options.operationId ||
            generateOperationId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        await this.ensureInitialized({
            ...options,
            tenantId,
            operationId
        });

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.authentication.authenticate'
            );

        try {
            const result =
                await this.authService.authenticate({
                    ...options,
                    tenantId,
                    operationId
                });

            this.metrics?.increment?.(
                'payment_airtel_authenticate_success_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_authenticate_success_total'
            );

            return result;
        } catch (error) {
            this.metrics?.increment?.(
                'payment_airtel_authenticate_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_authenticate_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel authentication request failed',
                provider:
                    PROVIDER,
                tenantId,
                operationId,
                correlationId:
                    options.correlationId,
                error:
                    safeError(error)
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Access Token
     * =========================================================================
     */
    async getAccessToken(options = {}) {
        const operationId =
            options.operationId ||
            generateOperationId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        await this.ensureInitialized({
            ...options,
            tenantId,
            operationId
        });

        return this.authService.getAccessToken({
            ...options,
            tenantId,
            operationId
        });
    }


    /**
     * =========================================================================
     * Refresh Token
     * =========================================================================
     */
    async refreshToken(options = {}) {
        const operationId =
            options.operationId ||
            generateOperationId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        await this.ensureInitialized({
            ...options,
            tenantId,
            operationId
        });

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.authentication.refresh'
            );

        try {
            return await this.authService.refreshToken({
                ...options,
                tenantId,
                operationId
            });
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Invalidate
     * =========================================================================
     */
    async invalidate(options = {}) {
        const operationId =
            options.operationId ||
            generateOperationId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        /**
         * Invalidation should remain available even when initialization has
         * failed because clearing potentially stale credentials is a recovery
         * operation.
         */
        return this.authService.invalidate({
            ...options,
            tenantId,
            operationId
        });
    }


    /**
     * =========================================================================
     * Credential Rotation
     * =========================================================================
     */
    async rotateCredentials(options = {}) {
        const operationId =
            options.operationId ||
            generateOperationId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        const tenantId =
            await this.resolveTenant({
                tenantId:
                    options.tenantId,
                context
            });

        await this.ensureInitialized({
            ...options,
            tenantId,
            operationId
        });

        if (
            !isFunction(
                this.authService.rotateCredentials
            )
        ) {
            throw new Error(
                'Airtel authentication service does not support credential rotation'
            );
        }

        return this.authService.rotateCredentials({
            ...options,
            tenantId,
            operationId
        });
    }


    /**
     * =========================================================================
     * Health
     * =========================================================================
     */
    async health(options = {}) {
        const operationId =
            options.operationId ||
            generateOperationId();

        const context =
            isObject(options.context)
                ? options.context
                : {};

        let tenantId = null;

        try {
            tenantId =
                options.tenantId
                    ? String(options.tenantId)
                    : null;
        } catch (_) {
            tenantId = null;
        }

        const checks = {};

        checks.configuration =
            await this.safeHealth(
                this.configuration
            );

        checks.authentication =
            await this.safeHealth(
                this.authService
            );

        checks.credentials =
            await this.safeHealth(
                this.credentialManager
            );

        checks.tokenCache =
            await this.safeHealth(
                this.tokenManager
            );

        checks.refreshManager =
            await this.safeHealth(
                this.refreshManager
            );

        checks.observability =
            await this.safeHealth(
                this.observability
            );

        checks.monitor =
            await this.safeHealth(
                this.healthMonitor
            );

        const overall =
            this.calculateHealthStatus(
                checks
            );

        return {
            provider:
                PROVIDER,

            module:
                'authentication',

            status:
                overall.status,

            initialized:
                this.state.initialized,

            state:
                this.state.status,

            tenantScoped:
                Boolean(
                    tenantId
                ),

            operationId,

            checks,

            dependencies: {
                configuration:
                    Boolean(
                        this.configuration
                    ),

                authentication:
                    Boolean(
                        this.authService
                    ),

                credentialManager:
                    Boolean(
                        this.credentialManager
                    ),

                tokenManager:
                    Boolean(
                        this.tokenManager
                    ),

                oauthClient:
                    Boolean(
                        this.oauthClient
                    ),

                refreshManager:
                    Boolean(
                        this.refreshManager
                    ),

                observability:
                    Boolean(
                        this.observability
                    ),

                healthMonitor:
                    Boolean(
                        this.healthMonitor
                    )
            },

            statistics: {
                initializedAt:
                    this.state.initializedAt,

                lastInitializationAt:
                    this.state.lastInitializationAt,

                lastFailureAt:
                    this.state.lastFailureAt,

                lastFailure:
                    this.state.lastFailure
            },

            context: {
                tenantId:
                    tenantId
                        ? String(tenantId)
                        : undefined,

                hasRequestContext:
                    Boolean(
                        Object.keys(context).length
                    )
            }
        };
    }


    /**
     * =========================================================================
     * Dependency Health
     * =========================================================================
     */
    async safeHealth(
        dependency
    ) {
        if (!dependency) {
            return {
                status:
                    'NOT_CONFIGURED'
            };
        }

        try {
            if (
                isFunction(
                    dependency.health
                )
            ) {
                const result =
                    await dependency.health();

                return this.sanitizeHealth(
                    result
                );
            }

            return {
                status:
                    'AVAILABLE'
            };
        } catch (error) {
            return {
                status:
                    'DOWN',
                error:
                    safeError(error)
            };
        }
    }


    sanitizeHealth(value) {
        if (!isObject(value)) {
            return value;
        }

        /**
         * Health implementations occasionally return metadata that could
         * accidentally contain credentials. Remove common secret-bearing keys
         * before surfacing the result.
         */
        const sensitiveKeys = new Set([
            'accessToken',
            'refreshToken',
            'clientSecret',
            'client_secret',
            'apiKey',
            'api_key',
            'secret',
            'password',
            'token',
            'authorization',
            'credentials'
        ]);

        const sanitized = {};

        for (
            const [
                key,
                value
            ] of Object.entries(value)
        ) {
            if (
                sensitiveKeys.has(
                    key
                )
            ) {
                continue;
            }

            if (
                isObject(value) &&
                !Array.isArray(value)
            ) {
                sanitized[key] =
                    this.sanitizeHealth(
                        value
                    );
                continue;
            }

            sanitized[key] =
                value;
        }

        return sanitized;
    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     *
     * Diagnostics are intentionally metadata-only.
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            module:
                'authentication',

            state:
                this.state.status,

            initialized:
                this.state.initialized,

            initializing:
                this.state.initializing,

            dependencies: {
                configuration:
                    Boolean(
                        this.configuration
                    ),
                credentialManager:
                    Boolean(
                        this.credentialManager
                    ),
                tokenManager:
                    Boolean(
                        this.tokenManager
                    ),
                oauthClient:
                    Boolean(
                        this.oauthClient
                    ),
                refreshManager:
                    Boolean(
                        this.refreshManager
                    ),
                observability:
                    Boolean(
                        this.observability
                    ),
                healthMonitor:
                    Boolean(
                        this.healthMonitor
                    ),
                authService:
                    Boolean(
                        this.authService
                    )
            },

            timestamps: {
                initializedAt:
                    this.state.initializedAt,

                lastInitializationAt:
                    this.state.lastInitializationAt,

                lastFailureAt:
                    this.state.lastFailureAt
            }
        };
    }


    /**
     * =========================================================================
     * Initialization Helpers
     * =========================================================================
     */
    async ensureInitialized(options = {}) {
        if (
            this.state.initialized
        ) {
            return true;
        }

        await this.initialize(
            options
        );

        return true;
    }


    initializationResult() {
        return {
            provider:
                PROVIDER,

            initialized:
                this.state.initialized,

            status:
                this.state.status,

            initializedAt:
                this.state.initializedAt
        };
    }


    validateDependencies() {
        const required = {
            configuration:
                this.configuration,

            credentialManager:
                this.credentialManager,

            tokenManager:
                this.tokenManager,

            oauthClient:
                this.oauthClient,

            refreshManager:
                this.refreshManager,

            observability:
                this.observability,

            healthMonitor:
                this.healthMonitor,

            authService:
                this.authService
        };

        const missing =
            Object.entries(
                required
            )
                .filter(
                    ([, dependency]) =>
                        !dependency
                )
                .map(
                    ([name]) => name
                );

        if (
            missing.length
        ) {
            const error =
                new Error(
                    `Airtel authentication dependencies unavailable: ${missing.join(', ')}`
                );

            error.code =
                'AIRTEL_AUTH_DEPENDENCY_FAILURE';

            throw error;
        }

        const contracts = [
            [
                'authService.initialize',
                this.authService,
                'initialize'
            ],
            [
                'authService.authenticate',
                this.authService,
                'authenticate'
            ],
            [
                'authService.getAccessToken',
                this.authService,
                'getAccessToken'
            ],
            [
                'authService.refreshToken',
                this.authService,
                'refreshToken'
            ],
            [
                'authService.invalidate',
                this.authService,
                'invalidate'
            ]
        ];

        const invalid =
            contracts
                .filter(
                    ([, dependency, method]) =>
                        !isFunction(
                            dependency?.[method]
                        )
                )
                .map(
                    ([name]) => name
                );

        if (
            invalid.length
        ) {
            const error =
                new Error(
                    `Airtel authentication service contract invalid: ${invalid.join(', ')}`
                );

            error.code =
                'AIRTEL_AUTH_CONTRACT_INVALID';

            throw error;
        }

        return true;
    }


    /**
     * =========================================================================
     * Tenant Resolution
     * =========================================================================
     */
    async resolveTenant({
        tenantId,
        context = {}
    } = {}) {
        if (
            tenantId !== undefined &&
            tenantId !== null &&
            String(tenantId).trim() !== ''
        ) {
            return String(
                tenantId
            );
        }

        if (
            this.tenantResolver &&
            isFunction(
                this.tenantResolver.resolve
            )
        ) {
            const resolved =
                await this.tenantResolver.resolve(
                    context
                );

            if (
                resolved !== undefined &&
                resolved !== null &&
                String(resolved).trim() !== ''
            ) {
                return String(
                    resolved
                );
            }
        }

        /**
         * Health/initialization can legitimately operate without an active
         * tenant, but financial authentication requests should normally carry
         * one. The downstream authService remains the final enforcement point.
         */
        return null;
    }


    /**
     * =========================================================================
     * Health Aggregation
     * =========================================================================
     */
    calculateHealthStatus(
        checks
    ) {
        const statuses =
            Object.values(
                checks
            ).map(
                item =>
                    item?.status
            );

        const hasDown =
            statuses.includes(
                'DOWN'
            );

        const hasUnavailable =
            statuses.some(
                status =>
                    status ===
                        'NOT_CONFIGURED' ||
                    status ===
                        'DEGRADED'
            );

        if (
            hasDown
        ) {
            return {
                status:
                    'DOWN'
            };
        }

        if (
            hasUnavailable ||
            !this.state.initialized
        ) {
            return {
                status:
                    'DEGRADED'
            };
        }

        return {
            status:
                'UP'
        };
    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     *
     * Authentication secrets are never included in audit metadata.
     */
    async recordAudit({
        action,
        tenantId,
        correlationId,
        operationId,
        metadata = {}
    } = {}) {
        if (
            !this.auditService ||
            !isFunction(
                this.auditService.record
            )
        ) {
            return;
        }

        try {
            await this.auditService.record({
                action,
                tenantId,
                provider:
                    PROVIDER,
                correlationId,
                operationId,
                metadata:
                    this.sanitizeHealth(
                        metadata
                    )
            });
        } catch (error) {
            /**
             * Audit failure should remain observable but must not rewrite a
             * successfully initialized authentication result.
             */
            this.logger?.error?.({
                message:
                    'Airtel authentication audit recording failed',
                provider:
                    PROVIDER,
                tenantId,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });
        }
    }
}


module.exports =
    AirtelAuthentication;

module.exports.AirtelAuthentication =
    AirtelAuthentication;

module.exports.PROVIDER =
    PROVIDER;

module.exports.AUTH_STATUS =
    AUTH_STATUS;