'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Compensation Manager
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Handles failed MTN MoMo disbursement recovery workflows.
 *
 * Compensation is triggered when a payout cannot complete normally due to:
 *
 * • MTN transfer failure
 * • Provider rejection
 * • Network timeout
 * • Callback mismatch
 * • Settlement discrepancy
 * • Ledger posting failure
 * • Unknown provider state
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Execute compensation workflows
 * • Transition failed transactions safely
 * • Coordinate financial recovery actions
 * • Prevent duplicate compensation
 * • Record audit evidence
 * • Publish recovery events
 * • Support manual investigation workflows
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Delete transactions
 * ✗ Modify balances directly
 * ✗ Reverse ledger entries manually
 * ✗ Ignore financial state transitions
 *
 * =============================================================================
 */


class CompensationManager {


    constructor({

        stateMachine,

        ledgerBridge,

        auditService,

        repository,

        eventBus,

        metrics,

        logger

    } = {}) {



        if (!stateMachine) {

            throw new Error(

                'CompensationManager requires stateMachine.'

            );

        }



        this.stateMachine = stateMachine;

        this.ledgerBridge = ledgerBridge;

        this.auditService = auditService;

        this.repository = repository;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;


    }






    /**
     * =========================================================================
     * Execute Compensation Workflow
     * =========================================================================
     */


    async execute({

        tenantId,

        reference,

        reason,

        transactionId,

        metadata = {}

    } = {}) {



        this.#validate({

            tenantId,

            reference,

            reason

        });




        try {



            /**
             * -----------------------------------------------------------------
             * 1. Check existing compensation state
             * -----------------------------------------------------------------
             */


            const existing =

                await this.repository?.findCompensation?.({

                    tenantId,

                    reference

                });






            if (existing?.status === 'COMPLETED') {



                return {


                    compensated: true,


                    duplicate: true,


                    reference



                };


            }








            /**
             * -----------------------------------------------------------------
             * 2. Transition transaction lifecycle
             * -----------------------------------------------------------------
             */


            const failedTransaction =

                await this.stateMachine.transition({

                    id:

                        transactionId || reference,


                    nextStatus:

                        'FAILED'


                });








            /**
             * -----------------------------------------------------------------
             * 3. Financial compensation handling
             * -----------------------------------------------------------------
             *
             * Ledger reversals must always flow through Ledger Engine.
             */


            let ledgerResult = null;




            if (this.ledgerBridge?.compensate) {



                ledgerResult =

                    await this.ledgerBridge.compensate({

                        tenantId,

                        transaction:

                            failedTransaction,

                        reason


                    });


            }








            /**
             * -----------------------------------------------------------------
             * 4. Persist compensation record
             * -----------------------------------------------------------------
             */


            const compensation =

                await this.repository?.createCompensation?.({

                    tenantId,

                    reference,

                    transactionId,

                    status:

                        'COMPLETED',


                    reason,

                    metadata,

                    ledgerResult,

                    createdAt:

                        new Date()


                });








            /**
             * -----------------------------------------------------------------
             * 5. Audit trail
             * -----------------------------------------------------------------
             */


            await this.auditService?.record({

                action:

                    'DISBURSEMENT_COMPENSATED',


                tenantId,

                reference,

                transactionId,

                reason,


                ledgerResult,


                timestamp:

                    new Date()


            });








            /**
             * -----------------------------------------------------------------
             * 6. Publish recovery event
             * -----------------------------------------------------------------
             */


            await this.eventBus?.publish?.({

                type:

                    'MTN_DISBURSEMENT_COMPENSATED',


                payload: {


                    tenantId,

                    reference,

                    transactionId,

                    reason,


                    status:

                        'COMPLETED'


                }


            });








            this.metrics?.increment?.(

                'mtn.disbursement.compensation.success'

            );








            this.logger.info?.({

                event:

                    'mtn.disbursement.compensation.completed',



                tenantId,


                reference,


                reason



            });








            return {


                compensated: true,


                reference,


                compensationId:

                    compensation?.id || null



            };




        }


        catch(error) {



            this.metrics?.increment?.(

                'mtn.disbursement.compensation.failed'

            );





            this.logger.error?.({

                event:

                    'mtn.disbursement.compensation.failed',



                tenantId,


                reference,


                error



            });





            await this.auditService?.record({

                action:

                    'DISBURSEMENT_COMPENSATION_FAILED',



                tenantId,


                reference,


                reason,


                error:

                    error.message,


                timestamp:

                    new Date()



            });





            throw error;


        }


    }








    /**
     * =========================================================================
     * Retry Compensation
     * =========================================================================
     */


    async retry({

        tenantId,

        reference,

        reason

    } = {}) {



        return this.execute({

            tenantId,

            reference,

            reason:

                reason ||

                'COMPENSATION_RETRY'


        });


    }








    /**
     * =========================================================================
     * Compensation Health
     * =========================================================================
     */


    async health() {


        return {


            module:

                'MTN_DISBURSEMENT_COMPENSATION',



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

        tenantId,

        reference,

        reason

    }) {



        if (!tenantId) {


            throw new Error(

                'tenantId is required'

            );


        }






        if (!reference) {


            throw new Error(

                'Disbursement reference is required'

            );


        }






        if (!reason) {


            throw new Error(

                'Compensation reason is required'

            );


        }


    }


}





module.exports = CompensationManager;