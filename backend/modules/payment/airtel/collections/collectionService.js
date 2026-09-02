'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Airtel Money Enterprise Collection Service
 * =============================================================================
 *
 * Purpose
 * -------
 * Enterprise orchestration service responsible for Airtel Money collection
 * operations.
 *
 * Responsibilities
 * ----------------
 * • Collection orchestration
 * • Tenant-aware payment execution
 * • Authentication coordination
 * • Provider communication
 * • Validation
 * • Idempotency
 * • Retry orchestration
 * • Ledger integration
 * • Audit trail
 * • Event publishing
 * • Callback registration
 * • Reconciliation hooks
 * • Settlement hooks
 * • Observability
 * • Health monitoring
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • OAuth implementation
 * • HTTP transport implementation
 * • Database persistence
 * • Ledger implementation
 * • Fraud engine implementation
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    EventEmitter
} = require('events');

const {
    normalizeError,
    ValidationError
} = require('../../../shared/errors');

/**
 * =============================================================================
 * Internal Constants
 * =============================================================================
 */

const PROVIDER = Object.freeze({

    NAME: 'AIRTEL',

    MODULE: 'collections'

});

const SERVICE_STATUS = Object.freeze({

    CREATED: 'CREATED',

    INITIALIZING: 'INITIALIZING',

    READY: 'READY',

    DEGRADED: 'DEGRADED',

    SHUTTING_DOWN: 'SHUTTING_DOWN',

    STOPPED: 'STOPPED'

});

const COLLECTION_STATUS = Object.freeze({

    CREATED: 'CREATED',

    VALIDATING: 'VALIDATING',

    AUTHENTICATING: 'AUTHENTICATING',

    PROCESSING: 'PROCESSING',

    SUCCESS: 'SUCCESS',

    FAILED: 'FAILED',

    REVERSED: 'REVERSED'

});

const DEFAULT_CONFIGURATION = Object.freeze({

    requestTimeout: 30000,

    maxRetries: 3,

    retryDelay: 1000,

    shutdownTimeout: 30000,

    enableTracing: true,

    enableMetrics: true,

    enableAudit: true,

    enableEvents: true,

    enableFraudChecks: true,

    enableLedgerPosting: true,

    enableSettlementHooks: true,

    enableReconciliationHooks: true

});

/**
 * =============================================================================
 * Collection Service
 * =============================================================================
 */

class CollectionService extends EventEmitter {

    constructor({

        configuration,

        authService,

        providerClient,

        validator,

        idempotencyManager,

        retryManager,

        ledgerBridge,

        reconciliationService,

        settlementService,

        callbackRegistry,

        fraudService,

        amlService,

        policyEngine,

        eventBus,

        auditService,

        metrics,

        tracer,

        logger

    } = {}) {

        super();

        this.configuration = configuration;

        this.authService = authService;

        this.providerClient = providerClient;

        this.validator = validator;

        this.idempotencyManager = idempotencyManager;

        this.retryManager = retryManager;

        this.ledgerBridge = ledgerBridge;

        this.reconciliationService = reconciliationService;

        this.settlementService = settlementService;

        this.callbackRegistry = callbackRegistry;

        this.fraudService = fraudService;

        this.amlService = amlService;

        this.policyEngine = policyEngine;

        this.eventBus = eventBus;

        this.auditService = auditService;

        this.metrics = metrics;

        this.tracer = tracer;

        this.logger = logger;

        this.runtime = {

            configuration: {

                ...DEFAULT_CONFIGURATION,

                ...(configuration?.collections || {})

            },

            initialized: false,

            startedAt: null,

            lastInitialization: null,

            lastActivity: null,

            shutdownRequested: false,

            activeCollections: new Map(),

            correlationMap: new Map()

        };

        this.health = {

            status: SERVICE_STATUS.CREATED,

            provider: PROVIDER.NAME,

            module: PROVIDER.MODULE,

            readiness: false,

            liveness: true,

            lastSuccessfulOperation: null,

            lastFailure: null,

            lastHealthCheck: null,

            dependencies: {

                authentication: 'UNKNOWN',

                provider: 'UNKNOWN',

                ledger: 'UNKNOWN',

                reconciliation: 'UNKNOWN',

                settlement: 'UNKNOWN',

                callbackRegistry: 'UNKNOWN',

                eventBus: 'UNKNOWN'

            }

        };

        this.statistics = {

            initializedAt: null,

            collectionsStarted: 0,

            collectionsCompleted: 0,

            collectionsSucceeded: 0,

            collectionsFailed: 0,

            validationFailures: 0,

            authenticationFailures: 0,

            idempotentReplays: 0,

            retriesExecuted: 0,

            providerFailures: 0,

            ledgerPosts: 0,

            reconciliationRequests: 0,

            settlementRequests: 0,

            callbacksRegistered: 0,

            auditEvents: 0,

            eventsPublished: 0,

            uptimeMs: 0

        };
    }

    /**
     * =========================================================================
     * Initialize Service
     * =========================================================================
     */

    async initialize() {

        if (this.runtime.initialized) {

            return this;
        }



        this.health.status = SERVICE_STATUS.INITIALIZING;

        const correlationId = crypto.randomUUID();

        const started = Date.now();

        try {

            this.logger?.info?.({

                message: 'Initializing Airtel Collection Service',

                correlationId

            });



            await this.validateConfiguration();

            await this.validateDependencies();

            await this.verifyProviderReadiness();

            this.runtime.initialized = true;

            this.runtime.startedAt = new Date();

            this.runtime.lastInitialization = new Date();

            this.health.status = SERVICE_STATUS.READY;

            this.health.readiness = true;

            this.statistics.initializedAt = new Date();

            this.metrics?.counter?.(

                'payment_airtel_collection_service_initializations_total'

            );

            this.metrics?.histogram?.(

                'payment_airtel_collection_initialization_duration_ms',

                Date.now() - started

            );

            this.eventBus?.publish?.({

                type: 'AIRTEL_COLLECTION_SERVICE_INITIALIZED',

                correlationId,

                timestamp: new Date()

            });

            this.logger?.info?.({

                message: 'Airtel Collection Service initialized',

                correlationId

            });

            return this;

        }

        catch (error) {

            this.health.status = SERVICE_STATUS.DEGRADED;

            this.health.lastFailure = new Date();

            this.logger?.error?.({

                message: 'Collection Service initialization failed',

                correlationId,

                error

            });

            throw normalizeError(error);

        }

    }

    /**
     * =========================================================================
     * Configuration Validation
     * =========================================================================
     */

    async validateConfiguration() {

        if (!this.configuration) {

            throw new ValidationError(

                'Configuration is required.'

            );

        }

        if (typeof this.configuration.validate === 'function') {

            await this.configuration.validate();

        }

        return true;

    }

    /**
     * =========================================================================
     * Dependency Validation
     * =========================================================================
     */

    async validateDependencies() {

        const required = [

            ['authService', this.authService],

            ['providerClient', this.providerClient],

            ['validator', this.validator],

            ['idempotencyManager', this.idempotencyManager],

            ['retryManager', this.retryManager]

        ];

        for (const [name, dependency] of required) {

            if (!dependency) {

                throw new ValidationError(

                    `${name} dependency is required.`

                );

            }

        }

        return true;

    }

    /**
     * =========================================================================
     * Provider Readiness Verification
     * =========================================================================
     */

    async verifyProviderReadiness() {

        if (

            this.providerClient &&

            typeof this.providerClient.health === 'function'

        ) {

            const health = await this.providerClient.health();

            this.health.dependencies.provider = health.status;

        } else {

            this.health.dependencies.provider = 'UNKNOWN';

        }

        return true;

    }

    /**
 * =========================================================================
 * Enterprise Collection Execution Pipeline
 * =========================================================================
 */

    /**
     * Initiate Airtel Money Collection
     */
    async collect({

        tenantId,

        amount,

        currency,

        phoneNumber,

        externalReference,

        payer,

        metadata = {},

        idempotencyKey,

        correlationId = crypto.randomUUID()

    }) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.collection.execute'
            );

        const started =
            Date.now();

        this.statistics.collectionsStarted++;

        this.runtime.lastActivity =
            new Date();

        await this.executeSecurityPipeline({
            tenantId,
            amount,
            currency,
            phoneNumber,
            payer,
            metadata,
            externalReference,
            correlationId
        });

        await this.integrateFinancialCore({
            collection: normalized,
            correlationId,
            tenantId
        });

        try {

            /**
             * ------------------------------------------------------------
             * Request Validation
             * ------------------------------------------------------------
             */

            const request =

                await this.validateCollectionRequest({

                    tenantId,

                    amount,

                    currency,

                    phoneNumber,

                    externalReference,

                    payer,

                    metadata,

                    idempotencyKey,

                    correlationId

                });

            /**
             * ------------------------------------------------------------
             * Idempotency
             * ------------------------------------------------------------
             */

            const cached =

                await this.checkIdempotency({

                    tenantId,

                    idempotencyKey,

                    correlationId

                });

            if (cached) {

                this.statistics.idempotentReplays++;

                return cached;

            }


            await this.validateCollectionRequest(request);

            await this.executeSecurityPipeline({

                tenantId,

                amount,

                currency,

                phoneNumber,

                payer,

                metadata,

                externalReference,

                correlationId

            });

            const accessToken = await this.authenticate({
                tenantId,
                correlationId
            });

            /**
             * ------------------------------------------------------------
             * Authentication
             * ------------------------------------------------------------
             */

            const accessToken =

                await this.authenticate({

                    tenantId,

                    correlationId

                });

            /**
             * ------------------------------------------------------------
             * Runtime Tracking
             * ------------------------------------------------------------
             */

            const operation = {

                correlationId,

                tenantId,

                externalReference,

                status:

                    COLLECTION_STATUS.PROCESSING,

                startedAt:

                    new Date()

            };

            this.runtime.activeCollections.set(

                correlationId,

                operation

            );

            /**
             * ------------------------------------------------------------
             * Provider Execution
             * ------------------------------------------------------------
             */

            const providerResponse =
                await this.executeProviderOperation({

                    tenantId,

                    transactionId: externalReference,

                    correlationId,

                    operation: () =>
                        this.providerClient.collect({

                            accessToken,

                            amount,

                            currency,

                            phoneNumber,

                            payer,

                            externalReference,

                            metadata,

                            correlationId

                        })

                });

            /**
             * ------------------------------------------------------------
             * Normalize
             * ------------------------------------------------------------
             */

            const normalized =

                this.normalizeProviderResponse({

                    providerResponse,

                    correlationId,

                    tenantId,

                    amount,

                    currency,

                    externalReference

                });

            /**
             * ------------------------------------------------------------
             * Cache Idempotency
             * ------------------------------------------------------------
             */

            await this.storeIdempotency({

                tenantId,

                idempotencyKey,

                response:

                    normalized

            });

            /**
             * ------------------------------------------------------------
             * Runtime Updates
             * ------------------------------------------------------------
             */

            operation.status =

                COLLECTION_STATUS.SUCCESS;

            operation.completedAt =

                new Date();

            this.statistics.collectionsCompleted++;

            this.statistics.collectionsSucceeded++;

            this.health.lastSuccessfulOperation =

                new Date();

            /**
             * ------------------------------------------------------------
             * Metrics
             * ------------------------------------------------------------
             */

            this.metrics?.counter?.(

                'payment_airtel_collection_success_total'

            );

            this.metrics?.histogram?.(

                'payment_airtel_collection_duration_ms',

                Date.now() - started

            );

            /**
             * ------------------------------------------------------------
             * Audit
             * ------------------------------------------------------------
             */

            await this.auditService?.record?.({

                action:

                    'AIRTEL_COLLECTION_CREATED',

                tenantId,

                correlationId,

                entity:

                    normalized

            });

            /**
             * ------------------------------------------------------------
             * Event
             * ------------------------------------------------------------
             */

            this.eventBus?.publish?.({

                type:

                    'AIRTEL_COLLECTION_COMPLETED',

                correlationId,

                payload:

                    normalized

            });

            return normalized;

        }

        catch (error) {

            this.statistics.collectionsFailed++;

            this.health.lastFailure =

                new Date();

            this.metrics?.counter?.(

                'payment_airtel_collection_failure_total'

            );

            this.logger?.error?.({

                message:

                    'Collection execution failed',

                correlationId,

                tenantId,

                error

            });

            throw normalizeError(error);

        }

        finally {

            this.runtime.activeCollections.delete(

                correlationId

            );

            span?.end?.();

        }

    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    async validateCollectionRequest(request) {

        await this.validator.validateCollection?.(request);

        if (

            !request.amount ||

            Number(request.amount) <= 0

        ) {

            this.statistics.validationFailures++;

            throw new ValidationError(

                'Invalid collection amount.'

            );

        }

        if (!request.phoneNumber) {

            this.statistics.validationFailures++;

            throw new ValidationError(

                'Phone number is required.'

            );

        }

        if (!request.externalReference) {

            throw new ValidationError(

                'External reference is required.'

            );

        }

        return request;

    }

    /**
     * =========================================================================
     * Authentication
     * =========================================================================
     */

    async authenticate({

        tenantId,

        correlationId

    }) {

        const token =

            await this.authService.getAccessToken({

                tenantId,

                correlationId

            });

        if (!token) {

            this.statistics.authenticationFailures++;

            throw new ValidationError(

                'Unable to obtain Airtel access token.'

            );

        }

        return token;

    }

    /**
     * =========================================================================
     * Idempotency
     * =========================================================================
     */

    async checkIdempotency({

        tenantId,

        idempotencyKey,

        correlationId

    }) {

        if (

            !idempotencyKey ||

            !this.idempotencyManager

        ) {

            return null;

        }

        return this.idempotencyManager.check({

            tenantId,

            idempotencyKey,

            correlationId

        });

    }

    async storeIdempotency({

        tenantId,

        idempotencyKey,

        response

    }) {

        if (

            !idempotencyKey ||

            !this.idempotencyManager

        ) {

            return;

        }

        await this.idempotencyManager.store({

            tenantId,

            idempotencyKey,

            response

        });

    }

    /**
     * =========================================================================
     * Provider Response Normalization
     * =========================================================================
     */

    normalizeProviderResponse({

        providerResponse,

        correlationId,

        tenantId,

        amount,

        currency,

        externalReference

    }) {

        return {

            provider:

                PROVIDER.NAME,

            tenantId,

            correlationId,

            status:

                providerResponse.status ||

                COLLECTION_STATUS.SUCCESS,

            transactionId:

                providerResponse.transactionId ||

                providerResponse.reference ||

                null,

            providerReference:

                providerResponse.providerReference ||

                null,

            externalReference,

            amount,

            currency,

            completedAt:

                new Date(),

            raw:

                providerResponse

        };

    }

    /**
 * ============================================================================
 * Part 3 — Financial & Enterprise Integration Layer
 * ============================================================================
 *
 * Responsibilities
 * ----------------
 * • Double-entry ledger posting
 * • Journal creation
 * • Audit completion
 * • Enterprise event publishing
 * • Callback registration
 * • Reconciliation integration
 * • Settlement notification
 * • Financial observability
 * ============================================================================
 */

    /**
     * ---------------------------------------------------------------------------
     * Financial Integration Orchestrator
     * ---------------------------------------------------------------------------
     */

    async integrateFinancialCore({

        collection,

        tenantId,

        correlationId

    }) {

        const span =
            this.tracer?.startSpan?.(
                'airtel.collection.financial.integration'
            );

        try {

            await this.postLedger({

                collection,

                tenantId,

                correlationId

            });

            await this.createJournal({

                collection,

                tenantId,

                correlationId

            });

            await this.completeAudit({

                collection,

                tenantId,

                correlationId

            });

            await this.publishFinancialEvents({

                collection,

                tenantId,

                correlationId

            });

            await this.registerCallbacks({

                collection,

                tenantId,

                correlationId

            });

            await this.triggerReconciliation({

                collection,

                tenantId,

                correlationId

            });

            await this.notifySettlement({

                collection,

                tenantId,

                correlationId

            });

            this.statistics.ledgerPosts++;

            this.statistics.auditEvents++;

            this.statistics.eventsPublished++;

            this.statistics.callbacksRegistered++;

            this.statistics.reconciliationRequests++;

            this.statistics.settlementRequests++;

        }

        finally {

            span?.end?.();

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Ledger Posting
     * ---------------------------------------------------------------------------
     */

    async postLedger({

        collection,

        tenantId,

        correlationId

    }) {

        if (

            !this.runtime.configuration.enableLedgerPosting ||

            !this.ledgerBridge

        ) {

            return;

        }

        await this.ledgerBridge.postCollection({

            tenantId,

            provider: PROVIDER.NAME,

            amount: collection.amount,

            currency: collection.currency,

            transactionId:

                collection.transactionId,

            externalReference:

                collection.externalReference,

            correlationId

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Journal Creation
     * ---------------------------------------------------------------------------
     */

    async createJournal({

        collection,

        tenantId,

        correlationId

    }) {

        if (

            !this.ledgerBridge?.createJournal

        ) {

            return;

        }

        await this.ledgerBridge.createJournal({

            tenantId,

            journalType:

                'AIRTEL_COLLECTION',

            transactionId:

                collection.transactionId,

            providerReference:

                collection.providerReference,

            amount:

                collection.amount,

            currency:

                collection.currency,

            correlationId,

            metadata: {

                provider:

                    PROVIDER.NAME

            }

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Audit Completion
     * ---------------------------------------------------------------------------
     */

    async completeAudit({

        collection,

        tenantId,

        correlationId

    }) {

        if (!this.auditService) {

            return;

        }

        await this.auditService.record({

            action:

                'AIRTEL_COLLECTION_FINANCIAL_POSTED',

            tenantId,

            provider:

                PROVIDER.NAME,

            correlationId,

            entity:

                collection,

            metadata: {

                module:

                    'collections',

                financialPosting:

                    true

            }

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Enterprise Event Publishing
     * ---------------------------------------------------------------------------
     */

    async publishFinancialEvents({

        collection,

        correlationId,

        tenantId

    }) {

        if (

            !this.runtime.configuration.enableEvents ||

            !this.eventBus

        ) {

            return;

        }

        const events = [

            {

                type:

                    'PaymentCollected',

                payload:

                    collection

            },

            {

                type:

                    'LedgerPostingRequested',

                payload:

                    collection

            },

            {

                type:

                    'CollectionCompleted',

                payload:

                    collection

            }

        ];

        for (const event of events) {

            await this.eventBus.publish({

                ...event,

                tenantId,

                correlationId,

                timestamp:

                    new Date()

            });

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Callback Registration
     * ---------------------------------------------------------------------------
     */

    async registerCallbacks({

        collection,

        correlationId,

        tenantId

    }) {

        if (

            !this.callbackRegistry

        ) {

            return;

        }

        await this.callbackRegistry.register({

            provider:

                PROVIDER.NAME,

            transactionId:

                collection.transactionId,

            providerReference:

                collection.providerReference,

            tenantId,

            correlationId,

            expectedEvents: [

                'COLLECTION_COMPLETED',

                'COLLECTION_FAILED',

                'SETTLEMENT_COMPLETED'

            ]

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Reconciliation Integration
     * ---------------------------------------------------------------------------
     */

    async triggerReconciliation({

        collection,

        tenantId,

        correlationId

    }) {

        if (

            !this.runtime.configuration
                .enableReconciliationHooks ||

            !this.reconciliationService

        ) {

            return;

        }

        await this.reconciliationService.enqueue({

            provider:

                PROVIDER.NAME,

            tenantId,

            transactionId:

                collection.transactionId,

            amount:

                collection.amount,

            currency:

                collection.currency,

            correlationId

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Settlement Notification
     * ---------------------------------------------------------------------------
     */

    async notifySettlement({

        collection,

        tenantId,

        correlationId

    }) {

        if (

            !this.runtime.configuration
                .enableSettlementHooks ||

            !this.settlementService

        ) {

            return;

        }

        await this.settlementService.registerCollection({

            provider:

                PROVIDER.NAME,

            tenantId,

            transactionId:

                collection.transactionId,

            amount:

                collection.amount,

            currency:

                collection.currency,

            correlationId

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Financial Snapshot
     * ---------------------------------------------------------------------------
     */

    financialSnapshot() {

        return {

            provider:

                PROVIDER.NAME,

            ledgerPosts:

                this.statistics.ledgerPosts,

            journals:

                this.statistics.ledgerPosts,

            audits:

                this.statistics.auditEvents,

            events:

                this.statistics.eventsPublished,

            callbacks:

                this.statistics.callbacksRegistered,

            reconciliation:

                this.statistics.reconciliationRequests,

            settlement:

                this.statistics.settlementRequests,

            timestamp:

                new Date()

        };

    }

    /**
     * ============================================================================
     * Part 4 — Enterprise Reliability Layer
     * ============================================================================
     *
     * Responsibilities
     * ----------------
     * • Intelligent retry execution
     * • Circuit breaker protection
     * • Provider timeout enforcement
     * • Distributed operation locking
     * • Dead-letter queue publishing
     * • Compensation workflow
     * • Automatic recovery
     * • Failure analytics
     * ============================================================================
     */

    /**
     * ---------------------------------------------------------------------------
     * Execute Protected Provider Operation
     * ---------------------------------------------------------------------------
     */
    async executeProviderOperation({

        operation,

        correlationId,

        tenantId,

        transactionId,

        timeout = this.runtime.configuration.requestTimeout

    }) {

        const started = Date.now();

        const lockKey = `${tenantId}:${transactionId}`;

        await this.acquireOperationLock(lockKey);

        try {

            return await this.executeWithTimeout({

                timeout,

                operation: () =>
                    this.executeWithCircuitBreaker({

                        operation: () =>
                            this.executeWithRetry({

                                operation,

                                correlationId,

                                tenantId

                            }),

                        correlationId,

                        tenantId

                    })

            });

        }

        catch (error) {

            await this.publishDeadLetter({

                correlationId,

                tenantId,

                transactionId,

                error

            });

            await this.executeCompensation({

                correlationId,

                tenantId,

                transactionId,

                error

            });

            throw error;

        }

        finally {

            this.releaseOperationLock(lockKey);

            this.statistics.retriesExecuted +=
                this.retryAttempts || 0;

            this.metrics?.histogram?.(

                'payment_airtel_collection_execution_duration_ms',

                Date.now() - started

            );

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Retry Policy
     * ---------------------------------------------------------------------------
     */

    async executeWithRetry({

        operation,

        correlationId,

        tenantId

    }) {

        const retries =
            this.runtime.configuration.maxRetries;

        let attempt = 0;

        let lastError;

        while (attempt <= retries) {

            try {

                return await operation();

            }

            catch (error) {

                lastError = error;

                attempt++;

                if (attempt > retries) {

                    break;

                }

                this.logger?.warn?.({

                    message:

                        'Retrying Airtel collection',

                    correlationId,

                    tenantId,

                    attempt

                });

                this.metrics?.counter?.(

                    'payment_airtel_collection_retry_total'

                );

                await this.sleep(

                    this.runtime.configuration.retryDelay *

                    Math.pow(2, attempt - 1)

                );

            }

        }

        throw lastError;

    }

    /**
     * ---------------------------------------------------------------------------
     * Circuit Breaker
     * ---------------------------------------------------------------------------
     */

    async executeWithCircuitBreaker({

        operation,

        correlationId,

        tenantId

    }) {

        if (

            this.circuitBreaker?.isOpen?.()

        ) {

            throw new Error(

                'Circuit breaker is OPEN.'

            );

        }

        try {

            const response =
                await operation();

            this.circuitBreaker?.recordSuccess?.();

            return response;

        }

        catch (error) {

            this.circuitBreaker?.recordFailure?.();

            this.metrics?.counter?.(

                'payment_airtel_collection_circuit_failure_total'

            );

            this.logger?.error?.({

                message:

                    'Circuit breaker failure',

                tenantId,

                correlationId

            });

            throw error;

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Timeout Protection
     * ---------------------------------------------------------------------------
     */

    async executeWithTimeout({

        timeout,

        operation

    }) {

        return Promise.race([

            operation(),

            new Promise((_, reject) =>

                setTimeout(

                    () =>

                        reject(

                            new Error(

                                'Provider timeout.'

                            )

                        ),

                    timeout

                )

            )

        ]);

    }

    /**
     * ---------------------------------------------------------------------------
     * Distributed Lock
     * ---------------------------------------------------------------------------
     */

    async acquireOperationLock(lockKey) {

        if (

            !this.distributedLock

        ) {

            return;

        }

        await this.distributedLock.acquire({

            key: lockKey

        });

    }

    releaseOperationLock(lockKey) {

        this.distributedLock

            ?.release?.({

                key: lockKey

            });

    }

    /**
     * ---------------------------------------------------------------------------
     * Dead Letter Queue
     * ---------------------------------------------------------------------------
     */

    async publishDeadLetter({

        tenantId,

        correlationId,

        transactionId,

        error

    }) {

        if (

            !this.deadLetterQueue

        ) {

            return;

        }

        await this.deadLetterQueue.publish({

            provider:

                PROVIDER.NAME,

            module:

                PROVIDER.MODULE,

            tenantId,

            correlationId,

            transactionId,

            timestamp:

                new Date(),

            reason:

                error.message,

            payload:

                error

        });

        this.metrics?.counter?.(

            'payment_airtel_collection_dead_letter_total'

        );

    }

    /**
     * ---------------------------------------------------------------------------
     * Compensation Workflow
     * ---------------------------------------------------------------------------
     */

    async executeCompensation({

        tenantId,

        correlationId,

        transactionId,

        error

    }) {

        if (

            !this.compensationService

        ) {

            return;

        }

        await this.compensationService.compensate({

            provider:

                PROVIDER.NAME,

            tenantId,

            correlationId,

            transactionId,

            reason:

                error.message

        });

        this.logger?.warn?.({

            message:

                'Compensation executed.',

            correlationId,

            tenantId

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Recovery Workflow
     * ---------------------------------------------------------------------------
     */

    async recoverOperation({

        transactionId,

        correlationId,

        tenantId

    }) {

        if (

            !this.recoveryService

        ) {

            return null;

        }

        return this.recoveryService.recover({

            provider:

                PROVIDER.NAME,

            transactionId,

            tenantId,

            correlationId

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Reliability Snapshot
     * ---------------------------------------------------------------------------
     */

    reliabilitySnapshot() {

        return {

            provider:

                PROVIDER.NAME,

            retries:

                this.statistics.retriesExecuted,

            circuitState:

                this.circuitBreaker?.state ||

                'UNKNOWN',

            activeLocks:

                this.distributedLock?.activeLocks?.() ||

                0,

            deadLetters:

                this.deadLetterQueue

                    ?.size?.() ||

                0,

            recoveryAvailable:

                Boolean(

                    this.recoveryService

                ),

            compensationAvailable:

                Boolean(

                    this.compensationService

                ),

            timestamp:

                new Date()

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Utility
     * ---------------------------------------------------------------------------
     */

    sleep(ms) {

        return new Promise(resolve =>

            setTimeout(resolve, ms)

        );

    }

    /**
 * ============================================================================
 * Part 5 — Enterprise Security & Compliance Layer
 * ============================================================================
 *
 * Responsibilities
 * ----------------
 * • Fraud scoring
 * • AML screening
 * • Velocity controls
 * • Tenant policy enforcement
 * • Collection limits
 * • Maker-checker approvals
 * • Approval workflow
 * • Security audit
 * • Compliance event publication
 * ============================================================================
 */

    const SECURITY_STATUS = Object.freeze({

        ALLOWED: 'ALLOWED',

        BLOCKED: 'BLOCKED',

        REVIEW: 'REVIEW'

    });

    /**
     * ---------------------------------------------------------------------------
     * Enterprise Security Pipeline
     * ---------------------------------------------------------------------------
     */

    async executeSecurityPipeline({

        tenantId,

        amount,

        currency,

        phoneNumber,

        payer,

        metadata,

        externalReference,

        correlationId

    }) {

        await this.enforceTenantPolicy({

            tenantId,

            amount,

            currency,

            correlationId

        });

        await this.validateVelocity({

            tenantId,

            phoneNumber,

            amount,

            correlationId

        });

        await this.performFraudAssessment({

            tenantId,

            amount,

            phoneNumber,

            payer,

            metadata,

            correlationId

        });

        await this.performAMLScreening({

            tenantId,

            payer,

            amount,

            currency,

            correlationId

        });

        await this.enforceMakerChecker({

            tenantId,

            amount,

            currency,

            externalReference,

            correlationId

        });

        await this.auditSecurity({

            tenantId,

            amount,

            phoneNumber,

            correlationId

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Tenant Policy Enforcement
     * ---------------------------------------------------------------------------
     */

    async enforceTenantPolicy({

        tenantId,

        amount,

        currency,

        correlationId

    }) {

        if (!this.policyEngine) {

            return;

        }

        const result = await this.policyEngine.evaluate({

            provider: PROVIDER.NAME,

            operation: 'COLLECTION',

            tenantId,

            amount,

            currency,

            correlationId

        });

        if (

            result.status === SECURITY_STATUS.BLOCKED

        ) {

            throw new Error(

                result.reason ||

                'Tenant policy violation.'

            );

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Velocity Controls
     * ---------------------------------------------------------------------------
     */

    async validateVelocity({

        tenantId,

        phoneNumber,

        amount,

        correlationId

    }) {

        if (!this.velocityService) {

            return;

        }

        const allowed =

            await this.velocityService.check({

                provider: PROVIDER.NAME,

                tenantId,

                phoneNumber,

                amount,

                correlationId

            });

        if (!allowed) {

            throw new Error(

                'Velocity threshold exceeded.'

            );

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Fraud Scoring
     * ---------------------------------------------------------------------------
     */

    async performFraudAssessment({

        tenantId,

        amount,

        phoneNumber,

        payer,

        metadata,

        correlationId

    }) {

        if (!this.fraudService) {

            return;

        }

        const assessment =

            await this.fraudService.score({

                provider: PROVIDER.NAME,

                tenantId,

                amount,

                phoneNumber,

                payer,

                metadata,

                correlationId

            });

        this.metrics?.histogram?.(

            'payment_airtel_collection_fraud_score',

            assessment.score

        );

        if (

            assessment.status ===

            SECURITY_STATUS.BLOCKED

        ) {

            throw new Error(

                assessment.reason ||

                'Fraud detection blocked transaction.'

            );

        }

        if (

            assessment.status ===

            SECURITY_STATUS.REVIEW

        ) {

            await this.submitManualReview({

                assessment,

                correlationId,

                tenantId

            });

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * AML Screening
     * ---------------------------------------------------------------------------
     */

    async performAMLScreening({

        tenantId,

        payer,

        amount,

        currency,

        correlationId

    }) {

        if (!this.amlService) {

            return;

        }

        const result =

            await this.amlService.screen({

                tenantId,

                payer,

                amount,

                currency,

                correlationId

            });

        if (

            result.status ===

            SECURITY_STATUS.BLOCKED

        ) {

            throw new Error(

                result.reason ||

                'AML policy violation.'

            );

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Maker-Checker Approval
     * ---------------------------------------------------------------------------
     */

    async enforceMakerChecker({

        tenantId,

        amount,

        currency,

        externalReference,

        correlationId

    }) {

        if (!this.approvalService) {

            return;

        }

        const approval =

            await this.approvalService.evaluate({

                provider: PROVIDER.NAME,

                operation: 'COLLECTION',

                tenantId,

                amount,

                currency,

                externalReference,

                correlationId

            });

        if (

            approval.required

        ) {

            await this.waitForApproval({

                approval,

                correlationId

            });

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Approval Workflow
     * ---------------------------------------------------------------------------
     */

    async waitForApproval({

        approval,

        correlationId

    }) {

        const decision =

            await this.approvalService.awaitDecision({

                requestId:

                    approval.requestId,

                correlationId

            });

        if (

            decision.status !== 'APPROVED'

        ) {

            throw new Error(

                'Collection approval denied.'

            );

        }

    }

    /**
     * ---------------------------------------------------------------------------
     * Manual Review
     * ---------------------------------------------------------------------------
     */

    async submitManualReview({

        assessment,

        tenantId,

        correlationId

    }) {

        this.eventBus?.publish?.({

            type:

                'COLLECTION_MANUAL_REVIEW_REQUIRED',

            provider:

                PROVIDER.NAME,

            tenantId,

            correlationId,

            payload:

                assessment

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Security Audit
     * ---------------------------------------------------------------------------
     */

    async auditSecurity({

        tenantId,

        amount,

        phoneNumber,

        correlationId

    }) {

        await this.auditService?.record?.({

            action:

                'AIRTEL_COLLECTION_SECURITY_VALIDATED',

            provider:

                PROVIDER.NAME,

            tenantId,

            correlationId,

            metadata: {

                amount,

                phoneNumber

            }

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Security Snapshot
     * ---------------------------------------------------------------------------
     */

    securitySnapshot() {

        return {

            provider:

                PROVIDER.NAME,

            fraudEnabled:

                Boolean(this.fraudService),

            amlEnabled:

                Boolean(this.amlService),

            velocityEnabled:

                Boolean(this.velocityService),

            policyEngine:

                Boolean(this.policyEngine),

            makerChecker:

                Boolean(this.approvalService),

            timestamp:

                new Date()

        };

    }

    /**
 * ============================================================================
 * Part 6 — Enterprise Operations & Intelligence Layer
 * ============================================================================
 *
 * Responsibilities
 * ----------------
 * • Health monitoring
 * • Readiness & liveness
 * • Operational metrics
 * • OpenTelemetry integration
 * • SLA monitoring
 * • Provider reliability scoring
 * • Diagnostics
 * • Runtime snapshots
 * • Graceful shutdown
 * ============================================================================
 */

    /**
     * ---------------------------------------------------------------------------
     * Complete Health
     * ---------------------------------------------------------------------------
     */

    async health() {

        const uptime =
            this.runtime.startedAt
                ? Date.now() - this.runtime.startedAt.getTime()
                : 0;

        const providerHealth =
            await this.providerClient?.health?.();

        const authHealth =
            await this.authService?.health?.();

        return {

            provider: PROVIDER.NAME,

            module: PROVIDER.MODULE,

            status: this.health.status,

            readiness: this.health.readiness,

            liveness: this.health.liveness,

            uptimeMs: uptime,

            startedAt: this.runtime.startedAt,

            activeCollections:
                this.runtime.activeCollections.size,

            statistics:
                this.statistics,

            dependencies: {

                provider:
                    providerHealth || 'UNKNOWN',

                authentication:
                    authHealth || 'UNKNOWN',

                ledger:
                    this.ledgerBridge?.health?.() || 'UNKNOWN',

                reconciliation:
                    this.reconciliationService?.health?.() || 'UNKNOWN',

                settlement:
                    this.settlementService?.health?.() || 'UNKNOWN'

            }

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Readiness Probe
     * ---------------------------------------------------------------------------
     */

    async readiness() {

        const healthy =
            await this.health();

        return {

            ready:

                healthy.status === SERVICE_STATUS.READY,

            timestamp:

                new Date(),

            provider:

                PROVIDER.NAME

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Liveness Probe
     * ---------------------------------------------------------------------------
     */

    liveness() {

        return {

            alive:

                true,

            provider:

                PROVIDER.NAME,

            module:

                PROVIDER.MODULE,

            timestamp:

                new Date()

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Metrics Export
     * ---------------------------------------------------------------------------
     */

    metricsSnapshot() {

        return {

            collectionsStarted:
                this.statistics.collectionsStarted,

            collectionsCompleted:
                this.statistics.collectionsCompleted,

            collectionsSucceeded:
                this.statistics.collectionsSucceeded,

            collectionsFailed:
                this.statistics.collectionsFailed,

            retries:
                this.statistics.retriesExecuted,

            ledgerPosts:
                this.statistics.ledgerPosts,

            reconciliation:
                this.statistics.reconciliationRequests,

            settlement:
                this.statistics.settlementRequests,

            callbacks:
                this.statistics.callbacksRegistered

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * OpenTelemetry Attributes
     * ---------------------------------------------------------------------------
     */

    attachTracing(span, collection) {

        if (!span) {

            return;

        }

        span.setAttribute(

            'payment.provider',

            PROVIDER.NAME

        );

        span.setAttribute(

            'payment.operation',

            'collection'

        );

        span.setAttribute(

            'tenant.id',

            collection.tenantId

        );

        span.setAttribute(

            'transaction.id',

            collection.transactionId

        );

        span.setAttribute(

            'payment.amount',

            Number(collection.amount)

        );

    }

    /**
     * ---------------------------------------------------------------------------
     * SLA Monitoring
     * ---------------------------------------------------------------------------
     */

    slaStatus() {

        const total =
            this.statistics.collectionsCompleted;

        const failed =
            this.statistics.collectionsFailed;

        const successRate =

            total === 0

                ? 100

                : (

                    (total - failed)

                    /

                    total

                ) * 100;

        return {

            successRate,

            target: 99.90,

            compliant:

                successRate >= 99.90,

            completed:

                total,

            failures:

                failed

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Provider Reliability
     * ---------------------------------------------------------------------------
     */

    providerScore() {

        const completed =
            this.statistics.collectionsCompleted;

        const failures =
            this.statistics.providerFailures;

        const retries =
            this.statistics.retriesExecuted;

        if (!completed) {

            return 100;

        }

        let score =

            100 -

            ((failures * 10) +

                (retries * 2));

        return Math.max(

            0,

            Math.min(

                100,

                score

            )

        );

    }

    /**
     * ---------------------------------------------------------------------------
     * Enterprise Diagnostics
     * ---------------------------------------------------------------------------
     */

    diagnostics() {

        return {

            runtime:

                this.runtime,

            health:

                this.health,

            statistics:

                this.statistics,

            reliability:

                this.reliabilitySnapshot(),

            financial:

                this.financialSnapshot(),

            security:

                this.securitySnapshot(),

            metrics:

                this.metricsSnapshot(),

            sla:

                this.slaStatus(),

            providerScore:

                this.providerScore()

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Complete Snapshot
     * ---------------------------------------------------------------------------
     */

    snapshot() {

        return {

            provider:

                PROVIDER.NAME,

            module:

                PROVIDER.MODULE,

            timestamp:

                new Date(),

            runtime:

            {

                initialized:

                    this.runtime.initialized,

                startedAt:

                    this.runtime.startedAt,

                activeCollections:

                    this.runtime.activeCollections.size

            },

            health:

                this.health,

            statistics:

                this.statistics,

            providerScore:

                this.providerScore(),

            sla:

                this.slaStatus()

        };

    }

    /**
     * ---------------------------------------------------------------------------
     * Graceful Shutdown
     * ---------------------------------------------------------------------------
     */

    async shutdown() {

        this.logger?.info?.({

            message:

                'Shutting down Airtel Collection Service'

        });

        this.health.status =

            SERVICE_STATUS.SHUTTING_DOWN;

        this.runtime.shutdownRequested =

            true;

        while (

            this.runtime.activeCollections.size >

            0

        ) {

            await new Promise(

                resolve =>

                    setTimeout(

                        resolve,

                        250

                    )

            );

        }

        await this.providerClient

            ?.close?.();

        await this.authService

            ?.shutdown?.();

        await this.eventBus

            ?.close?.();

        this.health.status =

            SERVICE_STATUS.STOPPED;

        this.logger?.info?.({

            message:

                'Airtel Collection Service stopped'

        });

    }

    /**
     * ---------------------------------------------------------------------------
     * Reset Runtime Statistics
     * ---------------------------------------------------------------------------
     */

    resetStatistics() {

        Object.keys(

            this.statistics

        ).forEach(key => {

            if (

                typeof this.statistics[key] ===

                'number'

            ) {

                this.statistics[key] = 0;

            }

        });

    }

}

module.exports = CollectionService;