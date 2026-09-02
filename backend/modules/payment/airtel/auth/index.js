'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Authentication Module
 * ============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/auth/index.js
 *
 * Purpose
 * -------
 * Enterprise composition root for the Airtel Money authentication subsystem.
 *
 * Responsibilities
 * ----------------
 * • Compose the complete Airtel OAuth authentication stack
 * • Validate authentication configuration before startup
 * • Construct authentication dependencies in a deterministic order
 * • Provide dependency injection
 * • Coordinate lifecycle initialization
 * • Coordinate graceful shutdown
 * • Expose health/readiness/liveness diagnostics
 * • Expose operational statistics
 * • Provide idempotency coordination
 * • Provide observability integration
 * • Preserve backward-compatible component exports
 *
 * Components
 * ----------
 * • AuthService
 * • OAuthClient
 * • CredentialManager
 * • TokenManager
 * • RefreshManager
 * • IdempotencyManager
 * • HealthMonitor
 * • AirtelAuthObservability
 * • Authentication constants
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Payment collections
 * • Disbursements
 * • Settlement
 * • Reconciliation
 * • Ledger posting
 * • Provider HTTP implementation
 * • Credential secret storage
 *
 * Architectural Principle
 * -----------------------
 * This file is the composition root only.
 *
 * Business logic belongs to the individual services.
 * Configuration belongs to authConstants.js / configuration services.
 * HTTP transport belongs to oauthClient.js.
 * Credentials belong to credentialManager.js.
 * Tokens belong to tokenManager.js.
 * Refresh coordination belongs to refreshManager.js.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/**
 * ============================================================================
 * Component imports
 * ============================================================================
 */

const AuthService =
    require('./authService');

const OAuthClient =
    require('./oauthClient');

const CredentialManager =
    require('./credentialManager');

const TokenManager =
    require('./tokenManager');

const {
    RefreshManager
} = require('./refreshManager');

const {
    IdempotencyManager
} = require('./idempotencyManager');

const {
    HealthMonitor
} = require('./healthMonitor');

const {
    AirtelAuthObservability
} = require('./observability');

/**
 * Authentication constants are intentionally optional at runtime.
 *
 * This keeps the composition root compatible with deployments where the
 * configuration object is responsible for all provider configuration.
 */
const authConstants =
    require('./authConstants');

/**
 * ============================================================================
 * Module metadata
 * ============================================================================
 */

const MODULE_NAME =
    'airtel-authentication';

const PROVIDER =
    'AIRTEL';

const VERSION =
    '1.0.0';

const LIFECYCLE_STATUS =
    Object.freeze({

        CREATED:
            'CREATED',

        INITIALIZING:
            'INITIALIZING',

        READY:
            'READY',

        DEGRADED:
            'DEGRADED',

        STOPPING:
            'STOPPING',

        STOPPED:
            'STOPPED',

        FAILED:
            'FAILED'

    });

/**
 * ============================================================================
 * Utility helpers
 * ============================================================================
 */

/**
 * Safely invoke an optional lifecycle method.
 */
async function invokeOptional(
    target,
    method,
    ...args
) {

    if (
        !target ||
        typeof target[method] !== 'function'
    ) {
        return undefined;
    }

    return target[method](...args);
}

/**
 * Safely invoke an optional synchronous method.
 */
function invokeOptionalSync(
    target,
    method,
    ...args
) {

    if (
        !target ||
        typeof target[method] !== 'function'
    ) {
        return undefined;
    }

    return target[method](...args);
}

/**
 * ============================================================================
 * Airtel Authentication Stack
 * ============================================================================
 */

class AirtelAuthenticationModule {

    constructor({

        configuration,

        secretProvider = null,

        cache = null,

        httpClient,

        logger = null,

        metrics = null,

        tracer = null,

        eventBus = null,

        auditService = null,

        alertService = null,

        refreshManagerOptions = {},

        tokenManagerOptions = {},

        credentialManagerOptions = {},

        idempotencyManagerOptions = {},

        oauthClientOptions = {},

        healthMonitorOptions = {},

        observabilityOptions = {}

    } = {}) {

        if (!configuration) {

            throw new Error(
                'Airtel authentication configuration is required'
            );

        }

        if (!httpClient) {

            throw new Error(
                'Airtel authentication httpClient is required'
            );

        }

        this.configuration =
            configuration;

        this.secretProvider =
            secretProvider;

        this.cache =
            cache;

        this.httpClient =
            httpClient;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.eventBus =
            eventBus;

        this.auditService =
            auditService;

        this.alertService =
            alertService;

        this.startedAt =
            new Date();

        this.lifecycle =
            LIFECYCLE_STATUS.CREATED;

        this.initialized =
            false;

        this.initializingPromise =
            null;

        this.shutdownPromise =
            null;

        this.lastError =
            null;

        this.correlationId =
            crypto.randomUUID();

        /**
         * --------------------------------------------------------------------
         * Observability
         * --------------------------------------------------------------------
         */

        this.observability =
            new AirtelAuthObservability({

                logger,

                metrics,

                tracer,

                eventBus,

                auditService,

                ...observabilityOptions

            });

        /**
         * --------------------------------------------------------------------
         * Credential Manager
         * --------------------------------------------------------------------
         */

        this.credentialManager =
            new CredentialManager({

                configuration,

                secretProvider,

                logger,

                metrics,

                tracer,

                auditService,

                ...credentialManagerOptions

            });

        /**
         * --------------------------------------------------------------------
         * Token Manager
         * --------------------------------------------------------------------
         */

        this.tokenManager =
            new TokenManager({

                cache,

                logger,

                metrics,

                tracer,

                ...tokenManagerOptions

            });

        /**
         * --------------------------------------------------------------------
         * Idempotency Manager
         * --------------------------------------------------------------------
         *
         * Authentication itself normally does not require business-operation
         * idempotency, but the manager is part of the enterprise auth stack
         * because it prevents duplicate authentication workflows when the
         * surrounding orchestration layer requires it.
         */

        this.idempotencyManager =
            new IdempotencyManager({

                cache,

                logger,

                metrics,

                auditService,

                ...idempotencyManagerOptions

            });

        /**
         * --------------------------------------------------------------------
         * Refresh Manager
         * --------------------------------------------------------------------
         */

        this.refreshManager =
            new RefreshManager({

                logger,

                metrics,

                tracer,

                ...refreshManagerOptions

            });

        /**
         * --------------------------------------------------------------------
         * OAuth Client
         * --------------------------------------------------------------------
         */

        this.oauthClient =
            new OAuthClient({

                configuration,

                httpClient,

                logger,

                metrics,

                tracer,

                ...oauthClientOptions

            });

        /**
         * --------------------------------------------------------------------
         * Authentication Service
         * --------------------------------------------------------------------
         */

        this.authService =
            new AuthService({

                configuration,

                tokenManager:

                    this.tokenManager,

                credentialManager:

                    this.credentialManager,

                oauthClient:

                    this.oauthClient,

                refreshManager:

                    this.refreshManager,

                observability:

                    this.observability,

                auditService,

                logger,

                metrics,

                tracer

            });

        /**
         * --------------------------------------------------------------------
         * Health Monitor
         * --------------------------------------------------------------------
         */

        this.healthMonitor =
            new HealthMonitor({

                authService:

                    this.authService,

                oauthClient:

                    this.oauthClient,

                tokenManager:

                    this.tokenManager,

                credentialManager:

                    this.credentialManager,

                configuration,

                logger,

                metrics,

                tracer,

                eventBus,

                alertService,

                ...healthMonitorOptions

            });

        /**
         * --------------------------------------------------------------------
         * Public component registry
         * --------------------------------------------------------------------
         *
         * Useful for dependency inspection and operational diagnostics.
         */

        this.components =
            Object.freeze({

                authService:
                    this.authService,

                oauthClient:
                    this.oauthClient,

                credentialManager:
                    this.credentialManager,

                tokenManager:
                    this.tokenManager,

                refreshManager:
                    this.refreshManager,

                idempotencyManager:
                    this.idempotencyManager,

                healthMonitor:
                    this.healthMonitor,

                observability:
                    this.observability

            });

    }

    /**
     * =========================================================================
     * Initialize
     * =========================================================================
     */

    async initialize({

        correlationId =
            crypto.randomUUID()

    } = {}) {

        /**
         * Prevent duplicate initialization.
         */

        if (
            this.lifecycle ===
            LIFECYCLE_STATUS.READY
        ) {

            return true;

        }

        /**
         * Prevent concurrent initialization races.
         */

        if (this.initializingPromise) {

            return this.initializingPromise;

        }

        this.initializingPromise =
            this._initialize({

                correlationId

            });

        try {

            return await this.initializingPromise;

        }

        finally {

            this.initializingPromise =
                null;

        }

    }

    /**
     * =========================================================================
     * Internal Initialization
     * =========================================================================
     */

    async _initialize({

        correlationId

    }) {

        this.lifecycle =
            LIFECYCLE_STATUS.INITIALIZING;

        this.lastError =
            null;

        const started =
            Date.now();

        try {

            /**
             * ---------------------------------------------------------------
             * Configuration validation
             * ---------------------------------------------------------------
             */

            this.validateConfiguration();

            /**
             * ---------------------------------------------------------------
             * Optional component initialization
             * ---------------------------------------------------------------
             */

            await invokeOptional(
                this.observability,
                'initialize'
            );

            await invokeOptional(
                this.credentialManager,
                'initialize'
            );

            await invokeOptional(
                this.tokenManager,
                'initialize'
            );

            await invokeOptional(
                this.idempotencyManager,
                'initialize'
            );

            await invokeOptional(
                this.refreshManager,
                'initialize'
            );

            await invokeOptional(
                this.oauthClient,
                'initialize'
            );

            /**
             * ---------------------------------------------------------------
             * Authentication service initialization
             * ---------------------------------------------------------------
             */

            await invokeOptional(
                this.authService,
                'initialize'
            );

            /**
             * ---------------------------------------------------------------
             * Health monitor initialization
             * ---------------------------------------------------------------
             */

            await invokeOptional(
                this.healthMonitor,
                'initialize'
            );

            this.initialized =
                true;

            this.lifecycle =
                LIFECYCLE_STATUS.READY;

            this.startedAt =
                new Date();

            this.metrics?.counter?.(
                'payment_airtel_auth_module_initialize_total'
            );

            this.metrics?.histogram?.(
                'payment_airtel_auth_module_initialize_duration_ms',
                Date.now() - started
            );

            this.logger?.info?.({

                message:
                    'Airtel authentication module initialized',

                provider:
                    PROVIDER,

                module:
                    MODULE_NAME,

                correlationId,

                durationMs:
                    Date.now() - started

            });

            await this.observability
                ?.moduleInitialized?.({

                    provider:
                        PROVIDER,

                    correlationId

                });

            await this.auditService?.record?.({

                action:
                    'AIRTEL_AUTH_MODULE_INITIALIZED',

                provider:
                    PROVIDER,

                correlationId

            });

            return true;

        }

        catch (error) {

            this.lifecycle =
                LIFECYCLE_STATUS.FAILED;

            this.initialized =
                false;

            this.lastError =
                this.sanitizeError(error);

            this.metrics?.counter?.(
                'payment_airtel_auth_module_initialize_failure_total'
            );

            this.logger?.error?.({

                message:
                    'Airtel authentication module initialization failed',

                provider:
                    PROVIDER,

                module:
                    MODULE_NAME,

                correlationId,

                error:
                    this.lastError

            });

            throw error;

        }

    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    validateConfiguration() {

        /**
         * Prefer the configuration object's validator when available.
         */

        if (
            typeof this.configuration.validate ===
            'function'
        ) {

            const result =
                this.configuration.validate();

            /**
             * Support both:
             *
             *   validate() -> throws
             *
             * and:
             *
             *   validate() -> { valid, errors }
             */

            if (
                result &&
                result.valid === false
            ) {

                const message =
                    result.errors
                        ?.map(
                            error =>
                                error.message ||
                                String(error)
                        )
                        .join('; ') ||
                    'Invalid Airtel authentication configuration';

                throw new Error(message);

            }

        }

        /**
         * Validate authConstants configuration as an additional defensive
         * layer when available.
         */

        if (
            typeof authConstants.validateConfiguration ===
            'function'
        ) {

            const validation =
                authConstants.validateConfiguration();

            if (
                validation &&
                validation.valid === false
            ) {

                const message =
                    validation.errors
                        ?.map(
                            error =>
                                error.message ||
                                String(error)
                        )
                        .join('; ') ||
                    'Invalid Airtel authentication constants';

                throw new Error(message);

            }

        }

        return true;

    }

    /**
     * =========================================================================
     * Authentication Convenience API
     * =========================================================================
     *
     * Keeps consumers from needing to know the internal component graph.
     */

    async authenticate(options = {}) {

        await this.ensureReady();

        return this.authService.authenticate(
            options
        );

    }

    async getAccessToken(options = {}) {

        await this.ensureReady();

        return this.authService.getAccessToken(
            options
        );

    }

    async refreshToken(options = {}) {

        await this.ensureReady();

        return this.authService.refreshToken(
            options
        );

    }

    async invalidate(options = {}) {

        await this.ensureReady();

        return this.authService.invalidate(
            options
        );

    }

    async rotateCredentials(options = {}) {

        await this.ensureReady();

        return this.authService.rotateCredentials(
            options
        );

    }

    /**
     * =========================================================================
     * Ensure Ready
     * =========================================================================
     */

    async ensureReady() {

        if (
            this.lifecycle ===
            LIFECYCLE_STATUS.READY
        ) {

            return true;

        }

        if (
            this.lifecycle ===
            LIFECYCLE_STATUS.STOPPING ||
            this.lifecycle ===
            LIFECYCLE_STATUS.STOPPED
        ) {

            throw new Error(
                'Airtel authentication module is stopped'
            );

        }

        if (
            this.lifecycle ===
            LIFECYCLE_STATUS.FAILED
        ) {

            throw this.lastError ||
                new Error(
                    'Airtel authentication module failed to initialize'
                );

        }

        return this.initialize();

    }

    /**
     * =========================================================================
     * Full Health
     * =========================================================================
     */

    async health({

        tenantId = null,

        correlationId =
            crypto.randomUUID()

    } = {}) {

        try {

            const report =
                await this.healthMonitor.check({

                    tenantId,

                    correlationId

                });

            return {

                ...report,

                module:
                    MODULE_NAME,

                version:
                    VERSION,

                lifecycle:
                    this.lifecycle,

                initialized:
                    this.initialized

            };

        }

        catch (error) {

            return {

                provider:
                    PROVIDER,

                component:
                    MODULE_NAME,

                status:
                    'DOWN',

                lifecycle:
                    this.lifecycle,

                initialized:
                    this.initialized,

                timestamp:
                    new Date(),

                error:
                    this.sanitizeError(error)

            };

        }

    }

    /**
     * =========================================================================
     * Readiness
     * =========================================================================
     */

    async readiness() {

        const result =
            await this.healthMonitor.readiness();

        return {

            ...result,

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            lifecycle:
                this.lifecycle

        };

    }

    /**
     * =========================================================================
     * Liveness
     * =========================================================================
     */

    async liveness() {

        const result =
            await this.healthMonitor.liveness();

        return {

            ...result,

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            lifecycle:
                this.lifecycle

        };

    }

    /**
     * =========================================================================
     * Runtime Statistics
     * =========================================================================
     */

    stats() {

        return {

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            version:
                VERSION,

            lifecycle:
                this.lifecycle,

            initialized:
                this.initialized,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            authentication:
                invokeOptionalSync(
                    this.authService,
                    'stats'
                ),

            credentials:
                invokeOptionalSync(
                    this.credentialManager,
                    'stats'
                ),

            tokens:
                invokeOptionalSync(
                    this.tokenManager,
                    'stats'
                ),

            refresh:
                invokeOptionalSync(
                    this.refreshManager,
                    'stats'
                ),

            idempotency:
                invokeOptionalSync(
                    this.idempotencyManager,
                    'stats'
                ),

            health:
                invokeOptionalSync(
                    this.healthMonitor,
                    'snapshot'
                )

        };

    }

    /**
     * =========================================================================
     * Safe Operational Snapshot
     * =========================================================================
     *
     * Never exposes:
     * • client secrets
     * • access tokens
     * • authorization headers
     * • raw credentials
     */

    snapshot() {

        return {

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            version:
                VERSION,

            lifecycle:
                this.lifecycle,

            initialized:
                this.initialized,

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            lastError:
                this.lastError,

            components: {

                authentication:
                    invokeOptionalSync(
                        this.authService,
                        'capabilities'
                    ),

                credentials:
                    invokeOptionalSync(
                        this.credentialManager,
                        'stats'
                    ),

                tokens:
                    invokeOptionalSync(
                        this.tokenManager,
                        'stats'
                    ),

                refresh:
                    invokeOptionalSync(
                        this.refreshManager,
                        'stats'
                    ),

                idempotency:
                    invokeOptionalSync(
                        this.idempotencyManager,
                        'stats'
                    ),

                health:
                    invokeOptionalSync(
                        this.healthMonitor,
                        'snapshot'
                    )

            }

        };

    }

    /**
     * =========================================================================
     * Component Access
     * =========================================================================
     */

    getComponents() {

        return this.components;

    }

    /**
     * =========================================================================
     * Graceful Shutdown
     * =========================================================================
     */

    async shutdown({

        reason = 'application_shutdown',

        correlationId =
            crypto.randomUUID()

    } = {}) {

        if (
            this.lifecycle ===
            LIFECYCLE_STATUS.STOPPED
        ) {

            return true;

        }

        if (this.shutdownPromise) {

            return this.shutdownPromise;

        }

        this.shutdownPromise =
            this._shutdown({

                reason,

                correlationId

            });

        try {

            return await this.shutdownPromise;

        }

        finally {

            this.shutdownPromise =
                null;

        }

    }

    /**
     * =========================================================================
     * Internal Shutdown
     * =========================================================================
     */

    async _shutdown({

        reason,

        correlationId

    }) {

        this.lifecycle =
            LIFECYCLE_STATUS.STOPPING;

        try {

            /**
             * Shutdown in reverse dependency order.
             */

            await invokeOptional(
                this.healthMonitor,
                'shutdown'
            );

            await invokeOptional(
                this.authService,
                'shutdown'
            );

            await invokeOptional(
                this.oauthClient,
                'shutdown'
            );

            await invokeOptional(
                this.refreshManager,
                'shutdown'
            );

            await invokeOptional(
                this.idempotencyManager,
                'shutdown'
            );

            await invokeOptional(
                this.tokenManager,
                'shutdown'
            );

            await invokeOptional(
                this.credentialManager,
                'shutdown'
            );

            await invokeOptional(
                this.observability,
                'shutdown'
            );

            this.initialized =
                false;

            this.lifecycle =
                LIFECYCLE_STATUS.STOPPED;

            this.metrics?.counter?.(
                'payment_airtel_auth_module_shutdown_total'
            );

            this.logger?.info?.({

                message:
                    'Airtel authentication module stopped',

                provider:
                    PROVIDER,

                module:
                    MODULE_NAME,

                reason,

                correlationId

            });

            await this.auditService?.record?.({

                action:
                    'AIRTEL_AUTH_MODULE_SHUTDOWN',

                provider:
                    PROVIDER,

                reason,

                correlationId

            });

            return true;

        }

        catch (error) {

            this.lifecycle =
                LIFECYCLE_STATUS.FAILED;

            this.lastError =
                this.sanitizeError(error);

            this.logger?.error?.({

                message:
                    'Airtel authentication module shutdown failed',

                provider:
                    PROVIDER,

                correlationId,

                error:
                    this.lastError

            });

            throw error;

        }

    }

    /**
     * =========================================================================
     * Error Sanitization
     * =========================================================================
     */

    sanitizeError(error) {

        if (!error) {

            return null;

        }

        /**
         * Prefer enterprise error serializers where available.
         */

        if (
            typeof error.toJSON ===
            'function'
        ) {

            try {

                const serialized =
                    error.toJSON();

                if (
                    serialized &&
                    typeof serialized === 'object'
                ) {

                    return this.redactSensitiveFields(
                        serialized
                    );

                }

            }

            catch (_) {

                // Fall through to generic serialization.

            }

        }

        return this.redactSensitiveFields({

            name:
                error.name,

            message:
                error.message,

            code:
                error.code,

            statusCode:
                error.statusCode

        });

    }

    /**
     * =========================================================================
     * Sensitive Data Redaction
     * =========================================================================
     */

    redactSensitiveFields(value) {

        if (
            value === null ||
            value === undefined
        ) {

            return value;

        }

        if (
            typeof value !== 'object'
        ) {

            return value;

        }

        if (Array.isArray(value)) {

            return value.map(
                item =>
                    this.redactSensitiveFields(item)
            );

        }

        const sensitive =
            new Set([

                'clientSecret',
                'client_secret',

                'accessToken',
                'access_token',

                'refreshToken',
                'refresh_token',

                'authorization',
                'Authorization',

                'password',

                'secret',

                'token'

            ]);

        const result = {};

        for (
            const [
                key,
                item
            ] of Object.entries(value)
        ) {

            if (
                sensitive.has(key)
            ) {

                result[key] =
                    '[REDACTED]';

                continue;

            }

            result[key] =
                this.redactSensitiveFields(item);

        }

        return result;

    }

    /**
     * =========================================================================
     * Capabilities
     * =========================================================================
     */

    capabilities() {

        return Object.freeze({

            provider:
                PROVIDER,

            module:
                MODULE_NAME,

            version:
                VERSION,

            oauth:
                true,

            tokenCaching:
                true,

            tokenRefresh:
                true,

            credentialManagement:
                true,

            credentialRotation:
                true,

            idempotency:
                true,

            healthMonitoring:
                true,

            readiness:
                true,

            liveness:
                true,

            observability:
                !!this.observability,

            metrics:
                !!this.metrics,

            tracing:
                !!this.tracer,

            audit:
                !!this.auditService,

            distributedCache:
                !!this.cache,

            secretProvider:
                !!this.secretProvider,

            multiTenant:
                true

        });

    }

}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 *
 * Backward-compatible factory.
 *
 * Existing callers can continue using:
 *
 *   createAirtelAuth({...})
 *
 * The returned object exposes the original component properties while also
 * exposing the enterprise composition root.
 */

function createAirtelAuth(options = {}) {

    const module =
        new AirtelAuthenticationModule(
            options
        );

    return {

        module,

        authService:
            module.authService,

        oauthClient:
            module.oauthClient,

        credentialManager:
            module.credentialManager,

        tokenManager:
            module.tokenManager,

        refreshManager:
            module.refreshManager,

        idempotencyManager:
            module.idempotencyManager,

        healthMonitor:
            module.healthMonitor,

        observability:
            module.observability,

        /**
         * Lifecycle helpers.
         */

        initialize:
            options.autoInitialize === false
                ? module.initialize.bind(module)
                : module.initialize.bind(module),

        shutdown:
            module.shutdown.bind(module),

        health:
            module.health.bind(module),

        readiness:
            module.readiness.bind(module),

        liveness:
            module.liveness.bind(module),

        stats:
            module.stats.bind(module),

        snapshot:
            module.snapshot.bind(module),

        capabilities:
            module.capabilities.bind(module),

        /**
         * Authentication API.
         */

        authenticate:
            module.authenticate.bind(module),

        getAccessToken:
            module.getAccessToken.bind(module),

        refreshToken:
            module.refreshToken.bind(module),

        invalidate:
            module.invalidate.bind(module),

        rotateCredentials:
            module.rotateCredentials.bind(module)

    };

}

/**
 * ============================================================================
 * Default component-level exports
 * ============================================================================
 *
 * These preserve compatibility with consumers importing individual classes.
 * ============================================================================
 */

module.exports = {

    /**
     * Composition root.
     */

    AirtelAuthenticationModule,

    createAirtelAuth,

    /**
     * Components.
     */

    AuthService,

    OAuthClient,

    CredentialManager,

    TokenManager,

    RefreshManager,

    IdempotencyManager,

    HealthMonitor,

    AirtelAuthObservability,

    /**
     * Metadata.
     */

    MODULE_NAME,

    PROVIDER,

    VERSION,

    LIFECYCLE_STATUS,

    /**
     * Constants.
     */

    authConstants

};