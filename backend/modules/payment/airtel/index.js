'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Payment Module
 * =============================================================================
 *
 * Public entry point for the Airtel Money provider.
 *
 * Responsibilities
 * ----------------
 * • Centralized dependency composition
 * • Provider service initialization
 * • Health aggregation
 * • Graceful shutdown
 * • Lazy singleton creation
 * • Dependency injection support
 * • Enterprise observability hooks
 *
 * This file intentionally contains NO business logic.
 *
 * =============================================================================
 */

const AuthService = require('./auth/authService');

let CollectionsService;
let DisbursementService;
let CallbackService;
let SettlementService;
let ReconciliationService;

try {
    CollectionsService = require('./collections');
} catch (_) {}

try {
    DisbursementService = require('./disbursements');
} catch (_) {}

try {
    CallbackService = require('./callbacks');
} catch (_) {}

try {
    SettlementService = require('./settlement');
} catch (_) {}

try {
    ReconciliationService = require('./reconciliation');
} catch (_) {}

class AirtelPaymentModule {

    constructor(dependencies = {}) {

        this.dependencies = Object.freeze({
            ...dependencies
        });

        this.startedAt = new Date();

        this.initialized = false;

        this.logger = dependencies.logger;

        this.metrics = dependencies.metrics;

        this.tracer = dependencies.tracer;

        this.services = {};
    }

    /**
     * -------------------------------------------------------------------------
     * Initialize Module
     * -------------------------------------------------------------------------
     */
    async initialize() {

        if (this.initialized) {
            return this;
        }

        this.services.auth =
            this.createService(
                AuthService,
                this.dependencies
            );

        this.services.collections =
            this.createService(
                CollectionsService,
                this.dependencies
            );

        this.services.disbursements =
            this.createService(
                DisbursementService,
                this.dependencies
            );

        this.services.callbacks =
            this.createService(
                CallbackService,
                this.dependencies
            );

        this.services.settlement =
            this.createService(
                SettlementService,
                this.dependencies
            );

        this.services.reconciliation =
            this.createService(
                ReconciliationService,
                this.dependencies
            );

        for (const service of Object.values(this.services)) {

            if (service?.initialize) {
                await service.initialize();
            }

        }

        this.initialized = true;

        this.metrics?.counter?.(
            'payment_airtel_module_initialized_total'
        );

        this.logger?.info?.({
            message: 'Airtel payment module initialized'
        });

        return this;
    }

    /**
     * -------------------------------------------------------------------------
     * Service Accessors
     * -------------------------------------------------------------------------
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
     * -------------------------------------------------------------------------
     * Aggregate Health
     * -------------------------------------------------------------------------
     */
    async health() {

        const services = {};

        for (const [name, service] of Object.entries(this.services)) {

            if (!service) {
                continue;
            }

            if (typeof service.health === 'function') {

                try {

                    services[name] =
                        await service.health();

                } catch (error) {

                    services[name] = {
                        status: 'DOWN',
                        error: error.message
                    };

                }

            } else {

                services[name] = {
                    status: 'UNKNOWN'
                };

            }

        }

        const overallStatus =
            Object.values(services).some(
                s => s.status === 'DOWN'
            )
                ? 'DEGRADED'
                : 'UP';

        return {

            provider: 'AIRTEL',

            module: 'payment',

            status: overallStatus,

            initialized: this.initialized,

            startedAt: this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            services

        };

    }

    /**
     * -------------------------------------------------------------------------
     * Shutdown
     * -------------------------------------------------------------------------
     */
    async shutdown() {

        for (const service of Object.values(this.services)) {

            if (service?.shutdown) {

                await service.shutdown();

            }

        }

        this.initialized = false;

        this.logger?.info?.({
            message: 'Airtel payment module stopped'
        });

    }

    /**
     * -------------------------------------------------------------------------
     * Internal Factory
     * -------------------------------------------------------------------------
     */
    createService(Service, dependencies) {

        if (!Service) {
            return null;
        }

        if (typeof Service === 'function') {

            return new Service(dependencies);

        }

        return Service;

    }

}

/**
 * =============================================================================
 * Enterprise Factory
 * =============================================================================
 */

function createAirtelPaymentModule(dependencies = {}) {

    return new AirtelPaymentModule(dependencies);

}

/**
 * Lazy singleton for applications that only need one instance.
 */
let singleton = null;

function getAirtelPaymentModule(dependencies = {}) {

    if (!singleton) {

        singleton =
            createAirtelPaymentModule(dependencies);

    }

    return singleton;

}

module.exports = {

    AirtelPaymentModule,

    createAirtelPaymentModule,

    getAirtelPaymentModule,

    AuthService,

    CollectionsService,

    DisbursementService,

    CallbackService,

    SettlementService,

    ReconciliationService

};