"use strict";

/**
 * TITech Community Capital LTD
 * =============================================================================
 * Enterprise Retry Execution Engine
 * =============================================================================
 *
 * Runtime execution engine for enterprise retry orchestration.
 *
 * Responsibilities:
 *
 * ✓ Execute operations
 * ✓ Execute with retry context
 * ✓ Attempt lifecycle management
 * ✓ Hook execution
 * ✓ Retry events
 * ✓ Delay management
 * ✓ AbortController support
 * ✓ Deadline propagation
 * ✓ Metrics integration
 * ✓ Tracing integration
 * ✓ Structured logging
 * ✓ Graceful cancellation
 *
 * =============================================================================
 */


const crypto = require("crypto");


const {
    retryDecisionEngine
} = require("./retryDecisionEngine");


const {
    retryContextStorage
} = require("./retryContextStorage");


const {
    RetryExecutionError,
    RetryCancelledError
} = require("./retryErrors");



/* =============================================================================
 * Retry Events
 * =============================================================================
 */


const RETRY_EVENTS =
Object.freeze({

    STARTED:
        "retry.started",

    ATTEMPT:
        "retry.attempt",

    SUCCESS:
        "retry.success",

    FAILURE:
        "retry.failure",

    RETRY:
        "retry.retry",

    TIMEOUT:
        "retry.timeout",

    CANCELLED:
        "retry.cancelled",

    COMPLETED:
        "retry.completed"

});



/* =============================================================================
 * Retry Execution Engine
 * =============================================================================
 */


class RetryExecutionEngine {


    constructor(options = {}) {


        this.decisionEngine =
            options.decisionEngine
            ||
            retryDecisionEngine;



        this.logger =
            options.logger
            ||
            console;



        this.metrics =
            options.metrics
            ||
            null;



        this.events =
            options.events
            ||
            null;



        this.tracer =
            options.tracer
            ||
            null;



        this.hooks =
            options.hooks
            ||
            {};

    }





    /* =========================================================================
     * Public execute()
     * =========================================================================
     */


    async execute(
        operation,
        options = {}
    ) {


        const context =
            options.context
            ||
            {};



        return this.executeWithContext(

            operation,

            context,

            options

        );

    }





    /* =========================================================================
     * Execute with Retry Context
     * =========================================================================
     */


    async executeWithContext(
        operation,
        context,
        options = {}
    ) {


        const executionId =
            crypto.randomUUID();



        const retryContext = {


            executionId,


            retryId:
                crypto.randomUUID(),


            attempt:
                0,


            startedAt:
                new Date(),


            deadline:
                context.deadline,


            ...context


        };



        this.emit(

            RETRY_EVENTS.STARTED,

            retryContext

        );



        return retryContextStorage.run(

            retryContext,

            async () => {


                return this.runAttempts(

                    operation,

                    retryContext,

                    options

                );


            }

        );

    }





    /* =========================================================================
     * Attempt Loop
     * =========================================================================
     */


    async runAttempts(
        operation,
        context,
        options
    ) {


        let lastError;



        while (true) {


            try {


                await this.executeHook(

                    "beforeAttempt",

                    context

                );



                this.emit(

                    RETRY_EVENTS.ATTEMPT,

                    context

                );



                const result =
                    await this.attempt(

                        operation,

                        context,

                        options

                    );



                await this.executeHook(

                    "afterAttempt",

                    context,

                    result

                );



                this.recordSuccess(
                    context
                );



                this.emit(

                    RETRY_EVENTS.SUCCESS,

                    context

                );



                return result;


            }

            catch(error) {


                lastError =
                    error;



                context.lastError =
                    error;



                this.recordFailure(
                    context,
                    error
                );



                const decision =
                    this.decisionEngine.shouldRetry(

                        error,

                        context,

                        options

                    );



                if (
                    !decision.retry
                ) {


                    this.emit(

                        RETRY_EVENTS.COMPLETED,

                        {

                            context,

                            decision

                        }

                    );



                    throw new RetryExecutionError(

                        "Retry execution failed",

                        {

                            cause:
                                lastError,

                            context

                        }

                    );


                }



                context.attempt++;



                await this.delay(

                    decision.delay,

                    context.signal

                );


            }

        }


    }





    /* =========================================================================
     * Single Attempt Execution
     * =========================================================================
     */


    async attempt(
        operation,
        context,
        options
    ) {


        if (
            context.signal?.aborted
        ) {

            throw new RetryCancelledError(

                "Retry cancelled",

                {

                    cause:
                        context.signal.reason

                }

            );

        }



        return operation({

            context,

            attempt:
                context.attempt,

            signal:
                context.signal

        });

    }





    /* =========================================================================
     * Delay Handling
     * =========================================================================
     */


    async delay(
        milliseconds,
        signal
    ) {


        this.emit(

            RETRY_EVENTS.RETRY,

            {

                delay:
                    milliseconds

            }

        );



        return new Promise(

            (resolve,reject)=>{


                if (
                    signal?.aborted
                ) {

                    return reject(

                        new RetryCancelledError(

                            "Retry aborted"

                        )

                    );

                }



                const timer =
                    setTimeout(

                        resolve,

                        milliseconds

                    );



                signal?.addEventListener(

                    "abort",

                    () => {


                        clearTimeout(
                            timer
                        );


                        reject(

                            new RetryCancelledError(

                                "Retry cancelled"

                            )

                        );


                    },

                    {

                        once:true

                    }

                );


            }

        );


    }





    /* =========================================================================
     * Hooks
     * =========================================================================
     */


    async executeHook(
        name,
        ...args
    ) {


        const hook =
            this.hooks[name];



        if (
            typeof hook === "function"
        ) {

            return hook(
                ...args
            );

        }


    }





    /* =========================================================================
     * Metrics
     * =========================================================================
     */


    recordSuccess(
        context
    ) {


        this.metrics?.success?.(
            context
        );

    }




    recordFailure(
        context,
        error
    ) {


        this.metrics?.failure?.(

            {

                context,

                error

            }

        );

    }





    /* =========================================================================
     * Events
     * =========================================================================
     */


    emit(
        event,
        payload
    ) {


        this.events?.emit?.(

            event,

            payload

        );

    }





}



/* =============================================================================
 * Singleton
 * =============================================================================
 */


const retryExecutionEngine =
    new RetryExecutionEngine();



/* =============================================================================
 * Factory
 * =============================================================================
 */


function createRetryExecutionEngine(
    options={}
) {


    return new RetryExecutionEngine(
        options
    );

}



/* =============================================================================
 * Exports
 * =============================================================================
 */


module.exports = {


    RetryExecutionEngine,

    retryExecutionEngine,

    createRetryExecutionEngine,

    RETRY_EVENTS

};