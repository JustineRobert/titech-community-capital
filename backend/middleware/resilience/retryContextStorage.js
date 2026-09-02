"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Context AsyncLocalStorage Provider
 * =============================================================================
 *
 * Provides async-safe propagation of RetryContext across:
 *
 * ✓ HTTP requests
 * ✓ Background jobs
 * ✓ Queue workers
 * ✓ Database operations
 * ✓ External API calls
 * ✓ Payment workflows
 * ✓ Distributed tracing
 *
 * Features:
 *
 * ✓ AsyncLocalStorage integration
 * ✓ Context execution boundaries
 * ✓ Context retrieval
 * ✓ Context validation
 * ✓ Context binding
 * ✓ Context cleanup
 * ✓ Tenant propagation
 * ✓ Request propagation
 * ✓ Trace propagation
 * ✓ Graceful shutdown handling
 *
 * =============================================================================
 */


const {
    AsyncLocalStorage
} = require("async_hooks");


const {
    RetryContext,
    isRetryContext
} = require("./retryContext");


/* =============================================================================
 * Retry Context Storage Error
 * =============================================================================
 */

class RetryContextStorageError extends Error {


    constructor(
        message,
        options = {}
    ) {

        super(message);


        this.name =
            "RetryContextStorageError";


        this.code =
            "RETRY_CONTEXT_STORAGE_ERROR";


        this.cause =
            options.cause ||
            null;


        Error.captureStackTrace(
            this,
            this.constructor
        );

    }

}


/* =============================================================================
 * AsyncLocalStorage Instance
 * =============================================================================
 */


class RetryContextStorage {


    constructor(options = {}) {


        this.storage =
            new AsyncLocalStorage();



        this.name =
            options.name ||
            "retry-context";



        this.enabled =
            options.enabled !== false;



        this.shutdown =
            false;



        this.activeContexts =
            new Set();

    }



    /* =========================================================================
     * Run Context
     * =========================================================================
     *
     * Creates an async execution boundary.
     *
     * Every async operation inside callback
     * inherits the RetryContext.
     *
     * =========================================================================
     */


    run(
        context,
        callback
    ) {


        if (
            this.shutdown
        ) {

            throw new RetryContextStorageError(
                "Retry context storage is shutdown"
            );

        }



        if (
            !isRetryContext(context)
        ) {

            throw new RetryContextStorageError(
                "Invalid RetryContext supplied"
            );

        }



        if (
            typeof callback !== "function"
        ) {

            throw new RetryContextStorageError(
                "Callback must be a function"
            );

        }



        this.activeContexts.add(
            context.executionId
        );



        return this.storage.run(

            context,

            async () => {


                try {

                    return await callback();

                }

                finally {


                    this.activeContexts.delete(
                        context.executionId
                    );


                }

            }

        );

    }



    /* =========================================================================
     * Current Context
     * =========================================================================
     */


    getCurrent() {


        if (
            !this.enabled
        ) {

            return null;

        }



        return (

            this.storage.getStore()

            ||

            null

        );

    }



    /* =========================================================================
     * Required Context
     * =========================================================================
     *
     * Used by components that require
     * retry execution context.
     *
     * =========================================================================
     */


    requireCurrent() {


        const context =
            this.getCurrent();



        if (
            !context
        ) {

            throw new RetryContextStorageError(
                "RetryContext is not available"
            );

        }



        return context;

    }



    /* =========================================================================
     * Context Binding
     * =========================================================================
     *
     * Binds existing context to
     * callbacks.
     *
     * Useful for:
     *
     * - Event emitters
     * - Queue workers
     * - Timers
     *
     * =========================================================================
     */


    bind(
        callback,
        context = null
    ) {


        if (
            typeof callback !== "function"
        ) {

            throw new RetryContextStorageError(
                "Cannot bind non-function"
            );

        }



        const activeContext =
            context
            ||
            this.getCurrent();



        if (
            !activeContext
        ) {

            throw new RetryContextStorageError(
                "No RetryContext available for binding"
            );

        }



        return (
            (...args) => {


                return this.run(

                    activeContext,

                    () => callback(
                        ...args
                    )

                );


            }
        );

    }



    /* =========================================================================
     * Clear Context
     * =========================================================================
     */


    clear() {


        this.activeContexts.clear();

    }



    /* =========================================================================
     * Shutdown Handling
     * =========================================================================
     *
     * Used during:
     *
     * Kubernetes SIGTERM
     * PM2 shutdown
     * Application termination
     *
     * =========================================================================
     */


    shutdownStorage() {


        this.shutdown =
            true;



        this.clear();

    }



    /* =========================================================================
     * Tenant Propagation
     * =========================================================================
     */


    getTenantId() {


        return (

            this.getCurrent()
            ?.tenantId

            ||

            null

        );

    }



    /* =========================================================================
     * Request Propagation
     * =========================================================================
     */


    getRequestId() {


        return (

            this.getCurrent()
            ?.requestId

            ||

            null

        );

    }



    getCorrelationId() {


        return (

            this.getCurrent()
            ?.correlationId

            ||

            null

        );

    }



    /* =========================================================================
     * Trace Propagation
     * =========================================================================
     */


    getTraceContext() {


        const context =
            this.getCurrent();



        if (
            !context
        ) {

            return null;

        }



        return {

            traceId:
                context.traceId,


            spanId:
                context.spanId


        };

    }



    /* =========================================================================
     * Diagnostics
     * =========================================================================
     */


    diagnostics() {


        return {


            name:
                this.name,


            enabled:
                this.enabled,


            shutdown:
                this.shutdown,


            activeContexts:
                this.activeContexts.size


        };

    }


}


/* =============================================================================
 * Singleton Provider
 * =============================================================================
 */


const retryContextStorage =
    new RetryContextStorage();



/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryContextStorage(
    options = {}
) {

    return new RetryContextStorage(
        options
    );

}


/* =============================================================================
 * Exports
 * =============================================================================
 */


module.exports = {


    RetryContextStorage,

    RetryContextStorageError,

    retryContextStorage,

    createRetryContextStorage

};