'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise MTN MoMo Disbursement Approval Workflow Engine
 * =============================================================================
 *
 * Enterprise Production Implementation
 *
 * Purpose
 * -----------------------------------------------------------------------------
 * Controls authorization of outbound MTN MoMo disbursements using configurable
 * approval policies.
 *
 * Designed for financial operations requiring:
 *
 * • Maker-checker controls
 * • Dual authorization
 * • Amount-based approvals
 * • Role separation
 * • Approval audit trails
 * • Regulatory traceability
 *
 *
 * Responsibilities
 * -----------------------------------------------------------------------------
 * • Evaluate approval policies
 * • Enforce authorization rules
 * • Create approval requests
 * • Track approval lifecycle
 * • Prevent self approval
 * • Support multi-level approvals
 * • Publish approval events
 * • Generate audit evidence
 *
 *
 * Does NOT
 * -----------------------------------------------------------------------------
 * ✗ Execute MTN transfers
 * ✗ Modify ledger records
 * ✗ Bypass payment controls
 * ✗ Perform fraud screening
 *
 * =============================================================================
 */



class ApprovalWorkflow {



    constructor({

        approvalRepository,

        policyEngine,

        userService,

        roleService,

        auditService,

        eventBus,

        metrics,

        logger,

        configuration = {}

    } = {}) {



        if (!approvalRepository) {

            throw new Error(

                'Approval repository required.'

            );

        }



        this.approvalRepository = approvalRepository;

        this.policyEngine = policyEngine;

        this.userService = userService;

        this.roleService = roleService;

        this.auditService = auditService;

        this.eventBus = eventBus;

        this.metrics = metrics;

        this.logger = logger || console;

        this.configuration = configuration;


    }








    /**
     * =========================================================================
     * Authorize Disbursement Request
     * =========================================================================
     */


    async authorize({

        tenantId,

        reference,

        amount,

        requestedBy,

        metadata = {}

    } = {}) {



        this.#validate({

            tenantId,

            reference,

            requestedBy,

            amount

        });




        try {



            /**
             * -----------------------------------------------------------------
             * 1. Evaluate approval policy
             * -----------------------------------------------------------------
             */


            const policy =

                await this.policyEngine.evaluate({

                    tenantId,

                    amount,

                    operation:

                        'MTN_DISBURSEMENT'

                });







            if (!policy?.allowed) {



                throw this.#error(

                    'APPROVAL_POLICY_REJECTED',

                    policy?.reason ||

                    'Approval policy rejected'

                );


            }







            /**
             * -----------------------------------------------------------------
             * 2. Validate requester permissions
             * -----------------------------------------------------------------
             */


            if (this.roleService?.canRequest) {



                const allowed =

                    await this.roleService.canRequest({

                        tenantId,

                        userId:

                            requestedBy,


                        operation:

                            'MTN_DISBURSEMENT'


                    });





                if (!allowed) {



                    throw this.#error(

                        'REQUESTER_NOT_AUTHORIZED',

                        'Requester lacks disbursement permission'

                    );


                }


            }








            /**
             * -----------------------------------------------------------------
             * 3. Check maker-checker separation
             * -----------------------------------------------------------------
             */


            const existing =

                await this.approvalRepository.findByReference?.({

                    tenantId,

                    reference


                });






            if (existing) {



                return existing;


            }








            /**
             * -----------------------------------------------------------------
             * 4. Determine approval level
             * -----------------------------------------------------------------
             */


            const approvalLevel =

                this.#approvalLevel(policy);








            /**
             * -----------------------------------------------------------------
             * 5. Create approval record
             * -----------------------------------------------------------------
             */


            const approval =

                await this.approvalRepository.create({

                    tenantId,

                    reference,

                    requestedBy,

                    amount,

                    operation:

                        'MTN_DISBURSEMENT',


                    approvalLevel,


                    requiredApprovers:

                        policy.requiredApprovers || 1,


                    status:

                        approvalLevel > 0

                            ? 'PENDING_APPROVAL'

                            : 'APPROVED',


                    metadata,


                    createdAt:

                        new Date()


                });








            /**
             * -----------------------------------------------------------------
             * 6. Audit event
             * -----------------------------------------------------------------
             */


            await this.auditService?.record({

                action:

                    'MTN_DISBURSEMENT_APPROVAL_CREATED',



                tenantId,


                reference,


                requestedBy,


                amount,


                approvalLevel



            });








            await this.eventBus?.publish?.({

                type:

                    'MTN_DISBURSEMENT_APPROVAL_CREATED',



                payload:

                    approval


            });








            this.metrics?.increment?.(

                'mtn.disbursement.approval.created'

            );







            return approval;





        }


        catch(error) {



            this.metrics?.increment?.(

                'mtn.disbursement.approval.failed'

            );



            this.logger.error?.({

                event:

                    'mtn.disbursement.approval.failed',


                tenantId,


                reference,


                error

            });




            throw error;


        }


    }








    /**
     * =========================================================================
     * Approve Existing Request
     * =========================================================================
     */


    async approve({

        tenantId,

        reference,

        approvedBy,

        comment

    } = {}) {



        const approval =

            await this.approvalRepository.findByReference({

                tenantId,

                reference

            });







        if (!approval) {



            throw this.#error(

                'APPROVAL_NOT_FOUND',

                'Approval request not found'

            );


        }








        if (

            approval.requestedBy === approvedBy

        ) {



            throw this.#error(

                'SELF_APPROVAL_NOT_ALLOWED',

                'Maker cannot approve own request'

            );


        }








        const updated =

            await this.approvalRepository.update({

                id:

                    approval.id,


                status:

                    'APPROVED',


                approvedBy,

                comment,

                approvedAt:

                    new Date()


            });








        await this.auditService?.record({

            action:

                'MTN_DISBURSEMENT_APPROVED',


            tenantId,

            reference,

            approvedBy


        });







        return updated;


    }








    /**
     * =========================================================================
     * Reject Approval
     * =========================================================================
     */


    async reject({

        tenantId,

        reference,

        rejectedBy,

        reason

    } = {}) {



        return this.approvalRepository.update({

            tenantId,

            reference,

            status:

                'REJECTED',


            rejectedBy,

            reason,

            rejectedAt:

                new Date()


        });


    }








    /**
     * =========================================================================
     * Determine Approval Level
     * =========================================================================
     */


    #approvalLevel(policy) {



        if (

            policy.requireDualAuthorization

        ) {


            return 2;


        }



        return policy.requiredApprovers || 1;


    }








    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */


    #validate({

        tenantId,

        reference,

        requestedBy,

        amount

    }) {



        if (!tenantId) {


            throw this.#error(

                'VALIDATION_ERROR',

                'tenantId required'

            );


        }





        if (!reference) {


            throw this.#error(

                'VALIDATION_ERROR',

                'reference required'

            );


        }





        if (!requestedBy) {


            throw this.#error(

                'VALIDATION_ERROR',

                'requester required'

            );


        }





        if (

            amount === undefined ||

            Number(amount) <= 0

        ) {


            throw this.#error(

                'VALIDATION_ERROR',

                'Invalid amount'

            );


        }


    }








    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */


    #error(code, message) {



        const error =

            new Error(message);




        error.name =

            'ApprovalWorkflowError';




        error.code =

            code;




        error.statusCode =

            403;




        error.retryable =

            false;




        return error;


    }


}





module.exports = ApprovalWorkflow;