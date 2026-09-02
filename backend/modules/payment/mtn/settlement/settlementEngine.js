'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * MTN Settlement Engine
 * ============================================================================
 *
 * Enterprise Settlement & Reconciliation Orchestrator
 * ----------------------------------------------------------------------------
 *
 * Purpose
 * -------
 * The SettlementEngine is the authoritative orchestration layer for MTN
 * settlement processing and reconciliation.
 *
 * This class coordinates settlement workflows while delegating specialized
 * responsibilities to dedicated services.
 *
 * This engine intentionally contains NO settlement implementation logic.
 * Business logic belongs in the injected collaborators.
 *
 * Responsibilities
 * ----------------
 * ✓ Settlement orchestration
 * ✓ Dependency management
 * ✓ Runtime configuration
 * ✓ Execution lifecycle
 * ✓ Transaction boundary ownership
 * ✓ Execution context ownership
 * ✓ Observability integration
 * ✓ Event publication
 * ✓ Audit integration
 * ✓ Enterprise health reporting
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * ✗ Statement parsing
 * ✗ Settlement persistence
 * ✗ Ledger reconciliation
 * ✗ Matching algorithms
 * ✗ Variance detection
 * ✗ Report generation
 * ✗ Recovery logic
 *
 * Public API
 * ----------
 * initialize()
 * process()
 * importStatement()
 * validate()
 * reconcile()
 * repair()
 * generateReport()
 * closeBatch()
 * health()
 *
 * Architecture
 * ------------
 *
 * Settlement Request
 *        │
 *        ▼
 * SettlementEngine
 *        │
 *        ▼
 * Execution Context
 *        │
 *        ▼
 * Transaction Boundary
 *        │
 *        ▼
 * ProviderStatementImporter
 *        │
 *        ▼
 * SettlementRepository
 *        │
 *        ▼
 * SettlementMatcher
 *        │
 *        ▼
 * LedgerReconciler
 *        │
 *        ▼
 * VarianceDetector
 *        │
 *        ▼
 * RecoveryManager
 *        │
 *        ▼
 * SettlementReport
 *        │
 *        ▼
 * Audit + Metrics + Tracing + Events
 *
 * ============================================================================
 */

const EventEmitter = require('events');
const crypto = require('crypto');

/**
 * ============================================================================
 * Engine Constants
 * ============================================================================
 */

const ENGINE_NAME = 'SettlementEngine';
const ENGINE_VERSION = '1.0.0';

const PROVIDER = 'MTN';

const DEFAULT_CONFIGURATION = Object.freeze({

    provider: PROVIDER,

    batchSize: 100,

    reconciliationTimeoutMs: 300000,

    retryLimit: 3,

    enableAutoRepair: true,

    enableReporting: true

});

/**
 * ============================================================================
 * Enterprise Error
 * ============================================================================
 */

class SettlementEngineError extends Error {

    constructor(message, options = {}) {

        super(message);

        this.name = 'SettlementEngineError';

        this.code = options.code || 'SETTLEMENT_ENGINE_ERROR';

        this.cause = options.cause;

        this.details = options.details || {};

        Error.captureStackTrace?.(this, SettlementEngineError);

    }

}

/**
 * ============================================================================
 * Settlement Engine
 * ============================================================================
 */

class SettlementEngine extends EventEmitter {

    /**
     * ------------------------------------------------------------------------
     * Constructor
     * ------------------------------------------------------------------------
     */

    constructor({

        config = {},

        importer,

        repository,

        matcher,

        reconciler,

        varianceDetector,

        recoveryManager,

        reportService,

        audit,

        metrics,

        tracer,

        logger,

        eventBus

    } = {}) {

        super();

        /**
         * --------------------------------------------------------------------
         * Immutable Runtime Configuration
         * --------------------------------------------------------------------
         */

        this.config = Object.freeze({

            ...DEFAULT_CONFIGURATION,

            ...config

        });

        /**
         * --------------------------------------------------------------------
         * Dependency Registry
         * --------------------------------------------------------------------
         */

        this.services = Object.freeze({

            importer,

            repository,

            matcher,

            reconciler,

            varianceDetector,

            recoveryManager,

            reportService,

            audit,

            metrics,

            tracer,

            logger,

            eventBus

        });

        /**
         * --------------------------------------------------------------------
         * Runtime State
         * --------------------------------------------------------------------
         */

        this.state = {

            initialized: false,

            healthy: false,

            startedAt: null,

            activeExecutions: 0,

            lastExecution: null

        };

        /**
         * --------------------------------------------------------------------
         * Execution Context Placeholder
         * --------------------------------------------------------------------
         */

        this.executionContext = null;

        /**
         * --------------------------------------------------------------------
         * Validate Construction
         * --------------------------------------------------------------------
         */

        this.validateConfiguration();

        this.validateDependencies();

    }

    /**
     * ========================================================================
     * Configuration Validation
     * ========================================================================
     */

    validateConfiguration() {

        if (this.config.batchSize <= 0) {

            throw new SettlementEngineError(

                'batchSize must be greater than zero',

                {

                    code: 'INVALID_BATCH_SIZE'

                }

            );

        }

        if (this.config.retryLimit < 0) {

            throw new SettlementEngineError(

                'retryLimit cannot be negative',

                {

                    code: 'INVALID_RETRY_LIMIT'

                }

            );

        }

    }

    /**
     * ========================================================================
     * Dependency Validation
     * ========================================================================
     */

    validateDependencies() {

        const required = [

            'importer',

            'repository',

            'matcher',

            'reconciler',

            'varianceDetector',

            'recoveryManager',

            'reportService'

        ];

        for (const dependency of required) {

            if (!this.services[dependency]) {

                throw new SettlementEngineError(

                    `Missing dependency: ${dependency}`,

                    {

                        code: 'MISSING_DEPENDENCY'

                    }

                );

            }

        }

    }

    /**
     * ========================================================================
     * Error Helper
     * ========================================================================
     */

    createError(message, options = {}) {

        return new SettlementEngineError(message, options);

    }

    /**
     * ========================================================================
     * Correlation ID
     * ========================================================================
     */

    createCorrelationId() {

        return crypto.randomUUID();

    }

    /**
     * ========================================================================
     * Public API
     * ========================================================================
     */

    async initialize() {

        throw new Error('Not implemented');

    }

    async process() {

        throw new Error('Not implemented');

    }

    async importStatement() {

        throw new Error('Not implemented');

    }

    async validate() {

        throw new Error('Not implemented');

    }

    async reconcile() {

        throw new Error('Not implemented');

    }

    async repair() {

        throw new Error('Not implemented');

    }

    async generateReport() {

        throw new Error('Not implemented');

    }

    async closeBatch() {

        throw new Error('Not implemented');

    }

    /**
     * ========================================================================
     * Health
     * ========================================================================
     */

    health() {

        return {

            engine: ENGINE_NAME,

            version: ENGINE_VERSION,

            provider: this.config.provider,

            initialized: this.state.initialized,

            healthy: this.state.healthy,

            startedAt: this.state.startedAt,

            activeExecutions: this.state.activeExecutions,

            lastExecution: this.state.lastExecution

        };

    }

    /**
 * ============================================================================
 * Execution Context Factory
 * ============================================================================
 */

createExecutionContext({

    tenantId,

    accountingPeriod,

    transactionId,

    initiatedBy,

    roles = [],

    permissions = [],

    correlationId,

    metadata = {}

} = {}) {

    if (!tenantId) {

        throw this.createError(

            'tenantId is required',

            {

                code: 'TENANT_REQUIRED'

            }

        );

    }

    const now = new Date();

    const executionId = crypto.randomUUID();

    const requestCorrelationId =

        correlationId ||

        this.createCorrelationId();

    const context = Object.freeze({

        /**
         * ================================================================
         * Execution
         * ================================================================
         */

        execution: Object.freeze({

            executionId,

            provider: this.config.provider,

            engine: ENGINE_NAME,

            version: ENGINE_VERSION,

            startedAt: now,

            correlationId: requestCorrelationId

        }),

        /**
         * ================================================================
         * Tenant
         * ================================================================
         */

        tenant: Object.freeze({

            id: tenantId

        }),

        /**
         * ================================================================
         * Accounting
         * ================================================================
         */

        accounting: Object.freeze({

            period: accountingPeriod || null

        }),

        /**
         * ================================================================
         * Transaction
         * ================================================================
         */

        transaction: Object.freeze({

            id:

                transactionId ||

                crypto.randomUUID(),

            boundary: 'PENDING'

        }),

        /**
         * ================================================================
         * Security
         * ================================================================
         */

        security: Object.freeze({

            initiatedBy:

                initiatedBy ||

                'system',

            roles: Object.freeze([...roles]),

            permissions:

                Object.freeze([...permissions])

        }),

        /**
         * ================================================================
         * Metadata
         * ================================================================
         */

        metadata: Object.freeze({

            ...metadata

        })

    });

    this.executionContext = context;

    return context;

}

/**
 * ============================================================================
 * Context Accessor
 * ============================================================================
 */

getExecutionContext() {

    return this.executionContext;

}

/**
 * ============================================================================
 * Context Reset
 * ============================================================================
 */

clearExecutionContext() {

    this.executionContext = null;

}

/**
 * ============================================================================
 * Context Validation
 * ============================================================================
 */

validateExecutionContext(context = this.executionContext) {

    if (!context) {

        throw this.createError(

            'Execution context has not been initialized',

            {

                code: 'EXECUTION_CONTEXT_REQUIRED'

            }

        );

    }

    if (!context.tenant?.id) {

        throw this.createError(

            'Tenant context is missing',

            {

                code: 'TENANT_CONTEXT_REQUIRED'

            }

        );

    }

    if (!context.execution?.correlationId) {

        throw this.createError(

            'Correlation ID is missing',

            {

                code: 'CORRELATION_ID_REQUIRED'

            }

        );

    }

    return true;

}

/**
 * ============================================================================
 * Structured Logging
 * ============================================================================
 */

log(level = 'info', message, metadata = {}) {

    const logger = this.services.logger;

    if (!logger || typeof logger[level] !== 'function') {
        return;
    }

    logger[level](message, {
        engine: ENGINE_NAME,
        provider: this.config.provider,
        correlationId:
            this.executionContext?.execution?.correlationId,
        executionId:
            this.executionContext?.execution?.executionId,
        tenantId:
            this.executionContext?.tenant?.id,
        ...metadata
    });

}

/**
 * ============================================================================
 * Metrics Hook
 * ============================================================================
 */

recordMetric(name, value = 1, labels = {}) {

    const metrics = this.services.metrics;

    if (!metrics) {
        return;
    }

    try {

        if (typeof metrics.record === 'function') {

            metrics.record(name, value, labels);

        } else if (typeof metrics.increment === 'function') {

            metrics.increment(name, value, labels);

        }

    } catch (error) {

        this.log('warn', 'Metric recording failed', {
            metric: name,
            error: error.message
        });

    }

}

/**
 * ============================================================================
 * OpenTelemetry Span Wrapper
 * ============================================================================
 */

async withSpan(spanName, operation) {

    const tracer = this.services.tracer;

    if (!tracer?.startSpan) {
        return operation();
    }

    const span = tracer.startSpan(spanName);

    try {

        const result = await operation(span);

        span?.setStatus?.({ code: 1 });

        return result;

    } catch (error) {

        span?.recordException?.(error);

        span?.setStatus?.({
            code: 2,
            message: error.message
        });

        throw error;

    } finally {

        span?.end?.();

    }

}

/**
 * ============================================================================
 * Enterprise Transaction Boundary
 * ============================================================================
 */

async withinTransaction(operation) {

    const repository = this.services.repository;

    if (!repository?.withTransaction) {

        return operation();

    }

    return repository.withTransaction(async (transaction) => {

        if (this.executionContext?.transaction) {

            this.executionContext.transaction.boundary = 'ACTIVE';

        }

        try {

            const result = await operation(transaction);

            if (this.executionContext?.transaction) {

                this.executionContext.transaction.boundary = 'COMMITTED';

            }

            return result;

        } catch (error) {

            if (this.executionContext?.transaction) {

                this.executionContext.transaction.boundary = 'ROLLED_BACK';

            }

            throw error;

        }

    });

}

/**
 * ============================================================================
 * Health Status
 * ============================================================================
 */

health() {

    return {

        engine: ENGINE_NAME,

        version: ENGINE_VERSION,

        provider: this.config.provider,

        initialized: this.state.initialized,

        healthy: this.state.healthy,

        activeExecutions: this.state.activeExecutions,

        startedAt: this.state.startedAt,

        uptimeMs: this.state.startedAt
            ? Date.now() - this.state.startedAt.getTime()
            : 0,

        services: {

            importer: !!this.services.importer,
            repository: !!this.services.repository,
            matcher: !!this.services.matcher,
            reconciler: !!this.services.reconciler,
            varianceDetector: !!this.services.varianceDetector,
            recoveryManager: !!this.services.recoveryManager,
            reportService: !!this.services.reportService

        }

    };

}

/**
 * ============================================================================
 * Readiness Probe
 * ============================================================================
 */

isReady() {

    return (

        this.state.initialized === true &&

        this.state.healthy === true

    );

}

/**
 * ============================================================================
 * Liveness Probe
 * ============================================================================
 */

isAlive() {

    return this.state.startedAt !== null;

}

/**
 * ============================================================================
 * Infrastructure Bootstrap
 * ============================================================================
 */

initializeInfrastructure() {

    this.log(
        'info',
        'Initializing Settlement Engine infrastructure'
    );

    this.recordMetric(
        'payment_settlement_engine_initializations_total',
        1
    );

    this.state.startedAt = new Date();

    this.state.healthy = true;

}

/**
 * ============================================================================
 * Execution Wrapper
 * ============================================================================
 */

async execute(operationName, handler) {

    return this.withSpan(

        `SettlementEngine.${operationName}`,

        async () => {

            return this.withinTransaction(async () => {

                this.state.activeExecutions++;

                try {

                    this.recordMetric(
                        'payment_settlement_operations_total',
                        1,
                        {
                            operation: operationName
                        }
                    );

                    this.log(
                        'info',
                        `${operationName} started`
                    );

                    const result = await handler();

                    this.log(
                        'info',
                        `${operationName} completed`
                    );

                    return result;

                } catch (error) {

                    this.recordMetric(
                        'payment_settlement_operation_failures_total',
                        1,
                        {
                            operation: operationName
                        }
                    );

                    this.log(
                        'error',
                        `${operationName} failed`,
                        {
                            error: error.message
                        }
                    );

                    throw error;

                } finally {

                    this.state.activeExecutions--;

                }

            });

        }

    );

}

/**
 * ============================================================================
 * Engine Status
 * ============================================================================
 */

getStatus() {

    return Object.freeze({

        initialized: this.state.initialized,

        healthy: this.state.healthy,

        startedAt: this.state.startedAt,

        activeExecutions: this.state.activeExecutions,

        lastExecution: this.state.lastExecution,

        uptimeMs:

            this.state.startedAt ?

            Date.now() - this.state.startedAt.getTime() :

            0

    });

}

/**
 * ============================================================================
 * Bootstrap
 * ============================================================================
 */

async initialize() {

    if (this.state.initialized) {

        return this.getStatus();

    }

    return this.execute(

        'initialize',

        async () => {

            this.log(

                'info',

                'Settlement Engine initialization started'

            );

            /**
             * ------------------------------------------------------------
             * Validate Foundation
             * ------------------------------------------------------------
             */

            this.validateConfiguration();

            this.validateDependencies();

            /**
             * ------------------------------------------------------------
             * Infrastructure
             * ------------------------------------------------------------
             */

            this.initializeInfrastructure();

            /**
             * ------------------------------------------------------------
             * Initialize Child Services
             * ------------------------------------------------------------
             */

            const services = [

                this.services.importer,

                this.services.repository,

                this.services.matcher,

                this.services.reconciler,

                this.services.varianceDetector,

                this.services.recoveryManager,

                this.services.reportService

            ];

            for (const service of services) {

                if (typeof service?.initialize === 'function') {

                    await service.initialize();

                }

            }

            /**
             * ------------------------------------------------------------
             * Engine State
             * ------------------------------------------------------------
             */

            this.state.initialized = true;

            this.state.healthy = true;

            this.state.startedAt ??= new Date();

            this.recordMetric(

                'payment_settlement_engine_bootstrap_total',

                1

            );

            this.emit(

                'engine.initialized',

                this.getStatus()

            );

            this.log(

                'info',

                'Settlement Engine initialized successfully'

            );

            return this.getStatus();

        }

    );

}

/**
 * ============================================================================
 * Lifecycle
 * ============================================================================
 */

async shutdown() {

    if (!this.state.initialized) {

        return;

    }

    this.log(

        'info',

        'Settlement Engine shutdown started'

    );

    const services = [

        this.services.reportService,

        this.services.recoveryManager,

        this.services.reconciler,

        this.services.matcher,

        this.services.repository,

        this.services.importer

    ];

    for (const service of services) {

        if (typeof service?.shutdown === 'function') {

            try {

                await service.shutdown();

            }

            catch (error) {

                this.log(

                    'warn',

                    'Child service shutdown failed',

                    {

                        service:

                            service.constructor?.name,

                        error:

                            error.message

                    }

                );

            }

        }

    }

    this.state.healthy = false;

    this.state.initialized = false;

    this.recordMetric(

        'payment_settlement_engine_shutdown_total',

        1

    );

    this.emit(

        'engine.shutdown',

        this.getStatus()

    );

    this.log(

        'info',

        'Settlement Engine shutdown complete'

    );

}

/**
 * ============================================================================
 * Health Refresh
 * ============================================================================
 */

refreshHealth() {

    const healthy =

        this.state.initialized &&

        this.services.importer &&

        this.services.repository &&

        this.services.matcher &&

        this.services.reconciler &&

        this.services.varianceDetector &&

        this.services.recoveryManager &&

        this.services.reportService;

    this.state.healthy = Boolean(healthy);

    return this.state.healthy;

}

/**
 * ============================================================================
 * Readiness Validation
 * ============================================================================
 */

assertReady() {

    if (!this.isReady()) {

        throw this.createError(

            'Settlement Engine is not ready',

            {

                code: 'ENGINE_NOT_READY'

            }

        );

    }

}

/**
 * ============================================================================
 * Public API — Settlement Processing Orchestration
 * ============================================================================
 */


/**
 * ============================================================================
 * Process Settlement Workflow
 * ============================================================================
 */

async process({

    tenantId,

    statement,

    accountingPeriod,

    initiatedBy

} = {}) {


    return this.execute(

        'process',

        async () => {


            const context =

                this.createExecutionContext({

                    tenantId,

                    accountingPeriod,

                    initiatedBy

                });


            this.validateExecutionContext(context);



            this.log(

                'info',

                'Settlement processing started',

                {

                    executionId:

                        context.execution.executionId

                }

            );


            let imported;


            let validated;


            let reconciled;



            imported =

                await this.importStatement({

                    statement,

                    context

                });



            validated =

                await this.validate({

                    data:

                        imported,

                    context

                });



            if (!validated.valid) {


                throw new Error(

                    'Settlement validation failed'

                );

            }



            reconciled =

                await this.reconcile({

                    data:

                        imported,

                    context

                });



            const result = Object.freeze({


                executionId:

                    context.execution.executionId,


                status:

                    'COMPLETED',


                imported,


                validated,


                reconciled,


                processedAt:

                    new Date()


            });



            this.state.lastExecution = result;



            return result;


        }

    );


}





/**
 * ============================================================================
 * Import Provider Settlement Statement
 * ============================================================================
 */

async importStatement(payload = {}) {


    return this.execute(

        'importStatement',

        async () => {


            this.assertReady();



            if (

                !this.services.importer ||

                typeof this.services.importer.importStatement !==

                'function'

            ) {

                throw new Error(

                    'Settlement importer unavailable'

                );

            }



            return this.services.importer.importStatement(

                {

                    ...payload

                }

            );


        }

    );


}





/**
 * ============================================================================
 * Validate Settlement Data
 * ============================================================================
 */

async validate(payload = {}) {


    return this.execute(

        'validate',

        async () => {


            this.assertReady();



            if (

                this.services.importer &&

                typeof this.services.importer.validate ===

                'function'

            ) {


                return this.services.importer.validate(

                    payload

                );


            }



            return Object.freeze({

                valid:true

            });


        }

    );


}





/**
 * ============================================================================
 * Reconcile Settlement
 * ============================================================================
 */

async reconcile(payload = {}) {


    return this.execute(

        'reconcile',

        async () => {


            this.assertReady();



            if (

                !this.services.reconciler ||

                typeof this.services.reconciler.reconcile !==

                'function'

            ) {

                throw new Error(

                    'Settlement reconciler unavailable'

                );

            }



            return this.services.reconciler.reconcile(

                payload

            );


        }

    );


}





/**
 * ============================================================================
 * Repair Settlement Variance
 * ============================================================================
 */

async repair(payload = {}) {


    return this.execute(

        'repair',

        async () => {


            this.assertReady();



            if (

                !this.services.recoveryManager ||

                typeof this.services.recoveryManager.repair !==

                'function'

            ) {

                throw new Error(

                    'Recovery manager unavailable'

                );

            }



            return this.services.recoveryManager.repair(

                payload

            );


        }

    );


}





/**
 * ============================================================================
 * Generate Settlement Report
 * ============================================================================
 */

async generateReport(payload = {}) {


    return this.execute(

        'generateReport',

        async () => {


            this.assertReady();



            if (

                !this.services.reportService ||

                typeof this.services.reportService.generate !==

                'function'

            ) {

                throw new Error(

                    'Report service unavailable'

                );

            }



            return this.services.reportService.generate(

                payload

            );


        }

    );


}





/**
 * ============================================================================
 * Close Settlement Batch
 * ============================================================================
 */

async closeBatch(payload = {}) {


    return this.execute(

        'closeBatch',

        async () => {


            this.assertReady();



            if (

                !payload.batchId

            ) {

                throw new Error(

                    'batchId required'

                );

            }



            const result = Object.freeze({


                batchId:

                    payload.batchId,


                status:

                    'CLOSED',


                closedAt:

                    new Date()


            });



            this.emit(

                'settlement.batch.closed',

                result

            );



            return result;


        }

    );


}





/**
 * ============================================================================
 * Enterprise Health API
 * ============================================================================
 */

health() {


    return Object.freeze({


        engine:

            ENGINE_NAME,


        version:

            ENGINE_VERSION,


        provider:

            this.config.provider,


        status:

            this.state.healthy

                ? 'UP'

                : 'DOWN',



        initialized:

            this.state.initialized,



        activeExecutions:

            this.state.activeExecutions,



        startedAt:

            this.state.startedAt,



        lastExecution:

            this.state.lastExecution

                ? {

                    ...this.state.lastExecution

                }

                : null,



        dependencies:{


            importer:

                Boolean(this.services.importer),



            repository:

                Boolean(this.services.repository),



            matcher:

                Boolean(this.services.matcher),



            reconciler:

                Boolean(this.services.reconciler),



            varianceDetector:

                Boolean(this.services.varianceDetector),



            recoveryManager:

                Boolean(this.services.recoveryManager),



            reportService:

                Boolean(this.services.reportService)


        }


    });


}



}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports = {

    SettlementEngine,

    SettlementEngineError,

    DEFAULT_CONFIGURATION,

    ENGINE_NAME,

    ENGINE_VERSION

};