'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Shared Payment Dead Letter Queue (DLQ)
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Provides a centralized failure recovery queue for payment operations that
 * cannot be completed successfully after normal processing attempts.
 *
 * Supported Scenarios
 * -----------------------------------------------------------------------------
 * • MTN callback failures
 * • Airtel callback failures
 * • Provider timeout recovery
 * • Settlement mismatches
 * • Ledger posting failures
 * • Webhook processing failures
 * • Retry exhaustion
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Store failed payment messages
 * • Preserve original payload context
 * • Track retry lifecycle
 * • Support manual investigation
 * • Support automated replay workflows
 * • Maintain audit evidence
 * • Publish operational events
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Retry messages directly
 * ✗ Modify payment states
 * ✗ Post ledger entries
 * ✗ Resolve business failures
 *
 * =============================================================================
 */



class DeadLetterQueue {



    constructor({

        repository,

        retryManager,

        auditService,

        eventBus,

        metrics,

        logger,

        configuration = {}

    } = {}) {



        if (!repository) {


            throw new Error(

                'DeadLetterQueue requires repository.'

            );


        }



        this.repository = repository;

        this.retryManager = retryManager;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;

        this.configuration = configuration;


    }








    /**
     * =========================================================================
     * Store Failed Message
     * =========================================================================
     */


    async store({

        provider,

        operation,

        payload,

        error,

        metadata = {},

        correlationId,

        tenantId,

        transactionId

    } = {}) {



        this.#validate({

            provider,

            operation,

            payload,

            error

        });






        const record =

            await this.repository.create({



                provider,


                operation,


                tenantId,


                transactionId,


                correlationId,



                payload,



                error: {


                    message:

                        error?.message ||

                        String(error),



                    code:

                        error?.code || null,



                    stack:

                        error?.stack || null



                },



                status:

                    'PENDING_REVIEW',



                retryCount:

                    0,



                createdAt:

                    new Date()



            });








        this.metrics?.increment?.(

            'payment.dlq.messages.stored'

        );








        await this.auditService?.record({

            action:

                'PAYMENT_DLQ_MESSAGE_CREATED',



            provider,


            operation,


            tenantId,


            transactionId,


            correlationId



        });








        await this.eventBus?.publish?.({

            type:

                'PAYMENT_DLQ_MESSAGE_CREATED',



            payload:

                record


        });








        this.logger.error?.({

            event:

                'payment.dead_letter.created',



            provider,


            operation,


            transactionId,


            correlationId,


            error:

                error?.message


        });








        return record;


    }








    /**
     * =========================================================================
     * Retrieve Failed Message
     * =========================================================================
     */


    async get(id) {



        return this.repository.findById(

            id

        );


    }








    /**
     * =========================================================================
     * List Failed Messages
     * =========================================================================
     */


    async list({

        provider,

        operation,

        status = 'PENDING_REVIEW',

        limit = 100

    } = {}) {



        return this.repository.find({

            provider,

            operation,

            status,

            limit

        });


    }








    /**
     * =========================================================================
     * Mark Message Resolved
     * =========================================================================
     */


    async resolve({

        id,

        resolvedBy,

        notes

    } = {}) {



        const result =

            await this.repository.update({

                id,

                status:

                    'RESOLVED',


                resolvedBy,

                notes,

                resolvedAt:

                    new Date()


            });








        await this.auditService?.record({

            action:

                'PAYMENT_DLQ_RESOLVED',



            id,


            resolvedBy


        });








        return result;


    }








    /**
     * =========================================================================
     * Replay Message
     * =========================================================================
     *
     * Delegates actual retry execution to retry orchestration layer.
     */


    async replay(id) {



        const message =

            await this.repository.findById(

                id

            );






        if (!message) {



            throw new Error(

                'Dead letter message not found.'

            );


        }







        if (!this.retryManager) {



            throw new Error(

                'Retry manager unavailable.'

            );


        }







        const result =

            await this.retryManager.execute(

                message

            );








        await this.repository.update({

            id,

            status:

                'REPLAYING',


            replayStartedAt:

                new Date()


        });








        return result;


    }








    /**
     * =========================================================================
     * Fail Replay Attempt
     * =========================================================================
     */


    async markReplayFailed({

        id,

        error

    }) {



        return this.repository.update({

            id,

            status:

                'RETRY_FAILED',


            lastRetryError:

                error?.message || String(error),


            retryFailedAt:

                new Date()


        });


    }








    /**
     * =========================================================================
     * Health Check
     * =========================================================================
     */


    async health() {



        return {


            module:

                'PAYMENT_DEAD_LETTER_QUEUE',



            status:

                'UP',



            timestamp:

                new Date()


        };


    }








    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */


    #validate({

        provider,

        operation,

        payload,

        error

    }) {



        if (!provider) {


            throw new Error(

                'Provider required.'

            );


        }





        if (!operation) {


            throw new Error(

                'Operation required.'

            );


        }





        if (!payload) {


            throw new Error(

                'Payload required.'

            );


        }





        if (!error) {


            throw new Error(

                'Error information required.'

            );


        }


    }


}





module.exports = DeadLetterQueue;