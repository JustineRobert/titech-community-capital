'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Money Callback Correlation Engine
 * =============================================================================
 *
 * Purpose
 * -------
 * Provides correlation intelligence between Airtel Money callback events and
 * internal TITech payment operations.
 *
 * Responsibilities
 * ----------------
 * • Callback-to-payment correlation
 * • Tenant-aware transaction matching
 * • Provider reference resolution
 * • External reference matching
 * • Idempotent callback tracking
 * • Correlation state management
 * • Callback lifecycle tracking
 * • Duplicate callback detection
 * • Correlation confidence scoring
 * • Audit integration
 * • Metrics publication
 * • Distributed tracing hooks
 * • Operational diagnostics
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Callback HTTP receiving
 * • Signature verification
 * • Callback persistence
 * • Ledger posting
 * • Settlement processing
 * • Provider communication
 *
 * Integration
 * -----------
 * Used by:
 *
 * Airtel Callback Controller
 *          |
 *          v
 * Callback Validator
 *          |
 *          v
 * Callback Correlation Engine
 *          |
 *          v
 * Payment Processor
 *
 * =============================================================================
 */

const crypto = require('crypto');

const {
    normalizeError,
    ValidationError
} = require('../../../shared/errors');


/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const PROVIDER = Object.freeze({

    NAME: 'AIRTEL',

    MODULE: 'callback-correlation'

});


const CORRELATION_STATUS = Object.freeze({

    MATCHED: 'MATCHED',

    PARTIAL: 'PARTIAL',

    UNMATCHED: 'UNMATCHED',

    DUPLICATE: 'DUPLICATE',

    FAILED: 'FAILED'

});


const MATCH_TYPE = Object.freeze({

    PROVIDER_REFERENCE: 'PROVIDER_REFERENCE',

    TRANSACTION_REFERENCE: 'TRANSACTION_REFERENCE',

    EXTERNAL_REFERENCE: 'EXTERNAL_REFERENCE',

    PHONE_AMOUNT_MATCH: 'PHONE_AMOUNT_MATCH',

    NONE: 'NONE'

});


const DEFAULTS = Object.freeze({

    confidenceThreshold: 80,

    cacheTTL: 86400,

    maxCorrelationAgeMinutes: 1440

});


/**
 * =============================================================================
 * Callback Correlation Service
 * =============================================================================
 */

class CallbackCorrelation {


    constructor({

        paymentRepository,

        callbackRepository,

        idempotencyManager,

        cache,

        auditService,

        eventBus,

        metrics,

        tracer,

        logger,

        configuration

    } = {}) {


        this.paymentRepository =
            paymentRepository;


        this.callbackRepository =
            callbackRepository;


        this.idempotencyManager =
            idempotencyManager;


        this.cache =
            cache;


        this.auditService =
            auditService;


        this.eventBus =
            eventBus;


        this.metrics =
            metrics;


        this.tracer =
            tracer;


        this.logger =
            logger;


        this.configuration =
            configuration;



        this.runtime = {


            startedAt:
                new Date(),


            activeCorrelations:
                new Map(),


            cache:
                new Map()


        };



        this.statistics = {


            totalCallbacks:
                0,


            matched:
                0,


            unmatched:
                0,


            duplicates:
                0,


            failed:
                0,


            providerMatches:
                0,


            externalMatches:
                0


        };


    }


    /**
     * =========================================================================
     * Correlate Callback
     * =========================================================================
     */


    async correlate({

        tenantId,

        callback,

        correlationId = crypto.randomUUID()

    }) {


        const span =
            this.tracer?.startSpan?.(
                'airtel.callback.correlation'
            );


        try {


            this.statistics.totalCallbacks++;



            this.validateCallback(callback);



            const duplicate =
                await this.detectDuplicate({

                    tenantId,

                    callback

                });



            if (duplicate) {


                this.statistics.duplicates++;


                return this.buildResult({

                    status:
                        CORRELATION_STATUS.DUPLICATE,

                    correlationId,

                    callback

                });


            }



            const matches =
                await this.findMatches({

                    tenantId,

                    callback

                });



            const result =
                this.evaluateMatches(matches);



            await this.persistCorrelation({

                tenantId,

                callback,

                result,

                correlationId

            });



            await this.publishCorrelationEvent({

                tenantId,

                callback,

                result,

                correlationId

            });



            return result;


        }


        catch(error) {


            this.statistics.failed++;


            this.logger?.error?.({

                message:
                    'Airtel callback correlation failed',

                correlationId,

                error:
                    error.message

            });


            throw normalizeError(error);


        }


        finally {


            span?.end?.();


        }


    }



    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */


    validateCallback(callback = {}) {


        if (!callback) {


            throw new ValidationError(

                'Callback payload required'

            );


        }


        if (

            !callback.transactionId &&

            !callback.reference &&

            !callback.externalReference

        ) {


            throw new ValidationError(

                'Callback has no correlation identifiers'

            );


        }


        return true;


    }



    /**
     * =========================================================================
     * Matching Engine
     * =========================================================================
     */


    async findMatches({

        tenantId,

        callback

    }) {


        const matches = [];



        if (

            callback.transactionId

        ) {


            const payment =

                await this.paymentRepository?.findByProviderReference?.({

                    tenantId,

                    provider:

                        PROVIDER.NAME,

                    reference:

                        callback.transactionId

                });



            if (payment) {


                matches.push({

                    type:
                        MATCH_TYPE.PROVIDER_REFERENCE,

                    payment,

                    confidence:
                        100

                });


            }


        }




        if (

            callback.externalReference

        ) {


            const payment =

                await this.paymentRepository?.findByExternalReference?.({

                    tenantId,

                    externalReference:

                        callback.externalReference

                });



            if(payment) {


                matches.push({

                    type:

                        MATCH_TYPE.EXTERNAL_REFERENCE,

                    payment,

                    confidence:

                        90

                });


            }


        }



        return matches;


    }



    /**
     * =========================================================================
     * Match Evaluation
     * =========================================================================
     */


    evaluateMatches(matches = []) {


        if (!matches.length) {


            this.statistics.unmatched++;


            return {


                status:

                    CORRELATION_STATUS.UNMATCHED,


                matchType:

                    MATCH_TYPE.NONE,


                confidence:

                    0

            };


        }



        const best =

            matches.sort(

                (a,b) =>

                    b.confidence -

                    a.confidence

            )[0];



        if (

            best.type ===

            MATCH_TYPE.PROVIDER_REFERENCE

        ) {


            this.statistics.providerMatches++;


        }


        if (

            best.type ===

            MATCH_TYPE.EXTERNAL_REFERENCE

        ) {


            this.statistics.externalMatches++;


        }



        this.statistics.matched++;



        return {


            status:

                best.confidence >=

                DEFAULTS.confidenceThreshold

                    ? CORRELATION_STATUS.MATCHED

                    : CORRELATION_STATUS.PARTIAL,


            matchType:

                best.type,


            confidence:

                best.confidence,


            payment:

                best.payment


        };


    }



    /**
     * =========================================================================
     * Duplicate Detection
     * =========================================================================
     */


    async detectDuplicate({

        tenantId,

        callback

    }) {


        const key =

            `airtel:callback:${tenantId}:${

                callback.transactionId ||

                callback.reference

            }`;



        if (this.cache) {


            const exists =

                await this.cache.get(key);



            if (exists) {


                return true;


            }


        }



        return false;


    }



    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */


    async persistCorrelation({

        tenantId,

        callback,

        result,

        correlationId

    }) {


        await this.callbackRepository?.create?.({

            tenantId,

            provider:

                PROVIDER.NAME,

            callback,

            correlation:

                result,

            correlationId

        });


        await this.auditService?.record?.({

            action:

                'AIRTEL_CALLBACK_CORRELATED',

            tenantId,

            correlationId,

            metadata:

                result

        });


    }



    /**
     * =========================================================================
     * Event Publishing
     * =========================================================================
     */


    async publishCorrelationEvent({

        tenantId,

        callback,

        result,

        correlationId

    }) {


        await this.eventBus?.publish?.({

            type:

                'AIRTEL_CALLBACK_CORRELATED',

            tenantId,

            correlationId,

            payload: {


                callback,

                result


            }


        });


    }



    /**
     * =========================================================================
     * Result Builder
     * =========================================================================
     */


    buildResult({

        status,

        correlationId,

        callback

    }) {


        return {


            provider:

                PROVIDER.NAME,


            status,


            correlationId,


            callbackId:

                callback.id || null,


            timestamp:

                new Date()


        };


    }



    /**
     * =========================================================================
     * Health
     * =========================================================================
     */


    health() {


        return {


            provider:

                PROVIDER.NAME,


            status:

                'UP',


            statistics:

                this.statistics,


            active:

                this.runtime.activeCorrelations.size,


            uptimeMs:

                Date.now() -

                this.runtime.startedAt.getTime()


        };


    }



    /**
     * =========================================================================
     * Snapshot
     * =========================================================================
     */


    snapshot() {


        return {


            provider:

                PROVIDER.NAME,


            module:

                PROVIDER.MODULE,


            statistics:

                this.statistics,


            startedAt:

                this.runtime.startedAt


        };


    }


}



module.exports = CallbackCorrelation;