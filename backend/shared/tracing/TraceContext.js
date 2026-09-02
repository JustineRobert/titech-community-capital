'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * =============================================================================
 *
 * File:
 * backend/shared/tracing/TraceContext.js
 *
 * Enterprise Distributed Trace Context Manager
 *
 * Responsibilities:
 *
 * - Maintain request execution context
 * - Bridge HTTP tracing and background jobs
 * - Connect request identifiers with tracing identifiers
 * - Provide AsyncLocalStorage propagation
 * - Enrich logs, metrics and audits
 *
 *
 * Context:
 *
 * {
 *    requestId,
 *    correlationId,
 *    traceId,
 *    spanId,
 *    tenant,
 *    user,
 *    service
 * }
 *
 *
 * =============================================================================
 */


const {
    AsyncLocalStorage
}
=
require('async_hooks');



const crypto =
    require('crypto');





const DEFAULT_SERVICE =
    'titech-community-capital';





/**
 * Global async context storage.
 *
 * One instance per process.
 */
const asyncStorage =
    new AsyncLocalStorage();





class TraceContext {


    constructor({

        service =
            DEFAULT_SERVICE,


        tracer = null


    } = {}) {


        this.service =
            service;



        this.tracer =
            tracer;



        Object.freeze(this);

    }








    /**
     * Initialize execution context.
     *
     * Usually called by middleware.
     */
    run(context, callback) {


        const traceContext =
            this.createContext(
                context
            );



        return asyncStorage.run(

            traceContext,

            callback

        );

    }








    /**
     * Build immutable trace context.
     */
    createContext(context = {}) {


        return Object.freeze({

            requestId:

                context.requestId ||
                generateId(),



            correlationId:

                context.correlationId ||
                generateId(),



            traceId:

                context.traceId ||
                generateId(),



            spanId:

                context.spanId ||
                generateId(),



            tenant:

                context.tenant ||
                null,



            user:

                context.user ||
                null,



            service:

                context.service ||
                this.service,



            startedAt:

                new Date()


        });


    }









    /**
     * Retrieve current context.
     */
    static current() {


        return (
            asyncStorage.getStore()
            ||
            null
        );


    }









    /**
     * Add trace context to logger metadata.
     */
    enrichLogger(metadata = {}) {


        const context =
            TraceContext.current();



        if (!context) {


            return metadata;


        }



        return {


            ...metadata,


            requestId:

                context.requestId,



            correlationId:

                context.correlationId,



            traceId:

                context.traceId,



            spanId:

                context.spanId,



            tenant:

                context.tenant,



            user:

                context.user


        };


    }









    /**
     * Enrich metrics.
     */
    enrichMetrics(metric = {}) {


        return this.enrichLogger(
            metric
        );


    }









    /**
     * Enrich audit events.
     */
    enrichAudit(event = {}) {


        return this.enrichLogger(
            event
        );


    }









    /**
     * Create child trace.
     *
     * Useful for:
     *
     * - Services
     * - Database calls
     * - External APIs
     */
    createChildSpan(name, metadata = {}) {


        const parent =
            TraceContext.current();



        const span = {


            name,


            traceId:

                parent?.traceId ||
                generateId(),



            spanId:

                generateId(),



            parentSpanId:

                parent?.spanId ||
                null,



            attributes:


            {


                service:
                    this.service,


                ...metadata


            }



        };



        return {


            ...span,


            end(){

                return {

                    completed:true,

                    span

                };

            }


        };


    }









    /**
     * Execute background task
     * with inherited tracing.
     */
    bind(callback) {


        const context =
            TraceContext.current();



        return (
            ...args
        ) => {


            return asyncStorage.run(

                context,

                () => callback(
                    ...args
                )

            );


        };


    }









    /**
     * Export current context.
     *
     * Useful for:
     *
     * - Queue messages
     * - Events
     * - External service calls
     */
    export() {


        return TraceContext.current();


    }









    /**
     * Restore context from external source.
     *
     * Example:
     *
     * BullMQ worker
     */
    static restore(context, callback) {


        return asyncStorage.run(

            Object.freeze(
                context
            ),

            callback

        );


    }


}







/**
 * Generate identifiers.
 */
function generateId() {


    return crypto.randomUUID();


}






module.exports =
    TraceContext;



module.exports.asyncStorage =
    asyncStorage;