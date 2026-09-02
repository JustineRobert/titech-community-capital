'use strict';

/**
 * ============================================================
 * TITech Community Capital
 * Enterprise Ledger Engine
 * ------------------------------------------------------------
 * Foundation Layer
 *
 * Responsibilities
 *  - Ledger orchestration
 *  - Dependency management
 *  - Context creation
 *  - Configuration
 *  - Service registry
 *  - Public API
 *  - Enterprise error model
 *
 * NOTE:
 * Business logic is intentionally delegated to specialized
 * services that will be implemented in subsequent milestones.
 * ============================================================
 */

const crypto = require('crypto');

class LedgerEngineError extends Error {
    constructor(code, message, metadata = {}) {
        super(message);

        this.name = 'LedgerEngineError';
        this.code = code;
        this.metadata = metadata;
        this.timestamp = new Date();
    }
}

class LedgerEngine {

    /**
     * ---------------------------------------------------------
     * Dependency Injection
     * ---------------------------------------------------------
     */
    constructor({
        logger,
        metrics,
        tracer,
        db,
        eventBus,
        cache,
        config = {},

        postingValidator,
        journalService,
        postingEngine,
        balanceService,
        reversalService,
        snapshotService,
        periodCloseService,
        idempotencyService,
        tenantService,
        auditService,

        repositories = {}
    } = {}) {

        this.logger = logger;
        this.metrics = metrics;
        this.tracer = tracer;

        this.db = db;
        this.eventBus = eventBus;
        this.cache = cache;

        this.config = this.#buildConfiguration(config);

        this.services = Object.freeze({
            postingValidator,
            journalService,
            postingEngine,
            balanceService,
            reversalService,
            snapshotService,
            periodCloseService,
            idempotencyService,
            tenantService,
            auditService
        });

        this.repositories = Object.freeze({
            ledger: repositories.ledger,
            journal: repositories.journal,
            balance: repositories.balance,
            snapshot: repositories.snapshot,
            audit: repositories.audit
        });

        this.#validateDependencies();

        this.logger?.info?.(
            '[LedgerEngine] Enterprise Ledger Engine initialized.',
            {
                service: 'LedgerEngine',
                version: this.config.version
            }
        );
    }

    /**
     * ---------------------------------------------------------
     * Configuration
     * ---------------------------------------------------------
     */

    #buildConfiguration(config) {

        return Object.freeze({

            serviceName:
                config.serviceName ||
                'enterprise-ledger-engine',

            version:
                config.version ||
                '1.0.0',

            enableTracing:
                config.enableTracing !== false,

            enableAudit:
                config.enableAudit !== false,

            enableEvents:
                config.enableEvents !== false,

            enforceDoubleEntry:
                config.enforceDoubleEntry !== false,

            enforceTenantIsolation:
                config.enforceTenantIsolation !== false,

            enforceIdempotency:
                config.enforceIdempotency !== false,

            transactionTimeoutMs:
                config.transactionTimeoutMs ||
                30000
        });
    }

    /**
     * ---------------------------------------------------------
     * Dependency Validation
     * ---------------------------------------------------------
     */

    #validateDependencies() {

        const required = [

            'postingValidator',
            'journalService',
            'postingEngine',
            'balanceService',
            'reversalService',
            'auditService'
        ];

        for (const dependency of required) {

            if (!this.services[dependency]) {

                throw new LedgerEngineError(
                    'LEDGER_DEPENDENCY_MISSING',
                    `Missing dependency: ${dependency}`
                );
            }
        }
    }

    /**
     * ---------------------------------------------------------
     * Service Registry
     * ---------------------------------------------------------
     */

    getService(name) {

        return this.services[name];
    }

    getRepository(name) {

        return this.repositories[name];
    }

    registerService(name, service) {

        throw new LedgerEngineError(
            'SERVICE_REGISTRY_LOCKED',
            `Cannot dynamically register ${name}. Registry is immutable.`
        );
    }

    /**
     * ---------------------------------------------------------
     * Engine Health
     * ---------------------------------------------------------
     */

    getHealth() {

        return {

            service: this.config.serviceName,

            version: this.config.version,

            initialized: true,

            timestamp: new Date(),

            services: Object.keys(this.services),

            repositories: Object.keys(this.repositories)
        };
    }

    /**
     * ---------------------------------------------------------
     * Context Factory
     * Placeholder
     * (Implemented in Part 2)
     * ---------------------------------------------------------
     */

    /**
 * ---------------------------------------------------------
 * Enterprise Execution Context
 * ---------------------------------------------------------
 *
 * Every ledger operation executes within a standardized
 * immutable context carrying identity, tenancy,
 * idempotency, security and transaction metadata.
 * ---------------------------------------------------------
 */
    createContext(request = {}) {

        const now = new Date();

        const requestId =
            request.requestId ||
            crypto.randomUUID();

        const correlationId =
            request.correlationId ||
            requestId;

        const operationId =
            request.operationId ||
            crypto.randomUUID();

        const context = Object.freeze({

            request: this.#buildRequestContext({
                requestId,
                correlationId,
                operationId,
                request,
                now
            }),

            tenant: this.#buildTenantContext(request),

            idempotency: this.#buildIdempotencyContext(request),

            transaction: this.#buildTransactionContext(request),

            security: this.#buildSecurityContext(request)

        });

        this.logger?.debug?.(
            '[LedgerEngine] Execution context created.',
            {
                requestId,
                correlationId,
                tenantId: context.tenant.tenantId
            }
        );

        return context;
    }

    /**
     * ---------------------------------------------------------
     * Request Context
     * ---------------------------------------------------------
     */

    #buildRequestContext({
        requestId,
        correlationId,
        operationId,
        request,
        now
    }) {

        return Object.freeze({

            requestId,

            correlationId,

            operationId,

            operation:
                request.operation || 'UNKNOWN',

            source:
                request.source || 'SYSTEM',

            initiatedBy:
                request.userId || null,

            timestamp: now,

            metadata:
                Object.freeze(request.metadata || {})

        });
    }

    /**
     * ---------------------------------------------------------
     * Tenant Context
     * ---------------------------------------------------------
     */

    #buildTenantContext(request) {

        const tenantId =
            request.tenantId ||
            request.tenant?.id;

        if (
            this.config.enforceTenantIsolation &&
            !tenantId
        ) {

            throw new LedgerEngineError(
                'TENANT_REQUIRED',
                'Ledger operations require tenant context.'
            );
        }

        return Object.freeze({

            tenantId,

            organizationId:
                request.organizationId || null,

            branchId:
                request.branchId || null,

            fiscalCalendar:
                request.fiscalCalendar || null

        });
    }

    /**
     * ---------------------------------------------------------
     * Correlation & Idempotency
     * ---------------------------------------------------------
     */

    #buildIdempotencyContext(request) {

        const key =
            request.idempotencyKey ||
            crypto
                .createHash('sha256')
                .update(
                    JSON.stringify({
                        tenant: request.tenantId,
                        reference: request.reference,
                        operation: request.operation
                    })
                )
                .digest('hex');

        return Object.freeze({

            enabled:
                this.config.enforceIdempotency,

            key,

            replay: false,

            strategy:
                'STRICT',

            expiresAt: null

        });
    }

    /**
     * ---------------------------------------------------------
     * Transaction Context
     * ---------------------------------------------------------
     */

    #buildTransactionContext(request) {

        return Object.freeze({

            transactionId:
                crypto.randomUUID(),

            isolationLevel:
                request.isolationLevel ||
                'SERIALIZABLE',

            timeoutMs:
                this.config.transactionTimeoutMs,

            readOnly:
                Boolean(request.readOnly),

            session: null,

            committed: false,

            rolledBack: false

        });
    }

    /**
     * ---------------------------------------------------------
     * Security Context
     * ---------------------------------------------------------
     */

    #buildSecurityContext(request) {

        return Object.freeze({

            authenticated:
                Boolean(request.userId),

            userId:
                request.userId || null,

            roles:
                Object.freeze(request.roles || []),

            permissions:
                Object.freeze(
                    request.permissions || []
                ),

            ipAddress:
                request.ipAddress || null,

            userAgent:
                request.userAgent || null,

            authenticationMethod:
                request.authenticationMethod ||
                'UNKNOWN'

        });
    }

    /**
     * =========================================================
     * Public API Skeleton
     * =========================================================
     */

    async post() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'post() will be implemented in Milestone 1.1 Part 2.'
        );
    }

    async preview() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'preview() will be implemented in Milestone 1.1 Part 2.'
        );
    }

    async validate() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'validate() will be implemented in Milestone 1.1 Part 2.'
        );
    }

    async reverse() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'reverse() will be implemented in Milestone 1.2.'
        );
    }

    async replay() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'replay() will be implemented in Milestone 1.2.'
        );
    }

    async verify() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'verify() will be implemented in Milestone 1.3.'
        );
    }

    async rebuild() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'rebuild() will be implemented in Milestone 1.3.'
        );
    }

    async closePeriod() {

        throw new LedgerEngineError(
            'NOT_IMPLEMENTED',
            'closePeriod() will be implemented in Milestone 1.5.'
        );
    }

    /**
 * =========================================================
 * Infrastructure Layer
 * ---------------------------------------------------------
 * Enterprise observability & transaction management
 * =========================================================
 */

/**
 * ---------------------------------------------------------
 * Execute inside a managed transaction boundary
 * ---------------------------------------------------------
 */
async executeInTransaction(context, operationName, handler) {

    const session =
        await this.db?.startSession?.();

    const started = process.hrtime.bigint();

    context.transaction.session = session;

    const span =
        this.#startTrace(operationName, context);

    try {

        session?.startTransaction?.();

        this.#recordMetric(
            'ledger.transaction.started',
            1,
            context
        );

        this.#log(
            'info',
            `${operationName} transaction started`,
            context
        );

        const result =
            await handler(session);

        await session?.commitTransaction?.();

        context.transaction.committed = true;

        this.#recordMetric(
            'ledger.transaction.committed',
            1,
            context
        );

        this.#log(
            'info',
            `${operationName} committed`,
            context
        );

        span?.setStatus?.({
            code: 1
        });

        return result;

    } catch (error) {

        try {

            await session?.abortTransaction?.();

        } catch (_) {}

        context.transaction.rolledBack = true;

        this.#recordMetric(
            'ledger.transaction.rollback',
            1,
            context
        );

        this.#log(
            'error',
            `${operationName} rolled back`,
            context,
            error
        );

        span?.recordException?.(error);

        span?.setStatus?.({
            code: 2,
            message: error.message
        });

        throw error;

    } finally {

        session?.endSession?.();

        const duration =
            Number(process.hrtime.bigint() - started) /
            1_000_000;

        this.#recordMetric(
            'ledger.transaction.duration.ms',
            duration,
            context
        );

        span?.end?.();
    }
}

/**
 * ---------------------------------------------------------
 * Structured Logger
 * ---------------------------------------------------------
 */
#log(level, message, context, error = null) {

    const payload = {

        service:
            this.config.serviceName,

        requestId:
            context.request.requestId,

        correlationId:
            context.request.correlationId,

        operationId:
            context.request.operationId,

        tenantId:
            context.tenant.tenantId,

        operation:
            context.request.operation,

        userId:
            context.security.userId,

        transactionId:
            context.transaction.transactionId,

        timestamp:
            new Date().toISOString()
    };

    if (error) {

        payload.error = {

            name: error.name,

            message: error.message,

            stack: error.stack
        };
    }

    this.logger?.[level]?.(message, payload);
}

/**
 * ---------------------------------------------------------
 * Metrics
 * ---------------------------------------------------------
 */
#recordMetric(name, value, context) {

    this.metrics?.record?.({

        name,

        value,

        labels: {

            tenant:
                context.tenant.tenantId,

            operation:
                context.request.operation
        }
    });
}

/**
 * ---------------------------------------------------------
 * OpenTelemetry Tracing
 * ---------------------------------------------------------
 */
#startTrace(operationName, context) {

    if (
        !this.config.enableTracing ||
        !this.tracer?.startSpan
    ) {

        return null;
    }

    const span =
        this.tracer.startSpan(operationName);

    span.setAttribute(
        'ledger.request_id',
        context.request.requestId
    );

    span.setAttribute(
        'ledger.correlation_id',
        context.request.correlationId
    );

    span.setAttribute(
        'ledger.tenant_id',
        context.tenant.tenantId
    );

    span.setAttribute(
        'ledger.operation',
        context.request.operation
    );

    return span;
}

/**
 * ---------------------------------------------------------
 * Engine Health
 * ---------------------------------------------------------
 */
getInfrastructureHealth() {

    return {

        service:
            this.config.serviceName,

        version:
            this.config.version,

        status: 'UP',

        tracing:
            Boolean(this.tracer),

        metrics:
            Boolean(this.metrics),

        eventBus:
            Boolean(this.eventBus),

        cache:
            Boolean(this.cache),

        database:
            Boolean(this.db),

        timestamp:
            new Date().toISOString()
    };
}

/**
 * ---------------------------------------------------------
 * Readiness Probe
 * ---------------------------------------------------------
 */
async isReady() {

    try {

        if (
            this.db?.connection?.readyState !== undefined &&
            this.db.connection.readyState !== 1
        ) {

            return false;
        }

        return true;

    } catch {

        return false;
    }
}

/**
 * ---------------------------------------------------------
 * Liveness Probe
 * ---------------------------------------------------------
 */
isAlive() {

    return true;
}


}

/**
 * =========================================================
 * ENTERPRISE POSTING PIPELINE
 *
 * Flow:
 *
 * Financial Operation
 *        |
 *        v
 * Execution Context
 *        |
 *        v
 * Transaction Boundary
 *        |
 *        v
 * Posting Validator
 *        |
 *        v
 * Journal Builder
 *        |
 *        v
 * Double Entry Validator
 *        |
 *        v
 * Posting Engine
 *        |
 *        v
 * Ledger Repository
 *        |
 *        v
 * Balance Engine
 *        |
 *        v
 * Audit
 *        |
 *        v
 * Event Outbox
 *
 * =========================================================
 */


/**
 * ---------------------------------------------------------
 * POST
 *
 * Authoritative financial write operation
 * ---------------------------------------------------------
 */
async post(
    financialOperation,
    requestContext = {}
){

    const context =
        this.createContext({

            ...requestContext,

            operation:
                "LEDGER_POST"
        });



    return this.executeInTransaction(

        context,

        "ledger.post",

        async(session)=>{


            this.#log(
                "info",
                "Ledger posting started",
                context
            );



            /*
             * Tenant validation
             */
            await this.services
                .tenantService
                ?.validate?.(
                    context.tenant
                );



            /*
             * Idempotency protection
             */
            if(
                this.config.enforceIdempotency &&
                context.idempotency?.key
            ){

                const existing =
                    await this.services
                        .idempotencyService
                        ?.check?.(
                            context.idempotency.key
                        );


                if(existing){

                    context.idempotency.replay=true;


                    return existing;
                }
            }




            /*
             * Validation
             */
            const validation =
                await this.validate(
                    financialOperation,
                    context
                );


            if(!validation.valid){

                throw new LedgerEngineError(

                    "POSTING_VALIDATION_FAILED",

                    "Financial operation validation failed",

                    {
                        errors:
                            validation.errors
                    }
                );
            }




            /*
             * Journal creation
             */
            const journal =
                await this.services
                    .journalService
                    .build({

                        operation:
                            financialOperation,

                        context
                    });





            /*
             * Double entry verification
             */
            if(
                this.config.enforceDoubleEntry
            ){

                await this.services
                    .postingValidator
                    ?.validateDoubleEntry?.(
                        journal
                    );
            }





            /*
             * Execute ledger posting
             */
            const ledger =
                await this.services
                    .postingEngine
                    .post({

                        journal,

                        session,

                        context
                    });






            /*
             * Persist immutable ledger
             */
            await this.repositories
                .ledger
                .save({

                    ledger,

                    session
                });






            /*
             * Update balances
             */
            await this.services
                .balanceService
                ?.updateFromLedger?.({

                    ledger,

                    context,

                    session
                });







            /*
             * Audit trail
             */
            await this.services
                .auditService
                ?.record?.({

                    action:
                        "LEDGER_POST",

                    entity:
                        ledger,

                    context,

                    session
                });







            /*
             * Event outbox
             *
             * Published after commit
             */
            await this.services
                .eventOutbox
                ?.store?.({

                    type:
                        "LedgerPosted",

                    aggregateId:
                        ledger.id,

                    payload:
                        ledger,

                    context,

                    session
                });







            /*
             * Save idempotency response
             */
            await this.services
                .idempotencyService
                ?.store?.({

                    key:
                        context.idempotency?.key,

                    result:
                        ledger
                });





            this.#log(
                "info",
                "Ledger posting completed",
                context
            );


            return ledger;

        }
    );
}








/**
 * ---------------------------------------------------------
 * PREVIEW
 *
 * No persistence
 * ---------------------------------------------------------
 */
async preview(
    financialOperation,
    requestContext={}
){

    const context =
        this.createContext({

            ...requestContext,

            operation:
                "LEDGER_PREVIEW"
        });




    const validation =
        await this.validate(
            financialOperation,
            context
        );



    if(!validation.valid){

        return {

            valid:false,

            errors:
                validation.errors
        };
    }





    const journal =
        await this.services
            .journalService
            .build({

                operation:
                    financialOperation,

                context
            });





    await this.services
        .postingValidator
        ?.validateDoubleEntry?.(
            journal
        );




    return {

        valid:true,

        preview:true,

        journal
    };

}








/**
 * ---------------------------------------------------------
 * VALIDATION GATEWAY
 * ---------------------------------------------------------
 */
async validate(
    financialOperation,
    context
){

    const errors=[];




    const validators=[

        "validateStructure",

        "validateAccounts",

        "validateAmounts"

    ];




    for(
        const validator of validators
    ){

        const result =
            await this.services
                .postingValidator
                ?.[
                    validator
                ]
                ?.(
                    financialOperation,
                    context
                );



        if(
            result &&
            !result.valid
        ){

            errors.push(
                ...(result.errors || [])
            );
        }

    }





    return {

        valid:
            errors.length===0,

        errors

    };

}

/**
 * =========================================================
 * PART 3 — REVERSE / REPLAY FRAMEWORK
 *
 * Implements:
 *
 * reverse()
 * replay()
 *
 * Principles:
 *
 * Immutable ledger correction
 * Compensation-based accounting
 * Safe historical reconstruction
 *
 * =========================================================
 */


/**
 * ---------------------------------------------------------
 * REVERSE
 *
 * Creates compensating journal entries.
 *
 * Original transaction remains untouched.
 *
 * Flow:
 *
 * Existing Ledger
 *        |
 *        v
 * Validate Reversal
 *        |
 *        v
 * Generate Compensation Journal
 *        |
 *        v
 * Validate Double Entry
 *        |
 *        v
 * Post Reversal
 *        |
 *        v
 * Audit
 *        |
 *        v
 * Publish Event
 *
 * ---------------------------------------------------------
 */
async reverse(
    ledgerId,
    reversalRequest = {},
    requestContext = {}
) {


    const context =
        this.createContext({

            ...requestContext,

            operation:
                'LEDGER_REVERSAL'
        });



    return this.executeInTransaction(
        context,
        'ledger.reverse',
        async(session)=>{


            this.#log(
                'info',
                'Ledger reversal started',
                context
            );



            /*
             * 1.
             * Load original ledger
             */
            const originalLedger =
                await this.repositories
                    .ledger
                    .findById(
                        ledgerId,
                        {
                            session
                        }
                    );


            if(!originalLedger){

                throw new LedgerEngineError(
                    'LEDGER_NOT_FOUND',
                    'Cannot reverse missing ledger entry'
                );
            }



            /*
             * 2.
             * Verify tenant ownership
             */
            if(
                this.config.enforceTenantIsolation &&
                originalLedger.tenantId !==
                    context.tenant.tenantId
            ){

                throw new LedgerEngineError(
                    'TENANT_MISMATCH',
                    'Ledger does not belong to tenant'
                );
            }



            /*
             * 3.
             * Check reversal eligibility
             */
            await this.services
                .reversalService
                ?.validate?.({

                    ledger:
                        originalLedger,

                    context
                });



            /*
             * 4.
             * Create compensating journal
             */
            const reversalJournal =
                await this.services
                    .reversalService
                    .createCompensationJournal({

                        original:
                            originalLedger,

                        reason:
                            reversalRequest.reason,

                        context
                    });



            /*
             * 5.
             * Validate compensation entry
             */
            await this.services
                .postingValidator
                .validateDoubleEntry(
                    reversalJournal
                );



            /*
             * 6.
             * Post reversal
             */
            const reversalLedger =
                await this.services
                    .postingEngine
                    .post({

                        journal:
                            reversalJournal,

                        session,

                        context
                    });



            /*
             * 7.
             * Persist reversal ledger
             */
            await this.repositories
                .ledger
                .save({

                    ledger:
                        reversalLedger,

                    session
                });



            /*
             * 8.
             * Link original transaction
             */
            await this.repositories
                .ledger
                .linkReversal?.({

                    originalId:
                        originalLedger.id,

                    reversalId:
                        reversalLedger.id,

                    session
                });



            /*
             * 9.
             * Restore balances
             */
            await this.services
                .balanceService
                ?.updateFromLedger({

                    ledger:
                        reversalLedger,

                    context,

                    session
                });



            /*
             * 10.
             * Audit
             */
            await this.services
                .auditService
                ?.record({

                    action:
                        'LEDGER_REVERSED',

                    entity:
                        reversalLedger,

                    metadata:{

                        originalLedgerId:
                            originalLedger.id
                    },

                    context
                });



            /*
             * 11.
             * Publish event
             */
            await this.eventBus
                ?.publish?.({

                    type:
                        'LedgerReversed',

                    payload:{

                        original:
                            originalLedger,

                        reversal:
                            reversalLedger
                    },

                    context
                });



            this.#log(
                'info',
                'Ledger reversal completed',
                context
            );


            return reversalLedger;


        }
    );
}







/**
 * ---------------------------------------------------------
 * REPLAY
 *
 * Reconstructs ledger state from immutable history.
 *
 * Used for:
 *
 * - disaster recovery
 * - balance rebuilding
 * - audit verification
 * - migration
 *
 * ---------------------------------------------------------
 */
async replay(
    replayRequest = {},
    requestContext = {}
){


    const context =
        this.createContext({

            ...requestContext,

            operation:
                'LEDGER_REPLAY'
        });



    return this.executeInTransaction(
        context,
        'ledger.replay',
        async(session)=>{


            this.#log(
                'info',
                'Ledger replay started',
                context
            );



            /*
             * 1.
             * Load immutable ledger history
             */
            const history =
                await this.repositories
                    .ledger
                    .getHistory({

                        tenantId:
                            context.tenant.tenantId,

                        from:
                            replayRequest.from,

                        to:
                            replayRequest.to,

                        session
                    });



            if(!history.length){

                return {

                    rebuilt:false,

                    reason:
                        'No ledger history found'
                };
            }



            /*
             * 2.
             * Verify ledger integrity
             */
            const integrity =
                await this.services
                    .auditService
                    ?.verifyLedgerChain?.(
                        history
                    );


            if(
                integrity &&
                !integrity.valid
            ){

                throw new LedgerEngineError(
                    'LEDGER_INTEGRITY_FAILURE',
                    'Ledger chain verification failed',
                    integrity
                );
            }



            /*
             * 3.
             * Rebuild balances
             */
            const rebuiltState =
                await this.services
                    .balanceService
                    ?.rebuildFromLedger({

                        history,

                        context,

                        session
                    });



            /*
             * 4.
             * Verify rebuilt state
             */
            const verification =
                await this.services
                    .balanceService
                    ?.verifyConsistency?.({

                        state:
                            rebuiltState,

                        context
                    });



            if(
                verification &&
                !verification.valid
            ){

                throw new LedgerEngineError(
                    'BALANCE_REBUILD_FAILED',
                    'Replay consistency verification failed',
                    verification
                );
            }



            /*
             * 5.
             * Audit replay
             */
            await this.services
                .auditService
                ?.record({

                    action:
                        'LEDGER_REPLAY',

                    metadata:{

                        records:
                            history.length
                    },

                    context
                });



            /*
             * 6.
             * Publish replay event
             */
            await this.eventBus
                ?.publish?.({

                    type:
                        'LedgerReplayed',

                    payload:{

                        records:
                            history.length,

                        state:
                            rebuiltState
                    },

                    context
                });



            this.#log(
                'info',
                'Ledger replay completed',
                context
            );



            return {

                rebuilt:true,

                records:
                    history.length,

                state:
                    rebuiltState
            };


        }
    );
}

/**
 * =========================================================
 * PART 4 — VERIFICATION & REBUILD FRAMEWORK
 *
 * Implements:
 *
 * verify()
 * rebuild()
 *
 * Responsibilities:
 *
 * - Ledger integrity verification
 * - Hash chain validation
 * - Journal balance verification
 * - Account balance verification
 * - Reconciliation
 * - Snapshot rebuilding
 * - Cache rebuilding
 * - Recovery event publishing
 *
 * =========================================================
 */


/**
 * ---------------------------------------------------------
 * VERIFY
 *
 * Performs complete financial integrity verification.
 *
 * Flow:
 *
 * Ledger
 *   |
 *   ▼
 * Hash Chain Validation
 *   |
 *   ▼
 * Journal Verification
 *   |
 *   ▼
 * Double Entry Verification
 *   |
 *   ▼
 * Balance Verification
 *   |
 *   ▼
 * Reconciliation
 *
 * ---------------------------------------------------------
 */
async verify(
    verificationRequest = {},
    requestContext = {}
) {


    const context =
        this.createContext({

            ...requestContext,

            operation:
                'LEDGER_VERIFY'
        });



    return this.executeInTransaction(
        context,
        'ledger.verify',
        async(session)=>{


            this.#log(
                'info',
                'Ledger verification started',
                context
            );



            const result = {

                valid:true,

                checks:{},

                errors:[],

                timestamp:
                    new Date()
            };



            /*
             * 1.
             * Load ledger history
             */
            const ledgerHistory =
                await this.repositories
                    .ledger
                    .getHistory({

                        tenantId:
                            context.tenant.tenantId,

                        from:
                            verificationRequest.from,

                        to:
                            verificationRequest.to,

                        session
                    });



            /*
             * 2.
             * Hash chain validation
             */
            const hashValidation =
                await this.services
                    .auditService
                    ?.verifyLedgerChain?.(
                        ledgerHistory
                    );


            result.checks.hashChain =
                hashValidation || {
                    valid:true
                };



            if(
                hashValidation &&
                !hashValidation.valid
            ){

                result.valid=false;

                result.errors.push(
                    'Ledger hash chain validation failed'
                );
            }



            /*
             * 3.
             * Journal balance verification
             */
            for(
                const ledgerEntry of ledgerHistory
            ){

                const journalCheck =
                    await this.services
                        .postingValidator
                        ?.validateDoubleEntry(
                            ledgerEntry.journal
                        );


                if(
                    journalCheck &&
                    journalCheck.valid === false
                ){

                    result.valid=false;


                    result.errors.push({

                        journalId:
                            ledgerEntry.journalId,

                        error:
                            'Journal debit credit mismatch'
                    });
                }
            }


            result.checks.journals =
            {
                validated:
                    ledgerHistory.length
            };



            /*
             * 4.
             * Account balance verification
             */
            const balanceVerification =
                await this.services
                    .balanceService
                    ?.verifyConsistency?.({

                        tenantId:
                            context.tenant.tenantId,

                        ledger:
                            ledgerHistory,

                        context
                    });



            result.checks.balances =
                balanceVerification || {
                    valid:true
                };



            if(
                balanceVerification &&
                !balanceVerification.valid
            ){

                result.valid=false;

                result.errors.push(
                    'Account balance inconsistency detected'
                );
            }



            /*
             * 5.
             * Reconciliation
             */
            const reconciliation =
                await this.services
                    .balanceService
                    ?.reconcile?.({

                        ledger:
                            ledgerHistory,

                        context
                    });



            result.checks.reconciliation =
                reconciliation || {
                    valid:true
                };



            if(
                reconciliation &&
                !reconciliation.valid
            ){

                result.valid=false;

                result.errors.push(
                    'Ledger reconciliation failed'
                );
            }




            /*
             * Audit verification
             */
            await this.services
                .auditService
                ?.record({

                    action:
                        'LEDGER_VERIFICATION',

                    metadata:
                        result,

                    context
                });



            /*
             * Event
             */
            await this.eventBus
                ?.publish?.({

                    type:
                        'LedgerVerified',

                    payload:
                        result,

                    context
                });



            this.#log(
                result.valid
                    ? 'info'
                    : 'error',

                'Ledger verification completed',

                context
            );



            return result;


        }
    );
}







/**
 * ---------------------------------------------------------
 * REBUILD
 *
 * Restores derived financial state from immutable ledger.
 *
 * Flow:
 *
 * Ledger History
 *       |
 *       ▼
 * Recalculate Balances
 *       |
 *       ▼
 * Restore Snapshots
 *       |
 *       ▼
 * Rebuild Cache
 *       |
 *       ▼
 * Verify
 *       |
 *       ▼
 * Recovery Events
 *
 * ---------------------------------------------------------
 */
async rebuild(
    rebuildRequest = {},
    requestContext = {}
){

    const context =
        this.createContext({

            ...requestContext,

            operation:
                'LEDGER_REBUILD'
        });



    return this.executeInTransaction(
        context,
        'ledger.rebuild',
        async(session)=>{


            this.#log(
                'warn',
                'Ledger rebuild started',
                context
            );



            /*
             * 1.
             * Load immutable ledger
             */
            const history =
                await this.repositories
                    .ledger
                    .getHistory({

                        tenantId:
                            context.tenant.tenantId,

                        from:
                            rebuildRequest.from,

                        to:
                            rebuildRequest.to,

                        session
                    });



            if(!history.length){

                throw new LedgerEngineError(
                    'NO_LEDGER_HISTORY',
                    'Cannot rebuild without ledger history'
                );
            }



            /*
             * 2.
             * Recalculate balances
             */
            const balances =
                await this.services
                    .balanceService
                    ?.rebuildFromLedger({

                        history,

                        context,

                        session
                    });



            /*
             * 3.
             * Rebuild snapshots
             */
            const snapshots =
                await this.services
                    .snapshotService
                    ?.rebuild?.({

                        history,

                        balances,

                        context,

                        session
                    });



            /*
             * 4.
             * Rebuild cache
             */
            await this.cache
                ?.invalidateTenant?.(
                    context.tenant.tenantId
                );


            await this.services
                .balanceService
                ?.refreshCache?.({

                    balances,

                    context
                });



            /*
             * 5.
             * Verify rebuilt state
             */
            const verification =
                await this.verify(
                    {

                        from:
                            rebuildRequest.from,

                        to:
                            rebuildRequest.to

                    },

                    requestContext
                );



            if(!verification.valid){

                throw new LedgerEngineError(
                    'REBUILD_VERIFICATION_FAILED',
                    'Rebuilt ledger failed integrity checks',
                    verification
                );
            }



            const result = {

                rebuilt:true,

                ledgerEntries:
                    history.length,

                balances,

                snapshots,

                verification,

                completedAt:
                    new Date()
            };



            /*
             * Audit recovery
             */
            await this.services
                .auditService
                ?.record({

                    action:
                        'LEDGER_REBUILD',

                    metadata:
                        result,

                    context
                });



            /*
             * Publish recovery event
             */
            await this.eventBus
                ?.publish?.({

                    type:
                        'LedgerRebuilt',

                    payload:
                        result,

                    context
                });



            this.#log(
                'info',
                'Ledger rebuild completed',
                context
            );



            return result;


        }
    );
}

/**
 * =========================================================
 * PART 5 — PERIOD CLOSE & ENTERPRISE HARDENING
 *
 * Implements:
 *
 * closePeriod()
 *
 * Flow:
 *
 * Validate Open Period
 *        |
 *        ▼
 * Lock Transactions
 *        |
 *        ▼
 * Generate Final Snapshot
 *        |
 *        ▼
 * Freeze Ledger
 *        |
 *        ▼
 * Create Next Accounting Period
 *        |
 *        ▼
 * Audit Close
 *        |
 *        ▼
 * Publish PeriodClosed Event
 *
 * =========================================================
 */


/**
 * ---------------------------------------------------------
 * CLOSE PERIOD
 *
 * Controls accounting period lifecycle.
 *
 * States:
 *
 * OPEN
 *   |
 *   ▼
 * LOCKED
 *   |
 *   ▼
 * CLOSED
 *
 * ---------------------------------------------------------
 */
async closePeriod(
    periodRequest = {},
    requestContext = {}
) {


    const context =
        this.createContext({

            ...requestContext,

            operation:
                'PERIOD_CLOSE'
        });



    return this.executeInTransaction(
        context,
        'ledger.closePeriod',
        async(session)=>{


            const startTime =
                Date.now();



            this.#log(
                'info',
                'Financial period close started',
                context
            );



            try {


                /*
                 * 1.
                 * Validate period state
                 */
                const period =
                    await this.services
                        .periodCloseService
                        ?.getPeriod?.({

                            tenantId:
                                context.tenant.tenantId,

                            periodId:
                                periodRequest.periodId
                        });



                if(!period){

                    throw new LedgerEngineError(
                        'PERIOD_NOT_FOUND',
                        'Financial period does not exist'
                    );
                }



                if(
                    period.status !== 'OPEN'
                ){

                    throw new LedgerEngineError(
                        'PERIOD_NOT_OPEN',
                        'Only OPEN periods can be closed',
                        {
                            currentStatus:
                                period.status
                        }
                    );
                }



                /*
                 * 2.
                 * Validate ledger state
                 */
                const verification =
                    await this.verify(
                        {

                            from:
                                period.startDate,

                            to:
                                period.endDate

                        },
                        requestContext
                    );



                if(
                    !verification.valid
                ){

                    throw new LedgerEngineError(
                        'PERIOD_VALIDATION_FAILED',
                        'Ledger integrity failed before close',
                        verification
                    );
                }



                /*
                 * 3.
                 * Lock transactions
                 */
                await this.services
                    .periodCloseService
                    ?.lockPeriod?.({

                        periodId:
                            period.id,

                        tenantId:
                            context.tenant.tenantId,

                        session
                    });



                /*
                 * 4.
                 * Generate final snapshot
                 */
                const snapshot =
                    await this.services
                        .snapshotService
                        ?.create?.({

                            type:
                                'PERIOD_CLOSE',

                            period,

                            context,

                            session
                        });



                /*
                 * 5.
                 * Freeze ledger
                 */
                await this.services
                    .periodCloseService
                    ?.freezeLedger?.({

                        period,

                        tenantId:
                            context.tenant.tenantId,

                        session
                    });



                /*
                 * 6.
                 * Close current period
                 */
                const closedPeriod =
                    await this.services
                        .periodCloseService
                        ?.close?.({

                            periodId:
                                period.id,

                            snapshotId:
                                snapshot?.id,

                            closedBy:
                                context.security.userId,

                            session
                        });



                /*
                 * 7.
                 * Create next accounting period
                 */
                const nextPeriod =
                    await this.services
                        .periodCloseService
                        ?.createNextPeriod?.({

                            closedPeriod,

                            session
                        });



                const result = {

                    closed:true,

                    period:
                        closedPeriod,

                    nextPeriod,

                    snapshot,

                    durationMs:
                        Date.now() - startTime

                };



                /*
                 * 8.
                 * Audit
                 */
                await this.services
                    .auditService
                    ?.record({

                        action:
                            'PERIOD_CLOSED',

                        entity:
                            closedPeriod,

                        metadata:
                            result,

                        context
                    });



                /*
                 * 9.
                 * Publish event
                 */
                await this.eventBus
                    ?.publish?.({

                        type:
                            'PeriodClosed',

                        payload:
                            result,

                        context
                    });



                /*
                 * 10.
                 * Metrics
                 */
                this.#recordMetric(
                    'ledger.period.closed',
                    1,
                    context
                );


                this.#recordMetric(
                    'ledger.period.close.duration.ms',
                    result.durationMs,
                    context
                );



                this.#log(
                    'info',
                    'Financial period close completed',
                    context
                );



                return result;



            } catch(error){


                this.#recordMetric(
                    'ledger.period.close.failed',
                    1,
                    context
                );


                this.#log(
                    'error',
                    'Financial period close failed',
                    context,
                    error
                );


                throw error;
            }

        }
    );
}

module.exports = {
    LedgerEngine,
    LedgerEngineError
};