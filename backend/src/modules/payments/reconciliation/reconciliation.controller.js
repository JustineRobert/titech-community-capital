"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * backend/src/modules/payments/reconciliation/reconciliation.controller.js
 *
 * Enterprise Reconciliation Controller
 *
 * Responsibilities:
 *
 *  - Handle reconciliation HTTP requests
 *  - Validate incoming payloads
 *  - Delegate business logic
 *  - Return consistent API responses
 *  - Propagate audit/security context
 *
 * Business logic belongs in:
 *
 *      reconciliation.service.js
 *
 * Persistence belongs in:
 *
 *      reconciliation.repository.js
 *
 * ============================================================================
 */


const {

    validate,

    createReconciliationSchema,

    updateReconciliationSchema,

    reconciliationIdSchema,

    reconciliationQuerySchema,

    generateReportSchema,

    settlementMatchSchema,

    bulkReconciliationSchema

} = require(
    "./reconciliation.validator"
);





class ReconciliationController {


    constructor(
        reconciliationService,
        logger
    ) {


        if (!reconciliationService) {

            throw new Error(
                "ReconciliationController requires reconciliationService"
            );

        }


        this.service =
            reconciliationService;


        this.logger =
            logger || console;



        this.create =
            this.create.bind(this);


        this.getById =
            this.getById.bind(this);


        this.list =
            this.list.bind(this);


        this.update =
            this.update.bind(this);


        this.generateReport =
            this.generateReport.bind(this);


        this.matchSettlement =
            this.matchSettlement.bind(this);


        this.bulkProcess =
            this.bulkProcess.bind(this);


    }





    /* ===================================================================== */
    /* CREATE RECONCILIATION                                                 */
    /* ===================================================================== */


    async create(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    createReconciliationSchema,

                    req.body

                );



            if (error) {


                return res.status(400)
                    .json({

                        success:false,

                        message:
                            "Validation failed",

                        errors:
                            error.details.map(
                                e => e.message
                            )

                    });

            }




            const result =

                await this.service.create(

                    value.tenantId,

                    value,

                    {

                        userId:
                            req.user?.id,


                        correlationId:
                            req.id

                    }

                );



            return res.status(201)
                .json({

                    success:true,

                    data:
                        result

                });



        } catch(error) {


            next(error);

        }


    }






    /* ===================================================================== */
    /* GET BY ID                                                             */
    /* ===================================================================== */


    async getById(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    reconciliationIdSchema,

                    {

                        tenantId:
                            req.tenantId,

                        id:
                            req.params.id

                    }

                );



            if(error){


                return res.status(400)
                    .json({

                        success:false,

                        message:
                            "Invalid reconciliation id"

                    });

            }




            const result =

                await this.service.findById(

                    value.tenantId,

                    value.id

                );



            if(!result){


                return res.status(404)
                    .json({

                        success:false,

                        message:
                            "Reconciliation record not found"

                    });

            }



            return res.json({

                success:true,

                data:
                    result

            });



        } catch(error) {


            next(error);

        }


    }







    /* ===================================================================== */
    /* LIST                                                                  */
    /* ===================================================================== */


    async list(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    reconciliationQuerySchema,

                    {

                        tenantId:
                            req.tenantId,


                        ...req.query

                    }

                );



            if(error){


                return res.status(400)
                    .json({

                        success:false,

                        errors:
                            error.details.map(
                                e => e.message
                            )

                    });

            }



            const result =

                await this.service.list(

                    value.tenantId,

                    value

                );



            return res.json({

                success:true,

                ...result

            });



        } catch(error) {


            next(error);

        }


    }








    /* ===================================================================== */
    /* UPDATE                                                                 */
    /* ===================================================================== */


    async update(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    updateReconciliationSchema,

                    req.body

                );



            if(error){


                return res.status(400)
                    .json({

                        success:false,

                        errors:
                            error.details.map(
                                e => e.message
                            )

                    });

            }



            const result =

                await this.service.update(

                    req.tenantId,

                    req.params.id,

                    value,

                    {

                        updatedBy:
                            req.user?.id

                    }

                );



            return res.json({

                success:true,

                data:
                    result

            });



        } catch(error){


            next(error);

        }


    }








    /* ===================================================================== */
    /* GENERATE REPORT                                                        */
    /* ===================================================================== */


    async generateReport(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    generateReportSchema,

                    {

                        tenantId:
                            req.tenantId,

                        ...req.body

                    }

                );



            if(error){


                return res.status(400)
                    .json({

                        success:false,

                        errors:
                            error.details.map(
                                e => e.message
                            )

                    });

            }



            const report =

                await this.service.generateReport(

                    value.tenantId,

                    value,

                    {

                        requestedBy:
                            req.user?.id

                    }

                );



            return res.json({

                success:true,

                data:
                    report

            });



        } catch(error){


            next(error);

        }


    }








    /* ===================================================================== */
    /* MATCH SETTLEMENT                                                       */
    /* ===================================================================== */


    async matchSettlement(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    settlementMatchSchema,

                    {

                        tenantId:
                            req.tenantId,


                        ...req.body

                    }

                );



            if(error){


                return res.status(400)
                    .json({

                        success:false,

                        errors:
                            error.details.map(
                                e => e.message
                            )

                    });

            }



            const result =

                await this.service.matchSettlement(

                    value.tenantId,

                    value,

                    {

                        userId:
                            req.user?.id

                    }

                );



            return res.json({

                success:true,

                data:
                    result

            });



        } catch(error){


            next(error);

        }


    }








    /* ===================================================================== */
    /* BULK PROCESS                                                          */
    /* ===================================================================== */


    async bulkProcess(
        req,
        res,
        next
    ) {


        try {


            const {
                error,
                value
            } =
                validate(

                    bulkReconciliationSchema,

                    {

                        tenantId:
                            req.tenantId,


                        ...req.body

                    }

                );



            if(error){


                return res.status(400)
                    .json({

                        success:false,

                        errors:
                            error.details.map(
                                e => e.message
                            )

                    });

            }



            const result =

                await this.service.bulkProcess(

                    value.tenantId,

                    value.reconciliationIds,

                    {

                        userId:
                            req.user?.id

                    }

                );



            return res.json({

                success:true,

                data:
                    result

            });



        } catch(error){


            next(error);

        }


    }



}



module.exports =
    ReconciliationController;