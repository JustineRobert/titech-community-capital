"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * backend/src/modules/payments/reconciliation/reconciliation.worker.js
 *
 * Enterprise Reconciliation Background Worker
 *
 * Responsibilities:
 *
 *  - Process asynchronous reconciliation jobs
 *  - Execute reconciliation workflows
 *  - Handle retries/failures
 *  - Maintain idempotency
 *  - Propagate audit context
 *
 * Does NOT:
 *
 *  - Handle HTTP requests
 *  - Directly access database
 *  - Implement reconciliation calculations
 *
 * ============================================================================
 */


const {
    Worker
} = require(
    "bullmq"
);



class ReconciliationWorker {



    constructor(
        options = {}
    ) {


        if(
            !options.queueName
        ){

            throw new Error(
                "ReconciliationWorker requires queueName"
            );

        }


        if(
            !options.connection
        ){

            throw new Error(
                "ReconciliationWorker requires Redis connection"
            );

        }



        if(
            !options.service
        ){

            throw new Error(
                "ReconciliationWorker requires reconciliation service"
            );

        }



        this.queueName =
            options.queueName;



        this.connection =
            options.connection;



        this.service =
            options.service;



        this.logger =
            options.logger || console;



        this.worker =
            null;


    }







    /* ===================================================================== */
    /* START WORKER                                                          */
    /* ===================================================================== */


    start(){


        if(this.worker){

            return this.worker;

        }



        this.worker =

            new Worker(

                this.queueName,


                async job => {


                    return this.process(
                        job
                    );


                },


                {


                    connection:
                        this.connection,


                    concurrency:

                        this.options?.concurrency
                        ||
                        5


                }

            );





        this.registerEvents();



        this.logger.info(

            "Reconciliation worker started"

        );



        return this.worker;


    }









    /* ===================================================================== */
    /* PROCESS JOB                                                           */
    /* ===================================================================== */


    async process(
        job
    ){


        const {

            id,

            name,

            data

        } = job;



        const context = {


            correlationId:

                data.correlationId
                ||
                `reconciliation-${id}`,



            userId:

                data.userId
                ||
                null


        };




        this.logger.info({

            message:
                "Processing reconciliation job",


            jobId:
                id,


            jobName:
                name,


            correlationId:
                context.correlationId


        });





        switch(name){



            case "CREATE_RECONCILIATION":


                return this.service.create(

                    data.tenantId,

                    data.payload,

                    context

                );





            case "GENERATE_REPORT":


                return this.service.generateReport(

                    data.tenantId,

                    data.options || {},

                    context

                );





            case "MATCH_SETTLEMENT":


                return this.service.matchSettlement(

                    data.tenantId,

                    data.payload,

                    context

                );





            case "BULK_RECONCILIATION":


                return this.service.bulkProcess(

                    data.tenantId,

                    data.reconciliationIds,

                    context

                );





            default:


                throw new Error(

                    `Unsupported reconciliation job type: ${name}`

                );


        }


    }









    /* ===================================================================== */
    /* EVENTS                                                                */
    /* ===================================================================== */


    registerEvents(){



        this.worker.on(

            "completed",

            job => {


                this.logger.info({

                    message:
                        "Reconciliation job completed",


                    jobId:
                        job.id


                });


            }

        );







        this.worker.on(

            "failed",

            (

                job,

                error

            ) => {


                this.logger.error({

                    message:
                        "Reconciliation job failed",


                    jobId:
                        job?.id,


                    error:
                        error.message


                });


            }

        );








        this.worker.on(

            "error",

            error => {


                this.logger.error({

                    message:
                        "Reconciliation worker error",


                    error:
                        error.message


                });


            }

        );


    }









    /* ===================================================================== */
    /* HEALTH CHECK                                                          */
    /* ===================================================================== */


    async health(){


        return {


            status:
                this.worker
                    ? "running"
                    : "stopped",


            queue:
                this.queueName


        };


    }









    /* ===================================================================== */
    /* SHUTDOWN                                                              */
    /* ===================================================================== */


    async stop(){


        if(
            !this.worker
        ){

            return;

        }



        await this.worker.close();



        this.worker =
            null;



        this.logger.info(

            "Reconciliation worker stopped"

        );


    }



}





module.exports =
    ReconciliationWorker;