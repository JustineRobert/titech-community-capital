'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Correlation Engine
 * =============================================================================
 *
 * Purpose
 * -------
 * Provides enterprise-grade callback correlation between Airtel Money callback
 * notifications and internal payment transactions.
 *
 * This service is responsible for identifying the correct internal payment,
 * tenant, transaction, and financial workflow that a provider callback belongs
 * to before handing it over to the callback processor.
 *
 * -----------------------------------------------------------------------------
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Transaction lookup
 * • Tenant resolution
 * • Payment correlation
 * • Provider reference matching
 * • External reference matching
 * • Duplicate callback detection
 * • Correlation confidence scoring
 * • Unknown callback identification
 * • Fraud escalation hooks
 * • Audit integration
 * • Metrics
 * • Distributed tracing
 * • Operational diagnostics
 *
 * -----------------------------------------------------------------------------
 * Explicitly NOT Responsible For
 * -----------------------------------------------------------------------------
 * • Signature verification
 * • Payload validation
 * • HTTP callback handling
 * • Payment execution
 * • Ledger posting
 * • Settlement execution
 * • Reconciliation processing
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    ValidationError,
    NotFoundError,
    normalizeError
} = require('../../../shared/errors');

/**
 * =============================================================================
 * Internal Constants
 * =============================================================================
 */

const PROVIDER = Object.freeze({

    NAME: 'AIRTEL',

    MODULE: 'callback-correlation',

    VERSION: '1.0.0'

});

const HEALTH_STATUS = Object.freeze({

    STARTING: 'STARTING',

    READY: 'READY',

    DEGRADED: 'DEGRADED',

    STOPPING: 'STOPPING',

    DOWN: 'DOWN'

});

const CORRELATION_STATUS = Object.freeze({

    MATCHED: 'MATCHED',

    PARTIAL: 'PARTIAL',

    UNKNOWN: 'UNKNOWN',

    DUPLICATE: 'DUPLICATE',

    REVIEW: 'REVIEW',

    FAILED: 'FAILED'

});

const MATCH_TYPE = Object.freeze({

    PROVIDER_REFERENCE: 'PROVIDER_REFERENCE',

    EXTERNAL_REFERENCE: 'EXTERNAL_REFERENCE',

    PAYMENT_REFERENCE: 'PAYMENT_REFERENCE',

    CUSTOMER_REFERENCE: 'CUSTOMER_REFERENCE',

    PHONE_NUMBER: 'PHONE_NUMBER',

    FALLBACK: 'FALLBACK'

});

const CONFIDENCE = Object.freeze({

    VERY_HIGH: 100,

    HIGH: 90,

    MEDIUM: 70,

    LOW: 40,

    UNKNOWN: 0

});

const DEFAULTS = Object.freeze({

    cacheTTL: 300,

    correlationTimeoutMs: 5000,

    maxRetries: 3,

    duplicateWindowSeconds: 300,

    minimumConfidence: 70

});

/**
 * =============================================================================
 * CallbackCorrelation
 * =============================================================================
 */

class CallbackCorrelation {

    constructor({

        paymentRepository,

        transactionRepository,

        tenantRepository,

        callbackRepository,

        customerRepository,

        accountRepository,

        idempotencyManager,

        fraudEngine,

        auditService,

        metrics,

        tracer,

        logger,

        eventBus,

        cache,

        configuration,

        clock = Date

    } = {}) {

        /**
         * ---------------------------------------------------------------------
         * Core Dependencies
         * ---------------------------------------------------------------------
         */

        this.paymentRepository = paymentRepository;

        this.transactionRepository = transactionRepository;

        this.tenantRepository = tenantRepository;

        this.callbackRepository = callbackRepository;

        this.customerRepository = customerRepository;

        this.accountRepository = accountRepository;

        this.idempotencyManager = idempotencyManager;

        this.fraudEngine = fraudEngine;

        this.auditService = auditService;

        this.metrics = metrics;

        this.tracer = tracer;

        this.logger = logger;

        this.eventBus = eventBus;

        this.cache = cache;

        this.configuration = configuration;

        this.clock = clock;

        /**
         * ---------------------------------------------------------------------
         * Runtime Configuration
         * ---------------------------------------------------------------------
         */

        this.options = Object.freeze({

            cacheTTL:

                configuration?.cacheTTL ??
                DEFAULTS.cacheTTL,

            correlationTimeoutMs:

                configuration?.correlationTimeoutMs ??
                DEFAULTS.correlationTimeoutMs,

            duplicateWindowSeconds:

                configuration?.duplicateWindowSeconds ??
                DEFAULTS.duplicateWindowSeconds,

            minimumConfidence:

                configuration?.minimumConfidence ??
                DEFAULTS.minimumConfidence,

            maxRetries:

                configuration?.maxRetries ??
                DEFAULTS.maxRetries

        });

        /**
         * ---------------------------------------------------------------------
         * Runtime State
         * ---------------------------------------------------------------------
         */

        this.runtime = {

            initialized: false,

            startedAt: new Date(),

            lastCorrelation: null,

            lastSuccessfulCorrelation: null,

            lastFailure: null,

            activeCorrelations: new Map(),

            pendingCallbacks: new Map(),

            duplicateCache: new Map(),

            providerCache: new Map()

        };

        /**
         * ---------------------------------------------------------------------
         * Health State
         * ---------------------------------------------------------------------
         */

        this.healthState = {

            status: HEALTH_STATUS.STARTING,

            provider: PROVIDER.NAME,

            module: PROVIDER.MODULE,

            version: PROVIDER.VERSION,

            initialized: false,

            startupCompleted: false,

            dependenciesHealthy: false,

            lastHealthCheck: null,

            lastSuccessfulHealthCheck: null,

            lastFailure: null

        };

        /**
         * ---------------------------------------------------------------------
         * Statistics
         * ---------------------------------------------------------------------
         */

        this.statistics = {

            callbacksReceived: 0,

            callbacksMatched: 0,

            callbacksUnknown: 0,

            callbacksDuplicate: 0,

            callbacksRejected: 0,

            callbacksReviewed: 0,

            tenantResolved: 0,

            tenantResolutionFailures: 0,

            providerReferenceMatches: 0,

            externalReferenceMatches: 0,

            customerMatches: 0,

            fuzzyMatches: 0,

            fraudEscalations: 0,

            cacheHits: 0,

            cacheMisses: 0,

            retries: 0,

            failures: 0,

            averageConfidence: 0,

            totalConfidence: 0,

            uptimeStartedAt: new Date()

        };

        /**
         * ---------------------------------------------------------------------
         * Internal Correlation Cache
         * ---------------------------------------------------------------------
         */

        this.correlationCache = new Map();

        /**
         * ---------------------------------------------------------------------
         * Initialization Promise
         * ---------------------------------------------------------------------
         */

        this.initializationPromise = null;
    }

    /**
     * =========================================================================
     * Initialization
     * =========================================================================
     */

    async initialize() {

        if (this.runtime.initialized) {

            return this;
        }

        if (this.initializationPromise) {

            return this.initializationPromise;
        }

        this.initializationPromise = this.performInitialization();

        return this.initializationPromise;
    }

    /**
     * Internal initialization routine.
     * Remaining dependency validation, readiness verification,
     * startup metrics, and graceful degradation are implemented
     * in Part 2.
     */

    async performInitialization() {

        this.logger?.info?.({

            message:
                'Initializing Airtel Callback Correlation Engine',

            provider:
                PROVIDER.NAME,

            module:
                PROVIDER.MODULE

        });

        this.healthState.status =
            HEALTH_STATUS.STARTING;

        this.runtime.initialized = true;

        this.healthState.initialized = true;

        return this;
    }

    /**
 * =========================================================================
 * Part 2.1A — Core Cache Infrastructure
 * =========================================================================
 */

    /**
     * -------------------------------------------------------------------------
     * Build Enterprise Cache Key
     * -------------------------------------------------------------------------
     */

    buildCacheKey({

        tenantId,

        providerReference,

        transactionReference,

        paymentReference,

        phoneNumber,

        type = 'correlation'

    } = {}) {

        const components = [

            'payment',

            PROVIDER.NAME.toLowerCase(),

            type,

            tenantId || 'global',

            providerReference || '-',

            transactionReference || '-',

            paymentReference || '-',

            phoneNumber || '-'

        ];

        return components.join(':');
    }

    /**
     * -------------------------------------------------------------------------
     * Resolve Cache TTL
     * -------------------------------------------------------------------------
     */

    resolveCacheTTL(ttl) {

        if (

            Number.isFinite(ttl) &&

            ttl > 0

        ) {

            return ttl;

        }

        return this.options.cacheTTL;

    }

    /**
     * -------------------------------------------------------------------------
     * Retrieve Cached Correlation
     * -------------------------------------------------------------------------
     */

    async getCachedCorrelation({

        tenantId,

        providerReference,

        transactionReference,

        paymentReference,

        phoneNumber,

        ttl

    } = {}) {

        const key = this.buildCacheKey({

            tenantId,

            providerReference,

            transactionReference,

            paymentReference,

            phoneNumber

        });

        const started = Date.now();

        try {

            /**
             * --------------------------------------------------------------
             * External cache (Redis)
             * --------------------------------------------------------------
             */

            if (

                this.cache &&

                typeof this.cache.get === 'function'

            ) {

                const cached =

                    await this.cache.get(key);

                if (cached) {

                    this.statistics.cacheHits++;

                    this.metrics?.counter?.(

                        'payment_airtel_callback_cache_hit_total'

                    );

                    this.metrics?.histogram?.(

                        'payment_airtel_callback_cache_lookup_ms',

                        Date.now() - started

                    );

                    return cached;
                }
            }

            /**
             * --------------------------------------------------------------
             * Local in-memory cache
             * --------------------------------------------------------------
             */

            const local =

                this.correlationCache.get(key);

            if (!local) {

                this.statistics.cacheMisses++;

                return null;
            }

            if (

                local.expiresAt <= Date.now()

            ) {

                this.correlationCache.delete(key);

                this.statistics.cacheMisses++;

                return null;
            }

            this.statistics.cacheHits++;

            this.metrics?.counter?.(

                'payment_airtel_callback_cache_hit_total'

            );

            return local.value;

        }

        catch (error) {

            this.logger?.warn?.({

                message:

                    'Correlation cache lookup failed',

                cacheKey: key,

                error:

                    error.message

            });

            return null;

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Store Correlation Result
     * -------------------------------------------------------------------------
     */

    async setCachedCorrelation({

        tenantId,

        providerReference,

        transactionReference,

        paymentReference,

        phoneNumber,

        value,

        ttl

    } = {}) {

        const key = this.buildCacheKey({

            tenantId,

            providerReference,

            transactionReference,

            paymentReference,

            phoneNumber

        });

        const expiresAt =

            Date.now() +

            (

                this.resolveCacheTTL(ttl)

                *

                1000

            );

        const record = Object.freeze({

            key,

            value,

            createdAt:

                new Date(),

            expiresAt

        });

        /**
         * --------------------------------------------------------------
         * Local cache
         * --------------------------------------------------------------
         */

        this.correlationCache.set(

            key,

            record

        );

        /**
         * --------------------------------------------------------------
         * Distributed cache
         * --------------------------------------------------------------
         */

        if (

            this.cache &&

            typeof this.cache.set === 'function'

        ) {

            await this.cache.set(

                key,

                value,

                this.resolveCacheTTL(ttl)

            );

        }

        this.metrics?.counter?.(

            'payment_airtel_callback_cache_store_total'

        );

        return record;

    }

    /**
     * -------------------------------------------------------------------------
     * Determine Whether Cache Entry Is Expired
     * -------------------------------------------------------------------------
     */

    isCacheExpired(entry) {

        if (!entry) {

            return true;

        }

        return (

            entry.expiresAt <= Date.now()

        );

    }

    /**
 * =========================================================================
 * Part 2.1B — Cache Operations & Observability
 * =========================================================================
 */

    /**
     * -------------------------------------------------------------------------
     * Invalidate Cache Entry
     * -------------------------------------------------------------------------
     */
    async invalidateCache({

        tenantId,

        providerReference,

        transactionReference,

        paymentReference,

        phoneNumber

    } = {}) {

        const key = this.buildCacheKey({

            tenantId,
            providerReference,
            transactionReference,
            paymentReference,
            phoneNumber

        });

        const span = this.tracer?.startSpan?.(
            'airtel.callback.cache.invalidate'
        );

        try {

            this.correlationCache.delete(key);

            if (
                this.cache &&
                typeof this.cache.delete === 'function'
            ) {

                await this.cache.delete(key);

            }
            else if (
                this.cache &&
                typeof this.cache.del === 'function'
            ) {

                await this.cache.del(key);

            }

            this.metrics?.counter?.(
                'payment_airtel_callback_cache_invalidation_total'
            );

            this.logger?.debug?.({

                message:
                    'Callback correlation cache invalidated',

                cacheKey:
                    key

            });

            return true;

        }
        finally {

            span?.end?.();

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Clear Entire Cache
     * -------------------------------------------------------------------------
     */
    async clearCache() {

        const span = this.tracer?.startSpan?.(
            'airtel.callback.cache.clear'
        );

        try {

            this.correlationCache.clear();

            if (
                this.cache &&
                typeof this.cache.flush === 'function'
            ) {

                await this.cache.flush();

            }

            this.metrics?.counter?.(
                'payment_airtel_callback_cache_clear_total'
            );

            return true;

        }
        finally {

            span?.end?.();

        }

    }

    /**
     * -------------------------------------------------------------------------
     * Remove Expired Cache Entries
     * -------------------------------------------------------------------------
     */
    pruneExpiredCache() {

        let removed = 0;

        const now = Date.now();

        for (const [key, record] of this.correlationCache.entries()) {

            if (

                !record ||

                record.expiresAt <= now

            ) {

                this.correlationCache.delete(key);

                removed++;

            }

        }

        this.metrics?.gauge?.(

            'payment_airtel_callback_cache_pruned',

            removed

        );

        return removed;

    }

    /**
     * -------------------------------------------------------------------------
     * Aggregate Cache Statistics
     * -------------------------------------------------------------------------
     */
    getCacheStatistics() {

        const totalRequests =

            this.statistics.cacheHits +

            this.statistics.cacheMisses;

        const hitRate =

            totalRequests === 0

                ? 0

                : Number(

                    (

                        this.statistics.cacheHits /

                        totalRequests

                    ).toFixed(4)

                );

        return {

            entries:
                this.correlationCache.size,

            hits:
                this.statistics.cacheHits,

            misses:
                this.statistics.cacheMisses,

            hitRate,

            ttlSeconds:
                this.options.cacheTTL,

            totalRequests

        };

    }

    /**
     * -------------------------------------------------------------------------
     * Cache Health
     * -------------------------------------------------------------------------
     */
    cacheHealth() {

        const stats = this.getCacheStatistics();

        return {

            status:

                stats.hitRate >= 0.70

                    ? 'UP'

                    : 'DEGRADED',

            provider:
                PROVIDER.NAME,

            component:
                'callback-cache',

            statistics:
                stats,

            timestamp:
                new Date()

        };

    }

    /**
     * -------------------------------------------------------------------------
     * Cache Snapshot
     * -------------------------------------------------------------------------
     */
    cacheSnapshot() {

        return {

            provider:
                PROVIDER.NAME,

            module:
                PROVIDER.MODULE,

            generatedAt:
                new Date(),

            runtimeUptimeMs:

                Date.now() -

                this.runtime.startedAt.getTime(),

            cache:

                this.getCacheStatistics(),

            runtime: {

                initialized:
                    this.runtime.initialized,

                activeCorrelations:

                    this.runtime.activeCorrelations.size,

                pendingCallbacks:

                    this.runtime.pendingCallbacks.size

            }

        };

    }

    /**
     * -------------------------------------------------------------------------
     * Cache Diagnostics
     * -------------------------------------------------------------------------
     */
    cacheDiagnostics() {

        return {

            provider:
                PROVIDER.NAME,

            component:
                'callback-cache',

            health:
                this.cacheHealth(),

            snapshot:
                this.cacheSnapshot(),

            memoryEntries:

                this.correlationCache.size,

            distributedCache:

                Boolean(this.cache),

            generatedAt:
                new Date()

        };

    }

    /**
     * -------------------------------------------------------------------------
     * Execute Cache Operation With Tracing
     * -------------------------------------------------------------------------
     */
    async traceCacheOperation(

        operation,

        handler

    ) {

        const span = this.tracer?.startSpan?.(

            `airtel.callback.cache.${operation}`

        );

        const started = Date.now();

        try {

            const result = await handler();

            this.metrics?.histogram?.(

                'payment_airtel_callback_cache_duration_ms',

                Date.now() - started,

                {

                    operation

                }

            );

            return result;

        }
        catch (error) {

            this.metrics?.counter?.(

                'payment_airtel_callback_cache_errors_total',

                {

                    operation

                }

            );

            this.logger?.error?.({

                operation,

                error:
                    error.message

            });

            throw error;

        }
        finally {

            span?.end?.();

        }

    }

    /**
 * =========================================================================
 * Part 2.2A.1 — Lookup Context Foundation
 * =========================================================================
 *
 * Provides:
 *
 * • Lookup context creation
 * • Correlation ID generation
 * • Request metadata propagation
 * • Tenant context handling
 * • Trace context propagation
 * • Lookup execution options
 *
 * This context object becomes the immutable execution envelope passed
 * throughout the correlation pipeline.
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Create Lookup Context
     * -------------------------------------------------------------------------
     */

    createLookupContext({

        tenantId = null,

        callback = {},

        headers = {},

        traceContext = {},

        options = {}

    } = {}) {


        const correlationId =

            this.generateCorrelationId();



        const requestId =

            headers['x-request-id']

            ||

            crypto.randomUUID();



        const receivedAt =

            new this.clock();




        const context = Object.freeze({


            /**
             * Identity
             */

            correlationId,

            requestId,



            /**
             * Provider Context
             */

            provider:

                PROVIDER.NAME,


            module:

                PROVIDER.MODULE,



            /**
             * Tenant Context
             */

            tenant: {

                id:

                    tenantId || null

            },



            /**
             * Callback Metadata
             */

            callback: {

                transactionId:

                    callback.transactionId

                    ||

                    callback.id

                    ||

                    null,


                reference:

                    callback.reference

                    ||

                    callback.externalReference

                    ||

                    null,


                receivedAt

            },



            /**
             * Request Metadata
             */

            request: {

                userAgent:

                    headers['user-agent']

                    ||

                    null,


                source:

                    headers['x-source']

                    ||

                    'AIRTEL',


                ip:

                    headers['x-forwarded-for']

                    ||

                    null


            },



            /**
             * Distributed Trace Context
             */

            trace: {


                traceId:

                    traceContext.traceId

                    ||

                    null,


                spanId:

                    traceContext.spanId

                    ||

                    null,


                parentSpanId:

                    traceContext.parentSpanId

                    ||

                    null


            },



            /**
             * Execution Options
             */

            options: {


                timeoutMs:

                    options.timeoutMs

                    ||

                    this.options.correlationTimeoutMs,


                allowFallback:

                    options.allowFallback !== false,


                useCache:

                    options.useCache !== false,


                strict:

                    options.strict === true


            },



            /**
             * Runtime
             */

            createdAt:

                receivedAt,


            status:

                CORRELATION_STATUS.PARTIAL


        });



        return context;

    }



    /**
     * -------------------------------------------------------------------------
     * Generate Correlation ID
     * -------------------------------------------------------------------------
     */

    generateCorrelationId() {


        return crypto.randomUUID();


    }



    /**
     * -------------------------------------------------------------------------
     * Extend Existing Lookup Context
     * -------------------------------------------------------------------------
     *
     * Creates a new immutable context without mutating the original one.
     *
     */

    extendLookupContext(

        context,

        extension = {}

    ) {


        return Object.freeze({


            ...context,


            ...extension,


            metadata: {


                ...(context.metadata || {}),


                ...(extension.metadata || {})


            }


        });


    }



    /**
     * -------------------------------------------------------------------------
     * Validate Lookup Context
     * -------------------------------------------------------------------------
     */

    validateLookupContext(context) {


        if (!context) {


            throw new ValidationError(

                'Lookup context required'

            );


        }



        if (!context.correlationId) {


            throw new ValidationError(

                'Correlation ID missing'

            );


        }



        if (!context.provider) {


            throw new ValidationError(

                'Provider context missing'

            );


        }



        return true;

    }



    /**
     * -------------------------------------------------------------------------
     * Build Repository Request Envelope
     * -------------------------------------------------------------------------
     *
     * Normalizes data passed into repositories.
     *
     */

    buildRepositoryContext(context) {


        this.validateLookupContext(context);



        return Object.freeze({


            tenantId:

                context.tenant.id,



            correlationId:

                context.correlationId,



            requestId:

                context.requestId,



            provider:

                context.provider,



            trace:

                context.trace,



            options:

                context.options



        });


    }



    /**
     * -------------------------------------------------------------------------
     * Lookup Context Snapshot
     * -------------------------------------------------------------------------
     *
     * Safe diagnostic representation.
     *
     */

    lookupContextSnapshot(context) {


        if (!context) {


            return null;


        }



        return {


            correlationId:

                context.correlationId,


            requestId:

                context.requestId,


            provider:

                context.provider,


            tenantId:

                context.tenant.id,


            callbackReference:

                context.callback.reference,


            createdAt:

                context.createdAt,


            options:

                context.options


        };


    }

    /**
 * =========================================================================
 * Part 2.2A.2 — Orchestration Framework
 * =========================================================================
 *
 * Provides:
 *
 * • executeLookup()
 * • Repository dispatch
 * • Lookup lifecycle state management
 * • OpenTelemetry tracing
 * • Metrics instrumentation
 * • Audit hooks
 * • Structured logging
 * • Timeout protection
 * • Error normalization
 * • Retry-aware repository execution
 * • Active operation tracking
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Execute Lookup Operation
     * -------------------------------------------------------------------------
     */

    async executeLookup({

        context,

        operation,

        repository,

        execute,

        metadata = {}

    }) {


        this.validateLookupContext(context);



        const operationId =

            crypto.randomUUID();



        const startedAt =

            Date.now();



        const span =

            this.tracer?.startSpan?.(

                `airtel.callback.lookup.${operation}`

            );



        const operationState = {


            id:

                operationId,


            operation,


            correlationId:

                context.correlationId,


            startedAt:

                new Date(),


            status:

                'RUNNING',


            repository

        };



        this.runtime.activeCorrelations.set(

            operationId,

            operationState

        );




        try {


            this.statistics.callbacksReceived++;



            this.logger?.debug?.({

                message:

                    'Lookup operation started',


                operation,


                operationId,


                correlationId:

                    context.correlationId

            });





            /**
             * -------------------------------------------------------------
             * Metrics - Started
             * -------------------------------------------------------------
             */


            this.metrics?.counter?.(

                'payment_airtel_callback_lookup_started_total',

                {

                    operation

                }

            );






            /**
             * -------------------------------------------------------------
             * Audit Hook
             * -------------------------------------------------------------
             */


            await this.executeAuditHook({

                action:

                    'LOOKUP_STARTED',


                context,


                metadata

            });







            /**
             * -------------------------------------------------------------
             * Timeout Protected Execution
             * -------------------------------------------------------------
             */


            const result =

                await this.executeWithTimeout({

                    execute,


                    timeoutMs:

                        context.options.timeoutMs

                });






            operationState.status =

                'COMPLETED';



            operationState.completedAt =

                new Date();




            this.runtime.lastCorrelation =

                operationState;



            this.runtime.lastSuccessfulCorrelation =

                operationState;







            /**
             * -------------------------------------------------------------
             * Metrics - Success
             * -------------------------------------------------------------
             */


            this.metrics?.counter?.(

                'payment_airtel_callback_lookup_success_total',

                {

                    operation

                }

            );




            this.metrics?.histogram?.(

                'payment_airtel_callback_lookup_duration_ms',

                Date.now() - startedAt,

                {

                    operation

                }

            );







            await this.executeAuditHook({

                action:

                    'LOOKUP_COMPLETED',


                context,


                metadata: {


                    operation,


                    repository

                }

            });






            return result;



        }

        catch (error) {


            operationState.status =

                'FAILED';



            operationState.error =

                error.message;



            this.runtime.lastFailure =

                operationState;



            this.statistics.failures++;






            this.metrics?.counter?.(

                'payment_airtel_callback_lookup_failure_total',

                {

                    operation

                }

            );





            await this.executeAuditHook({

                action:

                    'LOOKUP_FAILED',


                context,


                metadata: {


                    operation,


                    error:

                        error.message

                }

            });






            throw this.normalizeLookupError(

                error,

                context

            );



        }

        finally {


            this.runtime.activeCorrelations.delete(

                operationId

            );



            span?.end?.();



        }


    }







    /**
     * -------------------------------------------------------------------------
     * Repository Dispatch
     * -------------------------------------------------------------------------
     */

    async dispatchRepository({

        repository,

        method,

        payload,

        context

    }) {



        if (!repository) {


            throw new ValidationError(

                'Repository dependency missing'

            );


        }



        const handler =

            repository[method];



        if (

            typeof handler !== 'function'

        ) {


            throw new ValidationError(

                `Repository method unavailable: ${method}`

            );


        }



        return this.executeWithRetry(async () => {


            return handler.call(

                repository,

                {

                    ...payload,

                    context:

                        this.buildRepositoryContext(

                            context

                        )

                }

            );


        });

    }







    /**
     * -------------------------------------------------------------------------
     * Retry Aware Execution
     * -------------------------------------------------------------------------
     */

    async executeWithRetry(

        operation

    ) {


        let attempt = 0;



        while (

            attempt <

            this.options.maxRetries

        ) {


            try {


                return await operation();



            }

            catch (error) {


                attempt++;


                this.statistics.retries++;



                if (

                    attempt >=

                    this.options.maxRetries

                ) {


                    throw error;


                }



                await this.sleep(

                    1000 * attempt

                );


            }


        }


    }







    /**
     * -------------------------------------------------------------------------
     * Timeout Wrapper
     * -------------------------------------------------------------------------
     */

    async executeWithTimeout({

        execute,

        timeoutMs

    }) {


        return Promise.race([



            execute(),



            new Promise(

                (_, reject) => {


                    setTimeout(() => {


                        reject(

                            new Error(

                                'Lookup timeout exceeded'

                            )

                        );


                    }, timeoutMs);


                }

            )



        ]);


    }








    /**
     * -------------------------------------------------------------------------
     * Audit Hook Execution
     * -------------------------------------------------------------------------
     */

    async executeAuditHook({

        action,

        context,

        metadata = {}

    }) {


        if (

            !this.auditService

        ) {


            return;


        }



        await this.auditService.record({


            action,


            provider:

                PROVIDER.NAME,


            tenantId:

                context.tenant.id,


            correlationId:

                context.correlationId,


            metadata



        });


    }







    /**
     * -------------------------------------------------------------------------
     * Error Normalization
     * -------------------------------------------------------------------------
     */

    normalizeLookupError(

        error,

        context

    ) {



        const normalized =

            normalizeError(error);



        normalized.context = {


            correlationId:

                context.correlationId,


            provider:

                context.provider,


            tenantId:

                context.tenant.id


        };



        return normalized;


    }







    /**
     * -------------------------------------------------------------------------
     * Sleep Utility
     * -------------------------------------------------------------------------
     */

    sleep(ms) {


        return new Promise(

            resolve =>

                setTimeout(

                    resolve,

                    ms

                )

        );


    }







    /**
     * -------------------------------------------------------------------------
     * Active Lookup Operations Snapshot
     * -------------------------------------------------------------------------
     */

    activeLookupSnapshot() {


        return {


            active:

                this.runtime.activeCorrelations.size,


            operations:

                Array.from(

                    this.runtime.activeCorrelations.values()

                )


        };


    }

    /**
 * =========================================================================
 * Part 2.2B.1 — Lookup Strategy Foundation
 * =========================================================================
 *
 * Enterprise correlation lookup pipeline.
 *
 * Strategy order:
 *
 * 1. Resolve tenant
 * 2. Provider reference lookup
 * 3. Payment reference lookup
 * 4. Transaction lookup
 * 5. Normalize result
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Correlation Lookup Entry Point
     * -------------------------------------------------------------------------
     */

    async executeCorrelationLookup({

        context,

        callback

    }) {


        this.validateLookupContext(context);



        const span =

            this.tracer?.startSpan?.(

                'airtel.callback.correlation.lookup'

            );



        const startedAt = Date.now();



        try {


            await this.executeAuditHook({

                action:

                    'CORRELATION_LOOKUP_STARTED',

                context,

                metadata: {

                    callbackReference:

                        callback.reference

                }

            });





            const tenant =

                await this.resolveTenant({

                    context,

                    callback

                });






            const lookupContext =

                this.extendLookupContext(

                    context,

                    {

                        tenant: {

                            id:

                                tenant?.id

                                ||

                                context.tenant.id

                        }

                    }

                );







            const strategies = [



                {

                    name:

                        'PROVIDER_REFERENCE',

                    execute:

                        () =>

                            this.findByProviderReference({

                                context:

                                    lookupContext,

                                callback

                            })

                },



                {

                    name:

                        'PAYMENT_REFERENCE',

                    execute:

                        () =>

                            this.findByPaymentReference({

                                context:

                                    lookupContext,

                                callback

                            })

                },



                {

                    name:

                        'TRANSACTION_REFERENCE',

                    execute:

                        () =>

                            this.findTransaction({

                                context:

                                    lookupContext,

                                callback

                            })

                }


            ];






            let result = null;



            for (const strategy of strategies) {


                result = await strategy.execute();



                if (result) {


                    result.strategy =

                        strategy.name;


                    break;


                }


            }






            const normalized =

                this.normalizeLookupResult({

                    result,

                    context:

                        lookupContext,

                    callback

                });






            if (!normalized.matched) {


                this.statistics.callbacksUnknown++;



                await this.handleUnknownCallback({

                    context:

                        lookupContext,

                    callback

                });


            }






            this.metrics?.histogram?.(

                'payment_airtel_callback_correlation_lookup_duration_ms',

                Date.now() - startedAt

            );





            await this.executeAuditHook({

                action:

                    'CORRELATION_LOOKUP_COMPLETED',

                context:

                    lookupContext,

                metadata:

                    normalized

            });





            return normalized;



        }

        catch (error) {


            this.statistics.failures++;



            await this.executeAuditHook({

                action:

                    'CORRELATION_LOOKUP_FAILED',

                context,

                metadata: {

                    error:

                        error.message

                }

            });



            throw error;


        }

        finally {


            span?.end?.();


        }


    }









    /**
     * -------------------------------------------------------------------------
     * Tenant Resolution
     * -------------------------------------------------------------------------
     */

    async resolveTenant({

        context,

        callback

    }) {


        if (context.tenant.id) {


            return {

                id:

                    context.tenant.id

            };


        }




        return this.executeLookup({

            context,

            operation:

                'tenant-resolution',

            repository:

                this.tenantRepository,

            execute:

                async () => {



                    if (

                        !this.tenantRepository

                    ) {


                        return null;


                    }



                    return this.tenantRepository.findByProvider({

                        provider:

                            PROVIDER.NAME,


                        providerReference:

                            callback.providerReference

                    });


                }

        });


    }









    /**
     * -------------------------------------------------------------------------
     * Provider Reference Lookup
     * -------------------------------------------------------------------------
     */

    async findByProviderReference({

        context,

        callback

    }) {



        if (

            !callback.providerReference

        ) {


            return null;


        }



        const cached =

            await this.getCachedCorrelation({

                tenantId:

                    context.tenant.id,


                providerReference:

                    callback.providerReference

            });



        if (cached) {


            return cached;


        }






        const result =

            await this.executeLookup({

                context,

                operation:

                    'provider-reference-lookup',

                repository:

                    this.paymentRepository,

                execute:

                    async () => {


                        if (

                            !this.paymentRepository

                        ) {


                            return null;


                        }



                        return this.paymentRepository.findOne({

                            tenantId:

                                context.tenant.id,


                            provider:

                                PROVIDER.NAME,


                            providerReference:

                                callback.providerReference


                        });


                    }


            });







        if (result) {


            await this.setCachedCorrelation({

                tenantId:

                    context.tenant.id,


                providerReference:

                    callback.providerReference,


                value:

                    result

            });


        }



        return result;


    }









    /**
     * -------------------------------------------------------------------------
     * Payment Reference Lookup
     * -------------------------------------------------------------------------
     */

    async findByPaymentReference({

        context,

        callback

    }) {


        if (

            !callback.paymentReference

        ) {


            return null;


        }



        return this.executeLookup({

            context,

            operation:

                'payment-reference-lookup',

            repository:

                this.paymentRepository,

            execute:

                async () => {


                    return this.paymentRepository?.findOne?.({

                        tenantId:

                            context.tenant.id,


                        reference:

                            callback.paymentReference


                    });


                }


        });


    }









    /**
     * -------------------------------------------------------------------------
     * Transaction Lookup
     * -------------------------------------------------------------------------
     */

    async findTransaction({

        context,

        callback

    }) {



        if (

            !callback.transactionReference

        ) {


            return null;


        }





        return this.executeLookup({

            context,

            operation:

                'transaction-reference-lookup',

            repository:

                this.transactionRepository,

            execute:

                async () => {


                    return this.transactionRepository?.findOne?.({

                        tenantId:

                            context.tenant.id,


                        reference:

                            callback.transactionReference


                    });


                }


        });


    }









    /**
     * -------------------------------------------------------------------------
     * Normalize Lookup Result
     * -------------------------------------------------------------------------
     */

    normalizeLookupResult({

        result,

        context,

        callback

    }) {



        if (!result) {


            return {

                matched:

                    false,


                status:

                    CORRELATION_STATUS.UNKNOWN,


                correlationId:

                    context.correlationId,


                provider:

                    PROVIDER.NAME,


                callbackReference:

                    callback.reference

            };


        }






        return {


            matched:

                true,


            status:

                CORRELATION_STATUS.MATCHED,


            correlationId:

                context.correlationId,


            tenantId:

                context.tenant.id,


            strategy:

                result.strategy || null,


            payment:

                result.payment || result,


            confidence:

                CONFIDENCE.HIGH


        };


    }









    /**
     * -------------------------------------------------------------------------
     * Unknown Callback Handler
     * -------------------------------------------------------------------------
     */

    async handleUnknownCallback({

        context,

        callback

    }) {



        await this.eventBus?.publish?.({

            type:

                'AIRTEL_UNKNOWN_CALLBACK',


            payload: {

                correlationId:

                    context.correlationId,


                callback

            }


        });



        this.metrics?.counter?.(

            'payment_airtel_unknown_callback_total'

        );


    }

    /**
 * =========================================================================
 * Part 2.2B.2 — Advanced Matching Layer
 * =========================================================================
 *
 * Advanced correlation strategies used when direct provider/payment/
 * transaction reference matching fails.
 *
 * Matching hierarchy:
 *
 * 1. External reference
 * 2. Customer reference
 * 3. Phone number
 * 4. Amount + time window
 * 5. Multi-match resolution
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Execute Advanced Matching Pipeline
     * -------------------------------------------------------------------------
     */

    async executeAdvancedMatching({

        context,

        callback,

        partialResult = null

    }) {


        const span =

            this.tracer?.startSpan?.(

                'airtel.callback.advanced.matching'

            );


        try {


            const strategies = [

                {

                    name:

                        'EXTERNAL_REFERENCE',

                    execute:

                        () =>

                            this.findByExternalReference({

                                context,

                                callback

                            })

                },


                {

                    name:

                        'CUSTOMER_REFERENCE',

                    execute:

                        () =>

                            this.findByCustomerReference({

                                context,

                                callback

                            })

                },


                {

                    name:

                        'PHONE_NUMBER',

                    execute:

                        () =>

                            this.findByPhoneNumber({

                                context,

                                callback

                            })

                },


                {

                    name:

                        'AMOUNT_TIME_WINDOW',

                    execute:

                        () =>

                            this.findByAmountTimeWindow({

                                context,

                                callback

                            })

                }

            ];



            const candidates = [];



            for (const strategy of strategies) {


                const result =

                    await strategy.execute();



                if (result) {


                    candidates.push({

                        strategy:

                            strategy.name,

                        result

                    });


                }


            }



            return this.resolveMultipleMatches({

                context,

                callback,

                candidates,

                partialResult

            });


        }

        finally {


            span?.end?.();


        }

    }








    /**
     * -------------------------------------------------------------------------
     * External Reference Matching
     * -------------------------------------------------------------------------
     */

    async findByExternalReference({

        context,

        callback

    }) {


        if (!callback.externalReference) {


            return null;


        }



        return this.executeLookup({

            context,

            operation:

                'external-reference-match',

            repository:

                this.paymentRepository,

            execute:

                async () => {


                    return this.paymentRepository?.findOne?.({

                        tenantId:

                            context.tenant.id,


                        externalReference:

                            callback.externalReference


                    });


                }

        });


    }









    /**
     * -------------------------------------------------------------------------
     * Customer Reference Matching
     * -------------------------------------------------------------------------
     */

    async findByCustomerReference({

        context,

        callback

    }) {


        if (!callback.customerReference) {


            return null;


        }



        return this.executeLookup({

            context,

            operation:

                'customer-reference-match',

            repository:

                this.customerRepository,

            execute:

                async () => {


                    return this.customerRepository?.findPaymentByCustomerReference?.({

                        tenantId:

                            context.tenant.id,


                        customerReference:

                            callback.customerReference


                    });


                }

        });


    }









    /**
     * -------------------------------------------------------------------------
     * Phone Number Matching
     * -------------------------------------------------------------------------
     */

    async findByPhoneNumber({

        context,

        callback

    }) {


        if (!callback.phoneNumber) {


            return null;


        }



        return this.executeLookup({

            context,

            operation:

                'phone-number-match',

            repository:

                this.paymentRepository,

            execute:

                async () => {


                    return this.paymentRepository?.findRecentByPhoneNumber?.({

                        tenantId:

                            context.tenant.id,


                        phoneNumber:

                            callback.phoneNumber,


                        limit:

                            10


                    });


                }

        });


    }









    /**
     * -------------------------------------------------------------------------
     * Amount + Time Window Matching
     * -------------------------------------------------------------------------
     */

    async findByAmountTimeWindow({

        context,

        callback

    }) {


        if (

            !callback.amount

        ) {


            return null;


        }



        return this.executeLookup({

            context,

            operation:

                'amount-time-window-match',

            repository:

                this.transactionRepository,

            execute:

                async () => {


                    return this.transactionRepository?.findCandidates?.({

                        tenantId:

                            context.tenant.id,


                        amount:

                            callback.amount,


                        currency:

                            callback.currency,


                        from:

                            new Date(

                                Date.now()

                                -

                                15 *

                                60 *

                                1000

                            ),


                        to:

                            new Date()


                    });


                }

        });


    }









    /**
     * -------------------------------------------------------------------------
     * Multi Match Resolution
     * -------------------------------------------------------------------------
     */

    resolveMultipleMatches({

        context,

        callback,

        candidates,

        partialResult

    }) {


        if (!candidates.length) {


            return null;


        }



        const scored =

            candidates.map(candidate => ({


                ...candidate,


                confidence:

                    this.calculateConfidence({

                        strategy:

                            candidate.strategy,


                        result:

                            candidate.result,


                        callback

                    })


            }));





        scored.sort(

            (a, b) =>

                b.confidence -

                a.confidence

        );



        const best = scored[0];



        return {


            ...best.result,


            strategy:

                best.strategy,


            confidence:

                best.confidence,


            candidates:

                scored.length


        };


    }









    /**
     * -------------------------------------------------------------------------
     * Confidence Calculation
     * -------------------------------------------------------------------------
     */

    calculateConfidence({

        strategy,

        result,

        callback

    }) {


        let score = 0;



        switch (strategy) {


            case 'EXTERNAL_REFERENCE':

                score += 95;

                break;



            case 'CUSTOMER_REFERENCE':

                score += 85;

                break;



            case 'PHONE_NUMBER':

                score += 70;

                break;



            case 'AMOUNT_TIME_WINDOW':

                score += 60;

                break;



            default:

                score += 20;


        }





        if (

            result?.amount &&

            callback.amount &&

            Number(result.amount) ===

            Number(callback.amount)

        ) {


            score += 5;


        }



        return Math.min(

            score,

            100

        );


    }









    /**
     * -------------------------------------------------------------------------
     * Enhanced Result Normalization
     * -------------------------------------------------------------------------
     */

    normalizeAdvancedLookupResult({

        result,

        context,

        callback

    }) {


        if (!result) {


            return {


                matched:

                    false,


                status:

                    CORRELATION_STATUS.UNKNOWN,


                correlationId:

                    context.correlationId


            };


        }



        const confidence =

            result.confidence ||

            CONFIDENCE.MEDIUM;



        return {


            matched:

                confidence >=

                this.options.minimumConfidence,


            status:

                confidence >=

                    this.options.minimumConfidence

                    ?

                    CORRELATION_STATUS.MATCHED

                    :

                    CORRELATION_STATUS.REVIEW,


            confidence,


            tenantId:

                context.tenant.id,


            provider:

                PROVIDER.NAME,


            entity:

                result


        };


    }









    /**
     * -------------------------------------------------------------------------
     * Fraud Signal Extraction
     * -------------------------------------------------------------------------
     */

    async generateFraudSignals({

        context,

        callback,

        result

    }) {


        const signals = [];



        if (

            !result

        ) {


            signals.push({

                type:

                    'UNKNOWN_CALLBACK'


            });


        }



        if (

            callback.amount &&

            Number(callback.amount) <= 0

        ) {


            signals.push({

                type:

                    'INVALID_AMOUNT'


            });


        }



        if (

            this.fraudEngine?.evaluate

        ) {


            const fraudResult =

                await this.fraudEngine.evaluate({

                    provider:

                        PROVIDER.NAME,


                    callback,


                    context


                });



            signals.push(

                ...(

                    fraudResult.signals ||

                    []

                )

            );


        }



        if (signals.length) {


            this.statistics.fraudEscalations++;



            this.metrics?.counter?.(

                'payment_airtel_callback_fraud_signal_total'

            );


        }



        return signals;


    }


    /**
     * =========================================================================
     * Part 2.2B.3 — Correlation Preparation Layer
     * =========================================================================
     *
     * Final stage before callback processing.
     *
     * Responsibilities:
     *
     * • Build authoritative correlation result
     * • Explain matching decision
     * • Calculate confidence
     * • Route unknown callbacks
     * • Escalate fraud signals
     * • Complete audit lifecycle
     * • Publish enterprise events
     *
     * =========================================================================
     */


    /**
     * -------------------------------------------------------------------------
     * Build Final Correlation Result
     * -------------------------------------------------------------------------
     */

    async buildCorrelationResult({

        context,

        callback,

        matchedEntity = null,

        candidates = [],

        fraudSignals = []

    }) {


        const confidence =

            this.calculateFinalConfidence({

                callback,

                matchedEntity,

                candidates,

                fraudSignals

            });




        const result = Object.freeze({


            correlationId:

                context.correlationId,


            provider:

                PROVIDER.NAME,


            tenantId:

                context.tenant.id,



            status:

                this.resolveCorrelationStatus({

                    confidence,

                    matchedEntity

                }),



            matched:

                Boolean(matchedEntity),



            entity:

                matchedEntity,



            confidence,



            explanation:

                this.buildMatchExplanation({

                    confidence,

                    matchedEntity,

                    candidates

                }),



            fraudSignals,



            callbackReference:

                callback.reference,



            createdAt:

                new Date()


        });





        await this.completeCorrelationAudit({

            context,

            result

        });




        await this.publishCorrelationEvent({

            context,

            result

        });





        this.recordCorrelationMetrics(result);



        return result;

    }









    /**
     * -------------------------------------------------------------------------
     * Enhanced Confidence Engine
     * -------------------------------------------------------------------------
     */

    calculateFinalConfidence({

        callback,

        matchedEntity,

        candidates = [],

        fraudSignals = []

    }) {



        let score = 0;



        if (matchedEntity) {


            score += 50;


        }



        if (

            matchedEntity?.providerReference &&

            callback.providerReference ===

            matchedEntity.providerReference

        ) {


            score += 35;


        }



        if (

            matchedEntity?.amount &&

            callback.amount &&

            Number(

                matchedEntity.amount

            )

            ===

            Number(

                callback.amount

            )

        ) {


            score += 10;


        }




        if (candidates.length > 1) {


            score -= 10;


        }





        if (fraudSignals.length) {


            score -=

                Math.min(

                    fraudSignals.length * 5,

                    30

                );


        }



        return Math.max(

            Math.min(score, 100),

            0

        );


    }









    /**
     * -------------------------------------------------------------------------
     * Correlation Status Resolver
     * -------------------------------------------------------------------------
     */

    resolveCorrelationStatus({

        confidence,

        matchedEntity

    }) {


        if (!matchedEntity) {


            return CORRELATION_STATUS.UNKNOWN;


        }



        if (

            confidence >= 90

        ) {


            return CORRELATION_STATUS.MATCHED;


        }



        if (

            confidence >= 60

        ) {


            return CORRELATION_STATUS.REVIEW;


        }



        return CORRELATION_STATUS.FAILED;


    }









    /**
     * -------------------------------------------------------------------------
     * Match Explainability
     * -------------------------------------------------------------------------
     */

    buildMatchExplanation({

        confidence,

        matchedEntity,

        candidates

    }) {


        return {


            confidence,


            matched:

                Boolean(matchedEntity),



            strategy:

                matchedEntity?.strategy || null,



            candidateCount:

                candidates.length,



            factors: [

                matchedEntity?.providerReference

                    ?

                    'PROVIDER_REFERENCE_MATCH'

                    :

                    null,


                matchedEntity?.amount

                    ?

                    'AMOUNT_VALIDATION'

                    :

                    null


            ].filter(Boolean)


        };


    }









    /**
     * -------------------------------------------------------------------------
     * Unknown Callback Workflow
     * -------------------------------------------------------------------------
     */

    async processUnknownCallback({

        context,

        callback,

        reason = 'NO_MATCH'

    }) {


        const payload = {


            correlationId:

                context.correlationId,


            tenantId:

                context.tenant.id,


            provider:

                PROVIDER.NAME,


            callback,


            reason,


            createdAt:

                new Date()


        };





        this.metrics?.counter?.(

            'payment_airtel_callback_unknown_total'

        );




        await this.auditService?.record?.({

            action:

                'UNKNOWN_CALLBACK_DETECTED',


            ...payload


        });





        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_UNKNOWN',


            payload

        });





        return payload;


    }









    /**
     * -------------------------------------------------------------------------
     * Fraud Escalation Workflow
     * -------------------------------------------------------------------------
     */

    async escalateFraud({

        context,

        callback,

        signals

    }) {


        if (!signals.length) {


            return false;


        }




        const payload = {


            provider:

                PROVIDER.NAME,


            correlationId:

                context.correlationId,


            tenantId:

                context.tenant.id,


            signals,


            callback


        };





        await this.auditService?.record?.({

            action:

                'CALLBACK_FRAUD_ESCALATION',


            ...payload


        });





        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_FRAUD_ALERT',


            payload

        });





        return true;


    }









    /**
     * -------------------------------------------------------------------------
     * Audit Completion
     * -------------------------------------------------------------------------
     */

    async completeCorrelationAudit({

        context,

        result

    }) {


        await this.auditService?.record?.({

            action:

                'CORRELATION_COMPLETED',


            provider:

                PROVIDER.NAME,


            correlationId:

                context.correlationId,


            tenantId:

                context.tenant.id,


            metadata:

            {

                status:

                    result.status,


                confidence:

                    result.confidence

            }


        });


    }









    /**
     * -------------------------------------------------------------------------
     * Correlation Metrics
     * -------------------------------------------------------------------------
     */

    recordCorrelationMetrics(result) {


        this.metrics?.counter?.(

            'payment_airtel_callback_correlations_total',

            {

                status:

                    result.status

            }

        );



        this.metrics?.histogram?.(

            'payment_airtel_callback_confidence_score',

            result.confidence

        );


    }









    /**
     * -------------------------------------------------------------------------
     * Event Publishing
     * -------------------------------------------------------------------------
     */

    async publishCorrelationEvent({

        context,

        result

    }) {


        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_CORRELATED',


            payload: {


                correlationId:

                    context.correlationId,


                result


            }


        });


    }









    /**
     * -------------------------------------------------------------------------
     * Callback Routing Decision
     * -------------------------------------------------------------------------
     */

    determineCallbackRoute(result) {


        if (

            result.fraudSignals?.length

        ) {


            return 'FRAUD_REVIEW';


        }



        switch (result.status) {


            case CORRELATION_STATUS.MATCHED:

                return 'PROCESS_PAYMENT';



            case CORRELATION_STATUS.REVIEW:

                return 'MANUAL_REVIEW';



            case CORRELATION_STATUS.UNKNOWN:

                return 'UNKNOWN_QUEUE';



            default:

                return 'FAILED_QUEUE';


        }


    }

    /**
 * =========================================================================
 * Part 2.3A — Correlation Intelligence Foundation
 * =========================================================================
 *
 * Provides the runtime foundation for:
 *
 * - AI-assisted correlation
 * - Historical learning
 * - Provider intelligence
 * - SLA monitoring
 * - Automated recovery
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Initialize Intelligence Context
     * -------------------------------------------------------------------------
     */

    createIntelligenceContext({

        context,

        correlationResult,

        callback

    }) {


        return Object.freeze({

            correlationId:

                context.correlationId,


            tenantId:

                context.tenant.id,


            provider:

                PROVIDER.NAME,


            callbackReference:

                callback.reference,


            correlationResult,


            createdAt:

                new Date(),


            signals: [],


            decisions: [],


            metrics: {

                startedAt:

                    Date.now()

            }

        });


    }






    /**
     * -------------------------------------------------------------------------
     * Execute Intelligence Pipeline
     * -------------------------------------------------------------------------
     */

    async executeCorrelationIntelligence({

        context,

        callback,

        correlationResult

    }) {


        const span =

            this.tracer?.startSpan?.(

                'airtel.callback.correlation.intelligence'

            );



        const intelligenceContext =

            this.createIntelligenceContext({

                context,

                callback,

                correlationResult

            });



        try {


            const [

                duplicateCheck,

                historicalScore,

                providerScore,

                fraudScore


            ] = await Promise.all([


                this.detectDuplicateCallback({

                    context,

                    callback

                }),



                this.evaluateHistoricalMatching({

                    context,

                    correlationResult

                }),



                this.evaluateProviderBehavior({

                    context

                }),



                this.evaluateFraudRisk({

                    context,

                    callback,

                    correlationResult

                })

            ]);





            const decision =

                this.buildIntelligenceDecision({

                    intelligenceContext,

                    duplicateCheck,

                    historicalScore,

                    providerScore,

                    fraudScore

                });





            await this.publishIntelligenceEvent({

                context,

                decision

            });



            return decision;



        }

        finally {


            span?.end?.();


        }


    }








    /**
     * -------------------------------------------------------------------------
     * Build Intelligence Decision
     * -------------------------------------------------------------------------
     */

    buildIntelligenceDecision({

        intelligenceContext,

        duplicateCheck,

        historicalScore,

        providerScore,

        fraudScore

    }) {


        const riskScore =

            Math.max(

                fraudScore?.score || 0,

                duplicateCheck?.risk || 0

            );



        return Object.freeze({

            correlationId:

                intelligenceContext.correlationId,


            confidenceAdjustment:

                historicalScore?.adjustment || 0,


            providerReliability:

                providerScore?.score || 0,


            riskScore,



            decision:

                riskScore >= 80

                    ?

                    'BLOCK'

                    :

                    riskScore >= 50

                        ?

                        'REVIEW'

                        :

                        'ALLOW',



            signals: [

                ...(duplicateCheck?.signals || []),

                ...(fraudScore?.signals || [])

            ],



            generatedAt:

                new Date()

        });


    }








    /**
     * -------------------------------------------------------------------------
     * Historical Match Learning Hook
     * -------------------------------------------------------------------------
     */

    async evaluateHistoricalMatching({

        context,

        correlationResult

    }) {


        if (

            !this.correlationHistoryRepository

        ) {


            return {

                adjustment: 0

            };


        }



        const history =

            await this.correlationHistoryRepository.findSimilar({

                tenantId:

                    context.tenant.id,


                provider:

                    PROVIDER.NAME,


                entityId:

                    correlationResult.entity?.id

            });





        if (!history?.length) {


            return {

                adjustment: 0

            };


        }



        return {

            matches:

                history.length,


            adjustment:

                Math.min(

                    history.length * 2,

                    10

                )

        };


    }








    /**
     * -------------------------------------------------------------------------
     * Provider Behaviour Analysis Hook
     * -------------------------------------------------------------------------
     */

    async evaluateProviderBehavior({

        context

    }) {


        if (

            !this.providerAnalytics

        ) {


            return {

                score: 50

            };


        }



        return this.providerAnalytics.evaluate({

            provider:

                PROVIDER.NAME,


            tenantId:

                context.tenant.id

        });


    }








    /**
     * -------------------------------------------------------------------------
     * Publish Intelligence Event
     * -------------------------------------------------------------------------
     */

    async publishIntelligenceEvent({

        context,

        decision

    }) {


        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_INTELLIGENCE_DECISION',


            payload: {

                correlationId:

                    context.correlationId,


                decision

            }


        });


    }

    /**
 * =========================================================================
 * Part 2.3B — Advanced Decision Engine
 * =========================================================================
 *
 * Adaptive intelligence layer for callback correlation.
 *
 * Responsibilities:
 *
 * - AI-assisted confidence adjustment
 * - Duplicate detection
 * - Replay attack intelligence
 * - Fraud risk evaluation
 * - Provider reliability scoring
 * - Historical pattern analysis
 * - Explainable decisions
 * - Automated routing decisions
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Machine Assisted Confidence Scoring
     * -------------------------------------------------------------------------
     */

    async calculateIntelligentConfidence({

        context,

        correlationResult,

        historicalData = {},

        providerScore = {},

        fraudScore = {}

    }) {


        let score =

            correlationResult.confidence || 0;



        /**
         * Historical reliability adjustment
         */

        score +=

            historicalData.adjustment || 0;



        /**
         * Provider reliability adjustment
         */

        if (

            providerScore.score

        ) {

            score +=

                (

                    providerScore.score -

                    50

                )

                /

                10;

        }





        /**
         * Fraud penalty
         */

        if (

            fraudScore.score

        ) {


            score -=

                fraudScore.score

                /

                5;


        }





        return Math.max(

            Math.min(

                Math.round(score),

                100

            ),

            0

        );


    }








    /**
     * -------------------------------------------------------------------------
     * Duplicate Callback Detection
     * -------------------------------------------------------------------------
     */

    async detectDuplicateCallback({

        context,

        callback

    }) {


        const fingerprint =

            this.generateCallbackFingerprint(callback);




        const cached =

            await this.getCachedCorrelation({

                tenantId:

                    context.tenant.id,


                providerReference:

                    fingerprint

            });





        if (cached) {


            return {


                duplicate:

                    true,


                risk:

                    80,


                signals: [


                    'DUPLICATE_CALLBACK'


                ],


                existing:

                    cached


            };


        }






        const existing =

            await this.callbackRepository?.findByFingerprint?.({

                tenantId:

                    context.tenant.id,


                fingerprint

            });






        if (existing) {


            return {


                duplicate:

                    true,


                risk:

                    90,


                signals: [

                    'CALLBACK_REPLAY_DETECTED'

                ],


                existing

            };


        }






        return {


            duplicate:

                false,


            risk:

                0,


            signals:

                []


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Callback Fingerprint Generator
     * -------------------------------------------------------------------------
     */

    generateCallbackFingerprint(callback = {}) {


        const payload = [


            callback.providerReference,

            callback.transactionReference,

            callback.amount,

            callback.currency,

            callback.timestamp


        ].join('|');




        return crypto

            .createHash('sha256')

            .update(payload)

            .digest('hex');


    }








    /**
     * -------------------------------------------------------------------------
     * Replay Intelligence
     * -------------------------------------------------------------------------
     */

    async analyzeCallbackReplay({

        context,

        callback

    }) {


        const age =


            Date.now()

            -

            new Date(

                callback.timestamp

            ).getTime();






        const signals = [];



        if (

            age >

            this.options.maximumCallbackAge

        ) {


            signals.push({

                type:

                    'STALE_CALLBACK',


                severity:

                    'HIGH'


            });


        }





        const duplicate =

            await this.detectDuplicateCallback({

                context,

                callback

            });





        signals.push(

            ...(duplicate.signals || [])

        );





        return {


            replayRisk:

                signals.length

                    ?

                    70

                    :

                    0,


            signals

        };


    }








    /**
     * -------------------------------------------------------------------------
     * Fraud Risk Scoring Engine
     * -------------------------------------------------------------------------
     */

    async evaluateFraudRisk({

        context,

        callback,

        correlationResult

    }) {


        const signals = [];



        let score = 0;





        /**
         * Amount anomaly
         */

        if (

            callback.amount >

            this.options.maximumCallbackAmount

        ) {


            score += 30;



            signals.push({

                type:

                    'HIGH_VALUE_TRANSACTION'


            });


        }






        /**
         * Unknown correlation
         */

        if (

            !correlationResult.matched

        ) {


            score += 40;



            signals.push({

                type:

                    'UNMATCHED_CALLBACK'


            });


        }







        /**
         * External fraud engine
         */

        if (

            this.fraudEngine?.score

        ) {


            const external =

                await this.fraudEngine.score({

                    provider:

                        PROVIDER.NAME,


                    callback,


                    tenantId:

                        context.tenant.id

                });




            score +=

                external.score || 0;




            signals.push(

                ...(external.signals || [])

            );


        }





        return {


            score:

                Math.min(score, 100),


            signals


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Provider Reliability Scoring
     * -------------------------------------------------------------------------
     */

    async calculateProviderReliability({

        provider = PROVIDER.NAME

    } = {}) {


        if (

            !this.providerAnalytics

        ) {


            return {


                score:

                    50


            };


        }






        const metrics =

            await this.providerAnalytics.getMetrics({

                provider

            });






        return {


            score:

                this.calculateProviderScore(metrics),


            metrics


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Provider Score Calculation
     * -------------------------------------------------------------------------
     */

    calculateProviderScore(metrics = {}) {


        let score = 100;



        score -=

            (

                metrics.failureRate || 0

            )

            *

            40;




        score -=

            (

                metrics.timeoutRate || 0

            )

            *

            30;





        score -=

            (

                metrics.averageLatency || 0

            )

            /

            1000;





        return Math.max(

            Math.min(score, 100),

            0

        );


    }








    /**
     * -------------------------------------------------------------------------
     * Historical Pattern Analysis
     * -------------------------------------------------------------------------
     */

    async analyzeHistoricalPatterns({

        context,

        callback

    }) {


        const history =

            await this.correlationHistoryRepository?.findPatterns?.({

                tenantId:

                    context.tenant.id,


                provider:

                    PROVIDER.NAME,


                phoneNumber:

                    callback.phoneNumber


            });





        if (!history?.length) {


            return {


                confidence:

                    0,


                patterns:

                    []

            };


        }





        return {


            confidence:

                Math.min(

                    history.length *

                    5,

                    50

                ),


            patterns:

                history


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Decision Explainability
     * -------------------------------------------------------------------------
     */

    explainDecision({

        decision,

        confidence,

        signals

    }) {


        return {


            decision,


            confidence,


            reasons:

                signals.map(signal => ({


                    signal:

                        signal.type ||

                        signal,


                    impact:

                        signal.severity ||

                        'MEDIUM'


                }))


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Automated Decision Engine
     * -------------------------------------------------------------------------
     */

    buildAutomatedDecision({

        confidence,

        fraudScore,

        duplicate

    }) {


        if (

            duplicate

        ) {


            return 'BLOCK';


        }





        if (

            fraudScore >= 80

        ) {


            return 'BLOCK';


        }






        if (

            fraudScore >= 40

            ||

            confidence < 60

        ) {


            return 'REVIEW';


        }





        return 'ALLOW';


    }








    /**
     * -------------------------------------------------------------------------
     * Intelligence Metrics
     * -------------------------------------------------------------------------
     */

    recordIntelligenceMetrics({

        decision

    }) {


        this.metrics?.counter?.(

            'payment_airtel_callback_intelligence_decisions_total',

            {

                decision

            }

        );



        this.metrics?.histogram?.(

            'payment_airtel_callback_intelligence_confidence',

            decision.confidence || 0

        );


    }

    /**
 * =========================================================================
 * Part 2.3C — Self-Healing & Executive Intelligence Layer
 * =========================================================================
 *
 * Enterprise autonomous operations layer.
 *
 * Responsibilities:
 *
 * - Automated correlation repair
 * - Recovery workflows
 * - SLA monitoring
 * - Executive intelligence
 * - Provider analytics
 * - Continuous improvement
 *
 * =========================================================================
 */


    /**
     * -------------------------------------------------------------------------
     * Generate Automated Repair Suggestions
     * -------------------------------------------------------------------------
     */

    async generateRepairSuggestions({

        context,

        correlationResult,

        intelligenceDecision

    }) {


        const suggestions = [];



        if (

            correlationResult.status ===

            CORRELATION_STATUS.UNKNOWN

        ) {


            suggestions.push({

                action:

                    'RETRY_LOOKUP',


                priority:

                    'HIGH',


                reason:

                    'No matching payment entity found'


            });


        }





        if (

            intelligenceDecision.riskScore >

            50

        ) {


            suggestions.push({

                action:

                    'MANUAL_REVIEW',


                priority:

                    'HIGH',


                reason:

                    'Risk score exceeded threshold'


            });


        }





        if (

            intelligenceDecision.providerReliability <

            60

        ) {


            suggestions.push({

                action:

                    'PROVIDER_ESCALATION',


                priority:

                    'MEDIUM',


                reason:

                    'Provider reliability degraded'


            });


        }





        return suggestions;


    }








    /**
     * -------------------------------------------------------------------------
     * Self Healing Correlation Workflow
     * -------------------------------------------------------------------------
     */

    async executeSelfHealing({

        context,

        callback,

        correlationResult

    }) {


        const span =

            this.tracer?.startSpan?.(

                'airtel.callback.self_healing'

            );



        try {


            const suggestions =

                await this.generateRepairSuggestions({

                    context,

                    correlationResult,

                    intelligenceDecision:

                        correlationResult.intelligence

                });





            const actions = [];





            for (const suggestion of suggestions) {


                switch (

                suggestion.action

                ) {



                    case 'RETRY_LOOKUP':


                        actions.push(

                            await this.retryCorrelationLookup({

                                context,

                                callback

                            })

                        );


                        break;





                    case 'MANUAL_REVIEW':


                        actions.push(

                            await this.routeForReview({

                                context,

                                callback

                            })

                        );


                        break;





                    case 'PROVIDER_ESCALATION':


                        actions.push(

                            await this.escalateProviderIssue({

                                context

                            })

                        );


                        break;



                }


            }





            return {


                suggestions,


                actions,


                healed:

                    actions.length > 0


            };



        }

        finally {


            span?.end?.();


        }


    }








    /**
     * -------------------------------------------------------------------------
     * Retry Correlation Lookup
     * -------------------------------------------------------------------------
     */

    async retryCorrelationLookup({

        context,

        callback

    }) {


        this.metrics?.counter?.(

            'payment_airtel_callback_recovery_retry_total'

        );



        return this.executeCorrelationLookup({

            context,

            callback

        });


    }








    /**
     * -------------------------------------------------------------------------
     * Manual Review Routing
     * -------------------------------------------------------------------------
     */

    async routeForReview({

        context,

        callback

    }) {


        const payload = {


            correlationId:

                context.correlationId,


            callback,


            tenantId:

                context.tenant.id


        };





        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_MANUAL_REVIEW_REQUIRED',


            payload

        });





        return {


            status:

                'QUEUED_FOR_REVIEW'


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Provider Escalation
     * -------------------------------------------------------------------------
     */

    async escalateProviderIssue({

        context

    }) {


        await this.eventBus?.publish?.({

            type:

                'AIRTEL_PROVIDER_HEALTH_DEGRADED',


            payload: {


                provider:

                    PROVIDER.NAME,


                correlationId:

                    context.correlationId


            }


        });





        return {


            status:

                'PROVIDER_ESCALATED'


        };


    }








    /**
     * -------------------------------------------------------------------------
     * SLA Monitoring
     * -------------------------------------------------------------------------
     */

    evaluateCorrelationSLA({

        startedAt,

        completedAt = Date.now()

    }) {


        const duration =

            completedAt -

            startedAt;




        const breached =

            duration >

            this.options.correlationSLAThresholdMs;





        if (breached) {


            this.metrics?.counter?.(

                'payment_airtel_callback_sla_breach_total'

            );


        }





        return {


            durationMs:

                duration,


            breached


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Correlation Recovery Engine
     * -------------------------------------------------------------------------
     */

    async recoverCorrelation({

        context,

        callback,

        attempts = 0

    }) {


        if (

            attempts >=

            this.options.maximumRecoveryAttempts

        ) {


            return {


                recovered:

                    false,


                reason:

                    'MAX_ATTEMPTS_REACHED'


            };


        }





        try {


            const result =

                await this.executeCorrelationLookup({

                    context,

                    callback

                });





            if (

                result.matched

            ) {


                return {


                    recovered:

                        true,


                    result


                };


            }



        }

        catch (error) {


            this.logger?.error?.({

                message:

                    'Correlation recovery failed',


                correlationId:

                    context.correlationId,


                error:

                    error.message


            });


        }






        return this.recoverCorrelation({

            context,

            callback,

            attempts:

                attempts + 1


        });


    }








    /**
     * -------------------------------------------------------------------------
     * Executive Analytics
     * -------------------------------------------------------------------------
     */

    async getExecutiveAnalytics({

        tenantId = null

    }) {


        const statistics =

            this.statistics;





        return {


            provider:

                PROVIDER.NAME,


            tenantId,


            correlations:

                statistics.callbacksReceived,


            failures:

                statistics.failures,


            retries:

                statistics.retries,


            fraudEscalations:

                statistics.fraudEscalations,


            successRate:

                statistics.callbacksReceived

                    ?

                    (

                        (

                            statistics.callbacksReceived -

                            statistics.failures

                        )

                        /

                        statistics.callbacksReceived

                    )

                    *

                    100

                    :

                    0


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Provider Intelligence Report
     * -------------------------------------------------------------------------
     */

    async providerIntelligenceReport() {


        const reliability =

            await this.calculateProviderReliability({

                provider:

                    PROVIDER.NAME

            });





        return {


            provider:

                PROVIDER.NAME,


            reliability,


            generatedAt:

                new Date()


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Operations Dashboard Snapshot
     * -------------------------------------------------------------------------
     */

    async operationalDashboard() {


        return {


            health:

                await this.health(),



            activeOperations:

                this.activeLookupSnapshot(),



            statistics:

                this.statistics,



            intelligence:

                await this.getExecutiveAnalytics()



        };


    }








    /**
     * -------------------------------------------------------------------------
     * Continuous Learning Feedback
     * -------------------------------------------------------------------------
     */

    async recordLearningFeedback({

        context,

        result,

        outcome

    }) {


        await this.correlationHistoryRepository?.record?.({

            tenantId:

                context.tenant.id,


            provider:

                PROVIDER.NAME,


            correlationId:

                context.correlationId,


            result,


            outcome,


            timestamp:

                new Date()


        });


    }








    /**
     * -------------------------------------------------------------------------
     * Intelligence Snapshot
     * -------------------------------------------------------------------------
     */

    intelligenceSnapshot() {


        return {


            provider:

                PROVIDER.NAME,


            statistics:

                this.statistics,



            active:

                this.runtime.activeCorrelations.size,



            generatedAt:

                new Date()


        };


    }








    /**
     * -------------------------------------------------------------------------
     * Production Diagnostics
     * -------------------------------------------------------------------------
     */

    async diagnostics() {


        return {


            provider:

                PROVIDER.NAME,



            runtime:

                this.runtime,



            statistics:

                this.statistics,



            cache:

                this.cacheSnapshot?.(),



            intelligence:

                this.intelligenceSnapshot(),



            timestamp:

                new Date()


        };


    }

    

}

module.exports = CallbackCorrelation;