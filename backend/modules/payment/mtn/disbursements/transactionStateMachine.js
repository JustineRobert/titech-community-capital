'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * MTN MoMo Disbursement Transaction State Machine
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Controls the lifecycle of MTN MoMo disbursement transactions.
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Enforce valid transaction state transitions
 * • Prevent illegal financial workflow changes
 * • Maintain immutable status history
 * • Support idempotent state transitions
 * • Publish transaction lifecycle events
 * • Record audit trails
 * • Provide operational metrics
 * • Support retry and compensation workflows
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN disbursement requests
 * ✗ Authenticate with MTN
 * ✗ Perform ledger posting
 * ✗ Perform settlement reconciliation
 *
 * =============================================================================
 */


class TransactionStateMachine {


    constructor({

        repository,

        eventBus,

        auditService,

        metrics,

        logger,

        transitions

    } = {}) {


        if (!repository) {

            throw new Error(

                'Disbursement TransactionStateMachine requires repository.'

            );

        }


        this.repository = repository;

        this.eventBus = eventBus;

        this.auditService = auditService;

        this.metrics = metrics;

        this.logger = logger || console;


        /**
         * ---------------------------------------------------------------------
         * MTN Disbursement Lifecycle
         * ---------------------------------------------------------------------
         *
         * CREATED
         *    |
         *    ▼
         * PENDING_APPROVAL
         *    |
         *    ▼
         * APPROVED
         *    |
         *    ▼
         * SUBMITTED
         *    |
         *    ▼
         * PENDING_CALLBACK
         *    |
         *    ▼
         * SUCCESSFUL
         *    |
         *    ▼
         * LEDGER_POSTED
         *    |
         *    ▼
         * SETTLED
         *
         * ---------------------------------------------------------------------
         */


        this.transitions =

            transitions ||

            {


                CREATED: [

                    'PENDING_APPROVAL',

                    'CANCELLED',

                    'FAILED'

                ],



                PENDING_APPROVAL: [

                    'APPROVED',

                    'REJECTED',

                    'FAILED'

                ],



                APPROVED: [

                    'SUBMITTED',

                    'FAILED'

                ],



                SUBMITTED: [

                    'PENDING_CALLBACK',

                    'FAILED',

                    'TIMEOUT'

                ],



                PENDING_CALLBACK: [

                    'SUCCESSFUL',

                    'FAILED',

                    'TIMEOUT'

                ],



                SUCCESSFUL: [

                    'LEDGER_POSTED'

                ],



                LEDGER_POSTED: [

                    'SETTLED'

                ],



                FAILED: [],

                REJECTED: [],

                CANCELLED: [],

                TIMEOUT: [],

                SETTLED: []

            };


    }



    /**
     * =========================================================================
     * Create Disbursement Transaction
     * =========================================================================
     */


    async create(data = {}) {


        const now = new Date();



        const transaction =

            await this.repository.create({

                ...data,

                status:

                    'CREATED',


                createdAt:

                    now,


                updatedAt:

                    now,


                statusHistory: [

                    {

                        status:

                            'CREATED',

                        timestamp:

                            now,

                        actor:

                            'SYSTEM'

                    }

                ]

            });



        this.metrics?.increment?.(

            'mtn.disbursement.created'

        );



        await this.eventBus?.publish?.({

            type:

                'DISBURSEMENT_CREATED',

            payload:

                transaction

        });



        return transaction;


    }





    /**
     * =========================================================================
     * Transition Transaction State
     * =========================================================================
     */


    async transition({

        id,

        nextStatus,

        actor = 'SYSTEM',

        metadata = {}

    } = {}) {


        const startedAt = Date.now();



        if (!id) {

            throw this.#error(

                'VALIDATION_ERROR',

                'Transaction id is required.',

                400

            );

        }



        if (!nextStatus) {

            throw this.#error(

                'VALIDATION_ERROR',

                'nextStatus is required.',

                400

            );

        }



        const transaction =

            await this.repository.findById(

                id

            );



        if (!transaction) {

            throw this.#error(

                'TRANSACTION_NOT_FOUND',

                'Disbursement transaction not found.',

                404

            );

        }



        const currentStatus =

            String(transaction.status)

                .toUpperCase();



        nextStatus =

            String(nextStatus)

                .toUpperCase();



        /**
         * ---------------------------------------------------------------------
         * Idempotent Processing
         * ---------------------------------------------------------------------
         */


        if (currentStatus === nextStatus) {


            this.logger.info?.({

                event:

                    'mtn.disbursement.transition.idempotent',

                transactionId:

                    id,

                status:

                    currentStatus

            });


            return transaction;


        }





        const allowed =

            this.transitions[currentStatus] || [];



        if (!allowed.includes(nextStatus)) {


            throw this.#error(

                'INVALID_STATE_TRANSITION',

                `Invalid transition ${currentStatus} -> ${nextStatus}`,

                409

            );


        }




        const history =

            Array.isArray(transaction.statusHistory)

                ? [

                    ...transaction.statusHistory

                ]

                : [];



        history.push({

            from:

                currentStatus,


            to:

                nextStatus,


            actor,


            metadata,


            timestamp:

                new Date()

        });





        const update = {


            status:

                nextStatus,


            updatedAt:

                new Date(),


            statusHistory:

                history


        };




        /**
         * Lifecycle timestamps
         */

        update[

            `${nextStatus.toLowerCase()}At`

        ] = new Date();




        const updated =

            await this.repository.update(

                id,

                update

            );




        /**
         * Audit
         */

        await this.auditService?.record({

            action:

                'DISBURSEMENT_STATUS_CHANGED',


            transactionId:

                id,


            previousStatus:

                currentStatus,


            newStatus:

                nextStatus,


            actor,


            metadata,


            timestamp:

                new Date()

        });





        /**
         * Metrics
         */

        this.metrics?.increment?.(

            'mtn.disbursement.transition'

        );



        this.metrics?.observe?.(

            'mtn.disbursement.transition.duration',

            Date.now() - startedAt

        );





        /**
         * Domain Event
         */

        await this.eventBus?.publish?.({

            type:

                `DISBURSEMENT_${nextStatus}`,

            payload:

                updated,


            metadata: {

                previousStatus:

                    currentStatus,


                actor

            }

        });





        this.logger.info?.({

            event:

                'mtn.disbursement.transition.completed',


            transactionId:

                id,


            from:

                currentStatus,


            to:

                nextStatus

        });




        return updated;


    }





    /**
     * =========================================================================
     * Check Allowed Transition
     * =========================================================================
     */


    canTransition({

        currentStatus,

        nextStatus

    }) {


        return (

            this.transitions[

                String(currentStatus)

                    .toUpperCase()

            ] || []

        ).includes(

            String(nextStatus)

                .toUpperCase()

        );


    }





    /**
     * =========================================================================
     * Get Allowed Next States
     * =========================================================================
     */


    allowedTransitions(status) {


        return [

            ...(

                this.transitions[

                    String(status)

                        .toUpperCase()

                ] || []

            )

        ];

    }





    /**
     * =========================================================================
     * Terminal State Check
     * =========================================================================
     */


    isTerminal(status) {


        return (

            this.allowedTransitions(status)

                .length === 0

        );


    }





    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */


    #error(

        code,

        message,

        statusCode = 500

    ) {


        const error =

            new Error(message);



        error.name =

            'DisbursementStateMachineError';



        error.code =

            code;



        error.statusCode =

            statusCode;



        return error;


    }


}



module.exports = TransactionStateMachine;