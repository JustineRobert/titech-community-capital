"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Context Diagnostics & Lifecycle Manager
 * =============================================================================
 *
 * Operational management layer for RetryContext lifecycle.
 *
 * Responsibilities:
 *
 * ✓ Context registration
 * ✓ Execution activation
 * ✓ Context lifecycle tracking
 * ✓ Context snapshots
 * ✓ Context restoration
 * ✓ Runtime inspection
 * ✓ Health reporting
 * ✓ Kubernetes readiness support
 * ✓ Incident diagnostics
 * ✓ Graceful shutdown handling
 *
 * =============================================================================
 */


const crypto = require("crypto");


const {
    RetryContext,
    isRetryContext
} = require("./retryContext");



const {
    retryContextStorage
} = require("./retryContextStorage");



/* =============================================================================
 * Retry Context Manager Error
 * =============================================================================
 */


class RetryContextManagerError extends Error {


    constructor(
        message,
        options = {}
    ) {

        super(message);


        this.name =
            "RetryContextManagerError";


        this.code =
            "RETRY_CONTEXT_MANAGER_ERROR";


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
 * Retry Context Manager
 * =============================================================================
 */


class RetryContextManager {


    constructor(options = {}) {


        this.name =
            options.name ||
            "retry-context-manager";



        this.maxContexts =
            options.maxContexts ||
            10000;



        this.shutdownState =
            false;



        this.contexts =
            new Map();



        this.history =
            [];



        this.createdAt =
            new Date();


    }




    /* =========================================================================
     * register()
     *
     * Registers retry execution context.
     * =========================================================================
     */


    register(
        context
    ) {


        this.assertAvailable();


        this.validateContext(
            context
        );



        if (
            this.contexts.size >= this.maxContexts
        ) {

            throw new RetryContextManagerError(
                "Maximum retry contexts reached"
            );

        }



        this.contexts.set(

            context.executionId,

            {

                context,

                registeredAt:
                    new Date(),

                state:
                    "REGISTERED"

            }

        );



        this.history.push({

            event:
                "registered",

            executionId:
                context.executionId,

            timestamp:
                new Date()

        });



        return context;

    }





    /* =========================================================================
     * activate()
     *
     * Marks context active.
     * =========================================================================
     */


    activate(
        context
    ) {


        this.validateContext(
            context
        );


        const entry =
            this.contexts.get(
                context.executionId
            );



        if (
            !entry
        ) {

            this.register(
                context
            );

        }



        this.contexts.set(

            context.executionId,

            {

                context,

                activatedAt:
                    new Date(),

                state:
                    "ACTIVE"

            }

        );



        return retryContextStorage.run(

            context,

            async () => context

        );

    }





    /* =========================================================================
     * deactivate()
     * =========================================================================
     */


    deactivate(
        executionId
    ) {


        const entry =
            this.contexts.get(
                executionId
            );



        if (
            !entry
        ) {

            return false;

        }



        this.contexts.set(

            executionId,

            {

                ...entry,

                state:
                    "COMPLETED",

                completedAt:
                    new Date()

            }

        );



        return true;

    }





    /* =========================================================================
     * snapshot()
     *
     * Creates safe diagnostic snapshot.
     * =========================================================================
     */


    snapshot(
        executionId
    ) {


        const entry =
            this.contexts.get(
                executionId
            );



        if (
            !entry
        ) {

            return null;

        }



        return {

            executionId,

            state:
                entry.state,


            context:
                entry.context.toJSON(),


            capturedAt:
                new Date()

        };

    }





    /* =========================================================================
     * restore()
     *
     * Restores context from snapshot.
     * =========================================================================
     */


    restore(
        snapshot
    ) {


        if (
            !snapshot?.context
        ) {

            throw new RetryContextManagerError(
                "Invalid context snapshot"
            );

        }



        return new RetryContext(

            snapshot.context

        );

    }





    /* =========================================================================
     * inspect()
     *
     * Runtime context inspection.
     * =========================================================================
     */


    inspect(
        executionId
    ) {


        const entry =
            this.contexts.get(
                executionId
            );



        if (
            !entry
        ) {

            return null;

        }



        return {

            executionId,

            state:
                entry.state,


            retryId:
                entry.context.retryId,


            tenantId:
                entry.context.tenantId,


            policy:
                entry.context.policyName,


            attempt:
                entry.context.attempt,


            startedAt:
                entry.context.startedAt

        };

    }





    /* =========================================================================
     * diagnostics()
     * =========================================================================
     */


    diagnostics() {


        return {


            name:
                this.name,


            uptime:

                Date.now()
                -
                this.createdAt.getTime(),



            totalContexts:
                this.contexts.size,



            activeContexts:

                Array.from(
                    this.contexts.values()
                )
                .filter(
                    item =>
                        item.state === "ACTIVE"
                )
                .length,



            shutdown:
                this.shutdownState,


            historySize:
                this.history.length


        };

    }





    /* =========================================================================
     * health()
     *
     * Kubernetes readiness/liveness helper.
     * =========================================================================
     */


    health() {


        return {


            status:

                this.shutdownState
                    ?
                    "NOT_READY"
                    :
                    "READY",



            component:
                this.name,



            contexts:

                this.contexts.size,


            timestamp:
                new Date()

        };

    }





    /* =========================================================================
     * shutdown()
     *
     * Graceful shutdown.
     * =========================================================================
     */


    shutdown() {


        this.shutdownState =
            true;



        for (
            const entry
            of
            this.contexts.values()
        ) {

            entry.state =
                "SHUTDOWN";

        }



        retryContextStorage.shutdownStorage();


        return true;

    }





    /* =========================================================================
     * cleanup()
     *
     * Removes completed contexts.
     * =========================================================================
     */


    cleanup() {


        for (
            const [
                id,
                entry
            ]
            of
            this.contexts.entries()
        ) {


            if (
                entry.state !== "ACTIVE"
            ) {

                this.contexts.delete(
                    id
                );

            }

        }


        return this.contexts.size;

    }





    /* =========================================================================
     * Internal Validation
     * =========================================================================
     */


    validateContext(
        context
    ) {


        if (
            !isRetryContext(context)
        ) {

            throw new RetryContextManagerError(
                "Invalid RetryContext"
            );

        }

    }



    assertAvailable() {


        if (
            this.shutdownState
        ) {

            throw new RetryContextManagerError(
                "Retry Context Manager is shutdown"
            );

        }

    }


}



/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryContextManager =
    new RetryContextManager();




/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryContextManager(
    options = {}
) {

    return new RetryContextManager(
        options
    );

}



/* =============================================================================
 * Exports
 * =============================================================================
 */


module.exports = {


    RetryContextManager,

    RetryContextManagerError,

    retryContextManager,

    createRetryContextManager

};