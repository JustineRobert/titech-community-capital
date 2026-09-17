'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Payment Module
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/index.js
 *
 * Architectural Role
 * ------------------
 * Canonical composition root and public entry point for the Airtel Money
 * provider integration.
 *
 * This module is responsible for composing provider-facing application
 * services and managing their lifecycle. It deliberately contains no payment
 * business rules and no provider HTTP implementation.
 *
 * Provider Composition
 * --------------------
 *
 *   AirtelPaymentModule
 *          │
 *          ├── authentication
 *          ├── collections
 *          ├── disbursements
 *          ├── callbacks
 *          ├── settlement
 *          └── reconciliation
 *
 * The individual modules own their respective application boundaries.
 *
 * Responsibilities
 * ----------------
 * • Centralized Airtel dependency composition.
 * • Dependency injection and override support.
 * • Service initialization orchestration.
 * • Single-flight initialization.
 * • Aggregate provider health reporting.
 * • Graceful reverse-order shutdown.
 * • Lazy singleton creation.
 * • Singleton replacement/reset support for tests and controlled runtime use.
 * • Provider capability discovery.
 * • Enterprise metrics, logging and tracing hooks.
 * • Safe lifecycle state management.
 *
 * Does NOT:
 * ----------
 * • Execute Airtel HTTP requests directly.
 * • Manage OAuth credentials directly.
 * • Implement collection business rules.
 * • Implement disbursement business rules.
 * • Process callbacks directly.
 * • Reconcile transactions directly.
 * • Post ledger entries directly.
 * • Modify balances directly.
 * • Treat module initialization as proof that Airtel production connectivity
 *   has been verified.
 *
 * Security Principles
 * -------------------
 * • Provider secrets remain inside their dedicated credential/auth boundaries.
 * • Health and diagnostics do not expose credentials or tokens.
 * • A missing critical provider service must not be silently ignored.
 * • Dependency injection takes precedence over default constructors.
 * • Lifecycle errors propagate instead of producing false readiness.
 *
 * Module Format
 * -------------
 * CommonJS.
 *
 * =============================================================================
 */

const crypto = require('crypto');


const PROVIDER = 'AIRTEL';

const MODULE_STATUS = Object.freeze({
    CREATED: 'CREATED',
    INITIALIZING: 'INITIALIZING',
    READY: 'READY',
    DEGRADED: 'DEGRADED',
    FAILED: 'FAILED',
    SHUTTING_DOWN: 'SHUTTING_DOWN',
    STOPPED: 'STOPPED'
});


const SERVICE_ORDER = Object.freeze([
    'auth',
    'collections',
    'disbursements',
    'callbacks',
    'settlement',
    'reconciliation'
]);


const REQUIRED_SERVICES = Object.freeze([
    'auth',
    'collections',
    'disbursements',
    'callbacks',
    'settlement',
    'reconciliation'
]);


function isFunction(value) {
    return typeof value === 'function';
}


function isObject(value) {
    return (
        value !== null &&
        typeof value === 'object'
    );
}


function generateId() {
    return crypto.randomUUID();
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


function normalizeServiceHealth(
    value
) {
    if (!isObject(value)) {
        return {
            status:
                'UNKNOWN'
        };
    }

    const allowed =
        new Set([
            'UP',
            'DOWN',
            'DEGRADED',
            'UNKNOWN',
            'AVAILABLE',
            'NOT_CONFIGURED'
        ]);

    const status =
        String(
            value.status ||
            'UNKNOWN'
        )
            .trim()
            .toUpperCase();

    return {
        ...value,
        status:
            allowed.has(status)
                ? status
                : 'UNKNOWN'
    };
}


class AirtelPaymentModule {

    constructor(dependencies = {}) {
        if (
            !isObject(
                dependencies
            )
        ) {
            throw new TypeError(
                'Airtel payment module dependencies must be an object'
            );
        }

        this.dependencies = {
            ...dependencies
        };

        this.logger =
            dependencies.logger;

        this.metrics =
            dependencies.metrics;

        this.tracer =
            dependencies.tracer;

        this.auditService =
            dependencies.auditService;

        this.eventPublisher =
            dependencies.eventPublisher;

        this.startedAt =
            new Date();

        this.initialized =
            false;

        this.initializing =
            false;

        this.shuttingDown =
            false;

        this.status =
            MODULE_STATUS.CREATED;

        this.initializedAt =
            null;

        this.stoppedAt =
            null;

        this.lastFailureAt =
            null;

        this.lastFailure =
            null;

        this.services = {};

        this.initializationPromise =
            null;

        this.shutdownPromise =
            null;

        this.statistics = {
            initializationAttempts:
                0,

            initializationSuccesses:
                0,

            initializationFailures:
                0,

            shutdownAttempts:
                0,

            shutdownFailures:
                0
        };
    }


    /**
     * =========================================================================
     * Initialize Module
     * =========================================================================
     */
    async initialize(options = {}) {
        if (
            this.initialized
        ) {
            return this;
        }

        if (
            this.initializing &&
            this.initializationPromise
        ) {
            return this.initializationPromise;
        }

        if (
            this.shuttingDown
        ) {
            throw this.createLifecycleError(
                'AIRTEL_MODULE_SHUTTING_DOWN',
                'Airtel payment module is shutting down'
            );
        }

        this.initializationPromise =
            this.initializeInternal({
                ...options,
                operationId:
                    options.operationId ||
                    generateId()
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
        context = {}
    } = {}) {
        this.initializing =
            true;

        this.status =
            MODULE_STATUS.INITIALIZING;

        this.statistics.initializationAttempts++;

        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.initialize'
            );

        try {
            /**
             * Build the entire dependency graph first. This prevents a
             * partially constructed provider from being exposed as ready.
             */
            this.composeServices();

            this.validateServiceGraph();

            /**
             * Initialize in dependency order.
             */
            for (
                const name
                of SERVICE_ORDER
            ) {
                const service =
                    this.services[name];

                if (
                    !service
                ) {
                    continue;
                }

                if (
                    isFunction(
                        service.initialize
                    )
                ) {
                    await service.initialize({
                        correlationId,
                        operationId,
                        context,
                        provider:
                            PROVIDER
                    });
                }
            }

            this.initialized =
                true;

            this.initializing =
                false;

            this.shuttingDown =
                false;

            this.status =
                MODULE_STATUS.READY;

            this.initializedAt =
                new Date();

            this.stoppedAt =
                null;

            this.lastFailure =
                null;

            this.statistics.initializationSuccesses++;

            this.metrics?.increment?.(
                'payment_airtel_module_initialized_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_module_initialized_total'
            );

            this.logger?.info?.({
                message:
                    'Airtel payment module initialized',
                provider:
                    PROVIDER,
                operationId,
                correlationId,
                services:
                    SERVICE_ORDER
            });

            await this.recordAudit({
                action:
                    'AIRTEL_PAYMENT_MODULE_INITIALIZED',
                correlationId,
                operationId
            });

            return this;
        } catch (error) {
            this.initializing =
                false;

            this.initialized =
                false;

            this.status =
                MODULE_STATUS.FAILED;

            this.lastFailureAt =
                new Date();

            this.lastFailure =
                safeError(error);

            this.statistics.initializationFailures++;

            this.metrics?.increment?.(
                'payment_airtel_module_initialization_failure_total'
            );

            this.metrics?.counter?.(
                'payment_airtel_module_initialization_failure_total'
            );

            this.logger?.error?.({
                message:
                    'Airtel payment module initialization failed',
                provider:
                    PROVIDER,
                operationId,
                correlationId,
                error:
                    safeError(error)
            });

            await this.recordAudit({
                action:
                    'AIRTEL_PAYMENT_MODULE_INITIALIZATION_FAILED',
                correlationId,
                operationId,
                metadata: {
                    error:
                        safeError(error)
                }
            });

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Compose Provider Services
     * =========================================================================
     */
    composeServices() {
        /**
         * Services already injected by the application are authoritative.
         * This permits tests, alternate implementations and controlled
         * infrastructure composition without another parallel architecture.
         */

        this.services.auth =
            this.resolveService(
                this.dependencies.auth,
                this.dependencies.AuthService,
                'auth'
            );

        this.services.collections =
            this.resolveService(
                this.dependencies.collections,
                this.dependencies.CollectionsService,
                'collections'
            );

        this.services.disbursements =
            this.resolveService(
                this.dependencies.disbursements,
                this.dependencies.DisbursementService,
                'disbursements'
            );

        this.services.callbacks =
            this.resolveService(
                this.dependencies.callbacks,
                this.dependencies.CallbackService,
                'callbacks'
            );

        this.services.settlement =
            this.resolveService(
                this.dependencies.settlement,
                this.dependencies.SettlementService,
                'settlement'
            );

        this.services.reconciliation =
            this.resolveService(
                this.dependencies.reconciliation,
                this.dependencies.ReconciliationService,
                'reconciliation'
            );

        return this.services;
    }


    /**
     * =========================================================================
     * Resolve Service
     * =========================================================================
     */
    resolveService(
        injected,
        Constructor,
        name
    ) {
        if (
            injected
        ) {
            return injected;
        }

        if (
            !Constructor
        ) {
            return null;
        }

        if (
            isFunction(
                Constructor
            )
        ) {
            return new Constructor(
                this.dependencies
            );
        }

        if (
            isObject(
                Constructor
            )
        ) {
            return Constructor;
        }

        throw this.createLifecycleError(
            'AIRTEL_SERVICE_INVALID',
            `Invalid Airtel ${name} service`
        );
    }


    /**
     * =========================================================================
     * Service Graph Validation
     * =========================================================================
     */
    validateServiceGraph() {
        const missing =
            REQUIRED_SERVICES.filter(
                name =>
                    !this.services[name]
            );

        if (
            missing.length
        ) {
            const error =
                this.createLifecycleError(
                    'AIRTEL_REQUIRED_SERVICE_MISSING',
                    `Required Airtel services are unavailable: ${missing.join(', ')}`
                );

            error.services =
                missing;

            throw error;
        }

        /**
         * Every composed service must at least be an object with a coherent
         * lifecycle surface. Business-specific method validation remains inside
         * each module.
         */
        for (
            const name
            of SERVICE_ORDER
        ) {
            const service =
                this.services[name];

            if (
                !isObject(service) &&
                !isFunction(service)
            ) {
                const error =
                    this.createLifecycleError(
                        'AIRTEL_SERVICE_INVALID',
                        `Airtel service "${name}" is invalid`
                    );

                error.service =
                    name;

                throw error;
            }
        }

        return true;
    }


    /**
     * =========================================================================
     * Service Accessors
     * =========================================================================
     */
    get auth() {
        return this.services.auth;
    }

    get collections() {
        return this.services.collections;
    }

    get disbursements() {
        return this.services.disbursements;
    }

    get callbacks() {
        return this.services.callbacks;
    }

    get settlement() {
        return this.services.settlement;
    }

    get reconciliation() {
        return this.services.reconciliation;
    }


    /**
     * =========================================================================
     * Aggregate Health
     * =========================================================================
     */
    async health() {
        const services = {};

        for (
            const name
            of SERVICE_ORDER
        ) {
            const service =
                this.services[name];

            if (
                !service
            ) {
                services[name] = {
                    status:
                        'NOT_CONFIGURED'
                };

                continue;
            }

            if (
                !isFunction(
                    service.health
                )
            ) {
                services[name] = {
                    status:
                        'UNKNOWN'
                };

                continue;
            }

            try {
                services[name] =
                    normalizeServiceHealth(
                        await service.health()
                    );
            } catch (error) {
                services[name] = {
                    status:
                        'DOWN',
                    error:
                        safeError(error)
                };
            }
        }

        const statuses =
            Object.values(
                services
            ).map(
                service =>
                    service.status
            );

        const missingRequired =
            REQUIRED_SERVICES.some(
                name =>
                    !this.services[name]
            );

        const hasDown =
            statuses.includes(
                'DOWN'
            );

        const hasDegraded =
            statuses.some(
                status =>
                    status ===
                        'DEGRADED' ||
                    status ===
                        'UNKNOWN' ||
                    status ===
                        'NOT_CONFIGURED'
            );

        let overallStatus;

        if (
            hasDown
        ) {
            overallStatus =
                'DOWN';
        } else if (
            missingRequired ||
            hasDegraded ||
            !this.initialized
        ) {
            overallStatus =
                'DEGRADED';
        } else {
            overallStatus =
                'UP';
        }

        return {
            provider:
                PROVIDER,

            module:
                'payment',

            status:
                overallStatus,

            lifecycle:
                this.status,

            initialized:
                this.initialized,

            initializing:
                this.initializing,

            shuttingDown:
                this.shuttingDown,

            startedAt:
                this.startedAt,

            initializedAt:
                this.initializedAt,

            stoppedAt:
                this.stoppedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            requiredServices:
                REQUIRED_SERVICES,

            services,

            statistics: {
                ...this.statistics
            },

            lastFailureAt:
                this.lastFailureAt,

            lastFailure:
                this.lastFailure
        };
    }


    /**
     * =========================================================================
     * Capability Discovery
     * =========================================================================
     */
    capabilities() {
        return Object.freeze({
            provider:
                PROVIDER,

            authentication:
                Boolean(
                    this.services.auth
                ),

            collections:
                Boolean(
                    this.services.collections
                ),

            disbursements:
                Boolean(
                    this.services.disbursements
                ),

            callbacks:
                Boolean(
                    this.services.callbacks
                ),

            settlement:
                Boolean(
                    this.services.settlement
                ),

            reconciliation:
                Boolean(
                    this.services.reconciliation
                ),

            initialized:
                this.initialized,

            supportsGracefulShutdown:
                true,

            supportsDependencyInjection:
                true,

            supportsLazySingleton:
                true
        });
    }


    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */
    diagnostics() {
        return {
            provider:
                PROVIDER,

            module:
                'payment',

            lifecycle:
                this.status,

            initialized:
                this.initialized,

            initializing:
                this.initializing,

            shuttingDown:
                this.shuttingDown,

            composedServices:
                SERVICE_ORDER.filter(
                    name =>
                        Boolean(
                            this.services[name]
                        )
                ),

            missingServices:
                REQUIRED_SERVICES.filter(
                    name =>
                        !this.services[name]
                ),

            capabilities:
                this.capabilities(),

            statistics: {
                ...this.statistics
            },

            timestamps: {
                startedAt:
                    this.startedAt,

                initializedAt:
                    this.initializedAt,

                stoppedAt:
                    this.stoppedAt,

                lastFailureAt:
                    this.lastFailureAt
            }
        };
    }


    /**
     * =========================================================================
     * Graceful Shutdown
     * =========================================================================
     *
     * Shutdown is reverse-order relative to initialization so dependencies
     * remain available to downstream components while each child service closes.
     */
    async shutdown(options = {}) {
        if (
            this.shuttingDown &&
            this.shutdownPromise
        ) {
            return this.shutdownPromise;
        }

        if (
            !this.initialized &&
            this.status === MODULE_STATUS.STOPPED
        ) {
            return true;
        }

        const operationId =
            options.operationId ||
            generateId();

        this.shuttingDown =
            true;

        this.status =
            MODULE_STATUS.SHUTTING_DOWN;

        this.statistics.shutdownAttempts++;

        this.shutdownPromise =
            this.shutdownInternal({
                ...options,
                operationId
            })
                .finally(() => {
                    this.shutdownPromise =
                        null;
                });

        return this.shutdownPromise;
    }


    async shutdownInternal({
        operationId,
        correlationId,
        context = {}
    } = {}) {
        const span =
            this.tracer?.startSpan?.(
                'payment.airtel.shutdown'
            );

        try {
            let firstError = null;

            const reverseOrder =
                [...SERVICE_ORDER].reverse();

            for (
                const name
                of reverseOrder
            ) {
                const service =
                    this.services[name];

                if (
                    !service ||
                    !isFunction(
                        service.shutdown
                    )
                ) {
                    continue;
                }

                try {
                    await service.shutdown({
                        correlationId,
                        operationId,
                        context,
                        provider:
                            PROVIDER
                    });
                } catch (error) {
                    firstError ||=
                        error;

                    this.logger?.error?.({
                        message:
                            'Airtel service shutdown failed',
                        provider:
                            PROVIDER,
                        service:
                            name,
                        operationId,
                        correlationId,
                        error:
                            safeError(error)
                    });
                }
            }

            this.initialized =
                false;

            this.initializing =
                false;

            this.shuttingDown =
                false;

            this.status =
                MODULE_STATUS.STOPPED;

            this.stoppedAt =
                new Date();

            if (
                firstError
            ) {
                this.statistics.shutdownFailures++;

                throw firstError;
            }

            this.logger?.info?.({
                message:
                    'Airtel payment module stopped',
                provider:
                    PROVIDER,
                operationId,
                correlationId
            });

            await this.recordAudit({
                action:
                    'AIRTEL_PAYMENT_MODULE_STOPPED',
                correlationId,
                operationId
            });

            return true;
        } catch (error) {
            this.statistics.shutdownFailures++;

            this.status =
                MODULE_STATUS.FAILED;

            this.lastFailureAt =
                new Date();

            this.lastFailure =
                safeError(error);

            throw error;
        } finally {
            span?.end?.();
        }
    }


    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */
    async recordAudit({
        action,
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
                provider:
                    PROVIDER,
                correlationId,
                operationId,
                metadata
            });
        } catch (error) {
            /**
             * Lifecycle audit is auxiliary evidence. Do not overwrite a
             * successful initialization/shutdown solely because observability
             * persistence failed.
             */
            this.logger?.error?.({
                message:
                    'Airtel payment module audit recording failed',
                provider:
                    PROVIDER,
                action,
                correlationId,
                operationId,
                error:
                    safeError(error)
            });
        }
    }


    /**
     * =========================================================================
     * Lifecycle Error
     * =========================================================================
     */
    createLifecycleError(
        code,
        message
    ) {
        const error =
            new Error(message);

        error.code =
            code;

        error.provider =
            PROVIDER;

        return error;
    }
}


/**
 * =============================================================================
 * Enterprise Factory
 * =============================================================================
 *
 * Factory returns a new isolated provider instance. This is preferred for
 * tests, multi-tenant application composition and controlled dependency
 * injection.
 */
function createAirtelPaymentModule(
    dependencies = {}
) {
    return new AirtelPaymentModule(
        dependencies
    );
}


/**
 * =============================================================================
 * Lazy Singleton
 * =============================================================================
 *
 * The singleton is deliberately lazy. Applications that need multiple Airtel
 * provider instances should use createAirtelPaymentModule().
 */
let singleton = null;


function getAirtelPaymentModule(
    dependencies = {}
) {
    if (
        !singleton
    ) {
        singleton =
            createAirtelPaymentModule(
                dependencies
            );
    }

    return singleton;
}


/**
 * =============================================================================
 * Singleton Lifecycle Controls
 * =============================================================================
 *
 * Primarily useful for controlled application teardown and test isolation.
 */
async function shutdownAirtelPaymentModule(
    options = {}
) {
    if (
        !singleton
    ) {
        return true;
    }

    try {
        return await singleton.shutdown(
            options
        );
    } finally {
        singleton =
            null;
    }
}


function resetAirtelPaymentModule() {
    /**
     * Synchronous reset is intentionally only permitted when the singleton is
     * not active. It prevents tests from accidentally abandoning live child
     * resources.
     */
    if (
        singleton?.initialized ||
        singleton?.initializing ||
        singleton?.shuttingDown
    ) {
        throw new Error(
            'Cannot reset active Airtel payment module; call shutdown() first'
        );
    }

    singleton =
        null;

    return true;
}


/**
 * =============================================================================
 * Optional Default Service Exports
 * =============================================================================
 *
 * The original module exported the default constructors. Keep that public API,
 * but resolve them explicitly so a broken module import cannot disappear into
 * an empty catch block.
 */
const AuthService =
    safeRequire(
        './auth/authService',
        'AuthService'
    );

const CollectionsService =
    safeRequire(
        './collections',
        'CollectionsService'
    );

const DisbursementService =
    safeRequire(
        './disbursements',
        'DisbursementService'
    );

const CallbackService =
    safeRequire(
        './callbacks',
        'CallbackService'
    );

const SettlementService =
    safeRequire(
        './settlement',
        'SettlementService'
    );

const ReconciliationService =
    safeRequire(
        './reconciliation',
        'ReconciliationService'
    );


function safeRequire(
    modulePath,
    exportName
) {
    try {
        const imported =
            require(modulePath);

        /**
         * Support both:
         *   module.exports = Class
         * and
         *   module.exports.Class = Class
         */
        if (
            isFunction(imported)
        ) {
            return imported;
        }

        if (
            imported &&
            isFunction(
                imported[exportName]
            )
        ) {
            return imported[exportName];
        }

        /**
         * Preserve object/module exports for dependency injection even when a
         * module intentionally exports a factory/object.
         */
        return imported;
    } catch (error) {
        /**
         * Unlike the original silent catch blocks, malformed provider modules
         * are not swallowed. Fail-fast module loading is safer because a
         * provider integration must not appear healthy while a core service
         * failed to load.
         */
        error.provider =
            PROVIDER;

        error.modulePath =
            modulePath;

        throw error;
    }
}


/**
 * =============================================================================
 * Public API
 * =============================================================================
 */
module.exports = {
    AirtelPaymentModule,

    createAirtelPaymentModule,

    getAirtelPaymentModule,

    shutdownAirtelPaymentModule,

    resetAirtelPaymentModule,

    AuthService,

    CollectionsService,

    DisbursementService,

    CallbackService,

    SettlementService,

    ReconciliationService,

    PROVIDER,

    MODULE_STATUS,

    SERVICE_ORDER
};