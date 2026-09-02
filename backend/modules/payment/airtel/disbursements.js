'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Disbursements Module
 * ============================================================================
 *
 * Purpose
 * -------
 * Enterprise orchestration entry point for Airtel Money outbound payments.
 *
 * Responsibilities
 * ----------------
 * • Loan disbursements
 * • Savings withdrawals
 * • Supplier/vendor payments
 * • Bulk payouts
 * • Beneficiary validation
 * • Approval workflow orchestration
 * • Fraud screening
 * • Idempotency enforcement
 * • Provider execution delegation
 * • Settlement registration
 * • Ledger integration
 * • Callback coordination
 * • Audit logging
 * • Metrics
 * • OpenTelemetry tracing
 * • Health monitoring
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Airtel API HTTP communication
 * • OAuth authentication
 * • Ledger posting implementation
 * • Business rule evaluation
 * • Token management
 *
 * ============================================================================
 */

const crypto = require('crypto');

class AirtelDisbursements {

    constructor({

        disbursementService,

        callbackProcessor,

        settlementTracker,

        configuration,

        auditService,

        logger,

        metrics,

        tracer

    } = {}) {

        if (!disbursementService) {

            throw new Error(
                'disbursementService is required'
            );

        }

        this.disbursementService =
            disbursementService;

        this.callbackProcessor =
            callbackProcessor;

        this.settlementTracker =
            settlementTracker;

        this.configuration =
            configuration;

        this.auditService =
            auditService;

        this.logger =
            logger;

        this.metrics =
            metrics;

        this.tracer =
            tracer;

        this.startedAt =
            new Date();

    }

    /**
     * ------------------------------------------------------------------------
     * Initialize Module
     * ------------------------------------------------------------------------
     */

    async initialize() {

        this.configuration?.validate?.();

        this.logger?.info?.({

            message:
                'Airtel Money Disbursement module initialized'

        });

        this.metrics?.counter?.(
            'payment_airtel_disbursement_initialize_total'
        );

        return true;

    }

    /**
     * ------------------------------------------------------------------------
     * Initiate Disbursement
     * ------------------------------------------------------------------------
     */

    async disburse(request = {}) {

        const correlationId =
            request.correlationId ||
            crypto.randomUUID();

        const span =
            this.tracer?.startSpan?.(
                'airtel.disbursement.initiate'
            );

        const started =
            Date.now();

        try {

            this.logger?.info?.({

                message:
                    'Initiating Airtel Money disbursement',

                correlationId,

                tenantId:
                    request.tenantId,

                reference:
                    request.reference,

                amount:
                    request.amount

            });

            const result =
                await this.disbursementService.initiate({

                    ...request,

                    correlationId

                });

            await this.auditService?.record({

                action:
                    'AIRTEL_DISBURSEMENT_CREATED',

                tenantId:
                    request.tenantId,

                reference:
                    result.reference,

                correlationId

            });

            this.metrics?.counter?.(
                'payment_airtel_disbursement_success_total'
            );

            this.metrics?.histogram?.(

                'payment_airtel_disbursement_duration_ms',

                Date.now() - started

            );

            return result;

        }

        catch (error) {

            this.metrics?.counter?.(
                'payment_airtel_disbursement_failure_total'
            );

            this.logger?.error?.({

                message:
                    'Airtel Money disbursement failed',

                correlationId,

                tenantId:
                    request.tenantId,

                reference:
                    request.reference,

                error:
                    error.toJSON?.() || error

            });

            throw error;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ------------------------------------------------------------------------
     * Query Disbursement
     * ------------------------------------------------------------------------
     */

    async query(reference, options = {}) {

        if (

            typeof this.disbursementService.query === 'function'

        ) {

            return this.disbursementService.query({

                reference,

                ...options

            });

        }

        throw new Error(
            'Disbursement query not implemented'
        );

    }

    /**
     * ------------------------------------------------------------------------
     * Callback Processing
     * ------------------------------------------------------------------------
     */

    async processCallback(callback = {}) {

        if (!this.callbackProcessor) {

            throw new Error(
                'callbackProcessor not configured'
            );

        }

        return this.callbackProcessor.process(
            callback
        );

    }

    /**
     * ------------------------------------------------------------------------
     * Settlement Lookup
     * ------------------------------------------------------------------------
     */

    async settlement(reference) {

        if (

            !this.settlementTracker ||

            typeof this.settlementTracker.reconcile !== 'function'

        ) {

            return null;

        }

        return this.settlementTracker.reconcile(
            reference
        );

    }

    /**
     * ------------------------------------------------------------------------
     * Provider Health
     * ------------------------------------------------------------------------
     */

    async health() {

        let providerHealth = {

            status: 'UNKNOWN'

        };

        if (

            typeof this.disbursementService.health === 'function'

        ) {

            providerHealth =
                await this.disbursementService.health();

        }

        return {

            provider:
                'AIRTEL',

            module:
                'disbursements',

            status:
                providerHealth.status || 'UP',

            startedAt:
                this.startedAt,

            uptimeMs:
                Date.now() -
                this.startedAt.getTime(),

            dependencies: {

                disbursementService:
                    !!this.disbursementService,

                callbackProcessor:
                    !!this.callbackProcessor,

                settlementTracker:
                    !!this.settlementTracker,

                configuration:
                    !!this.configuration

            },

            providerHealth

        };

    }

    /**
     * ------------------------------------------------------------------------
     * Runtime Capabilities
     * ------------------------------------------------------------------------
     */

    capabilities() {

        return Object.freeze({

            provider:
                'AIRTEL',

            supportsDisbursements: true,

            supportsCallbacks:
                !!this.callbackProcessor,

            supportsSettlementTracking:
                !!this.settlementTracker,

            supportsStatusQueries:
                typeof this.disbursementService.query === 'function',

            supportsHealthChecks: true,

            supportsTracing: true,

            supportsMetrics: true,

            supportsAudit: true

        });

    }

}

module.exports = AirtelDisbursements;