'use strict';

/**
 * ==========================================================
 * TITech Community Capital LTD
 * Enterprise Payment Retry Manager
 * ----------------------------------------------------------
 * Purpose
 * -------
 * Production-grade retry orchestration engine for payment
 * workflows.
 *
 * Responsibilities
 * ----------------
 * • Transient failure recovery
 * • Exponential backoff
 * • Retry attempt tracking
 * • Retry classification
 * • Provider failure handling
 * • Timeout-aware retries
 * • Metrics instrumentation
 * • Structured logging
 * • Tracing hooks
 * • Retry exhaustion handling
 *
 * Supported Workflows
 * -------------------
 * • MTN Collections
 * • MTN Disbursements
 * • Airtel Money
 * • Bank payments
 * • Settlement jobs
 * • Callback processing
 *
 *
 * Explicitly NOT Responsible For
 * ------------------------------
 * • Provider communication
 * • Circuit breaking
 * • Idempotency
 * • Payment state management
 * • Compensation workflows
 *
 * ==========================================================
 */


const crypto = require('crypto');



class RetryManager {


    constructor({

        maxRetries = 5,

        initialDelayMs = 1000,

        maxDelayMs = 30000,

        backoffMultiplier = 2,

        retryCondition = null,

        logger,

        metrics,

        tracer

    } = {}) {



        this.maxRetries =
            maxRetries;


        this.initialDelayMs =
            initialDelayMs;


        this.maxDelayMs =
            maxDelayMs;


        this.backoffMultiplier =
            backoffMultiplier;


        this.retryCondition =
            retryCondition;


        this.logger =
            logger;


        this.metrics =
            metrics;


        this.tracer =
            tracer;



        this.statistics = {


            attempts: 0,


            retries: 0,


            successes: 0,


            failures: 0


        };


    }







    /**
     * ------------------------------------------------------
     * Execute operation with retry protection
     * ------------------------------------------------------
     */
    async execute(

        operation,

        options = {}

    ) {



        const correlationId =

            options.correlationId ||

            crypto.randomUUID();




        const maxRetries =

            options.maxRetries ??

            this.maxRetries;





        const span =

            this.tracer?.startSpan?.(

                'payment.retry.execute'

            );





        let attempt = 0;

        let lastError;





        try {



            while (

                attempt <= maxRetries

            ) {



                try {



                    this.statistics.attempts++;



                    const result =

                        await operation({

                            attempt:

                                attempt + 1,

                            correlationId

                        });





                    this.statistics.successes++;




                    this.metrics?.counter?.(

                        'payment_retry_success_total'

                    );





                    return result;



                }



                catch(error) {



                    lastError = error;



                    attempt++;




                    this.metrics?.counter?.(

                        'payment_retry_attempt_total'

                    );





                    const shouldRetry =

                        this.shouldRetry(

                            error,

                            attempt

                        );





                    if (

                        !shouldRetry ||

                        attempt > maxRetries

                    ) {



                        this.statistics.failures++;



                        throw error;


                    }





                    this.statistics.retries++;





                    const delay =

                        this.calculateDelay(

                            attempt

                        );





                    this.logger?.warn?.({



                        message:

                            'Payment operation retry scheduled',



                        attempt,



                        delay,



                        correlationId,



                        error:

                            error.message



                    });







                    this.metrics?.counter?.(

                        'payment_retry_scheduled_total'

                    );





                    await this.sleep(

                        delay

                    );



                }


            }





            throw lastError;



        }



        finally {



            span?.end?.();


        }


    }








    /**
     * ------------------------------------------------------
     * Retry decision engine
     * ------------------------------------------------------
     */
    shouldRetry(

        error,

        attempt

    ) {



        if (

            this.retryCondition

        ) {



            return this.retryCondition(

                error,

                attempt

            );

        }





        /**
         * Retry only transient failures
         */
        if (

            error?.retryable === true

        ) {



            return true;


        }





        const transientCodes = [


            'ETIMEDOUT',


            'ECONNRESET',


            'ECONNREFUSED',


            'NETWORK_ERROR'


        ];





        return transientCodes.includes(

            error?.code

        );


    }








    /**
     * ------------------------------------------------------
     * Exponential backoff calculator
     * ------------------------------------------------------
     */
    calculateDelay(attempt) {



        const delay =


            this.initialDelayMs *

            Math.pow(

                this.backoffMultiplier,

                attempt - 1

            );




        return Math.min(

            delay,

            this.maxDelayMs

        );


    }








    /**
     * ------------------------------------------------------
     * Sleep helper
     * ------------------------------------------------------
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
     * ------------------------------------------------------
     * Retry statistics
     * ------------------------------------------------------
     */
    stats() {



        return {


            ...this.statistics,


            configuration: {


                maxRetries:

                    this.maxRetries,


                initialDelayMs:

                    this.initialDelayMs,


                maxDelayMs:

                    this.maxDelayMs


            }


        };


    }








    /**
     * ------------------------------------------------------
     * Health
     * ------------------------------------------------------
     */
    health() {



        return {


            status:

                'UP',


            statistics:

                this.stats()


        };


    }


}



module.exports =
    RetryManager;