"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * backend/src/modules/payments/reconciliation/reconciliation.service.js
 *
 * Enterprise Reconciliation Service Layer
 *
 * Responsibilities:
 *
 *  - Reconciliation workflow orchestration
 *  - Settlement matching coordination
 *  - Ledger verification coordination
 *  - Report generation
 *  - Audit/event integration
 *
 * Does NOT:
 *
 *  - Handle HTTP
 *  - Direct database queries
 *  - Implement payment provider logic
 *
 * ============================================================================
 */


const crypto = require("crypto");



class ReconciliationService {


    constructor(
        repository,
        dependencies = {}
    ) {


        if (!repository) {

            throw new Error(
                "ReconciliationService requires repository"
            );

        }


        this.repository =
            repository;



        this.ledgerService =
            dependencies.ledgerService;



        this.auditService =
            dependencies.auditService;



        this.eventBus =
            dependencies.eventBus;



        this.logger =
            dependencies.logger || console;


    }







    /* ===================================================================== */
    /* CREATE RECONCILIATION                                                 */
    /* ===================================================================== */


    async create(
        tenantId,
        payload,
        context = {}
    ) {


        this.assertTenant(
            tenantId
        );


        const idempotencyKey =
            this.generateIdempotencyKey(
                tenantId,
                payload.settlementReference
            );



        const existing =

            await this.repository.findOne(

                tenantId,

                {
                    idempotencyKey
                }

            );



        if(existing){

            return existing;

        }





        const reconciliation =

            await this.repository.create(

                tenantId,

                {

                    ...payload,

                    idempotencyKey,

                    status:
                        "PENDING"

                }

            );




        await this.publishEvent(

            "RECONCILIATION_CREATED",

            reconciliation,

            context

        );



        return reconciliation;


    }









    /* ===================================================================== */
    /* FIND BY ID                                                            */
    /* ===================================================================== */


    async findById(
        tenantId,
        id
    ) {


        this.assertTenant(
            tenantId
        );



        return this.repository.findById(

            tenantId,

            id

        );


    }









    /* ===================================================================== */
    /* LIST                                                                  */
    /* ===================================================================== */


    async list(
        tenantId,
        filters = {}
    ) {


        this.assertTenant(
            tenantId
        );



        return this.repository.findAll(

            tenantId,

            filters

        );


    }









    /* ===================================================================== */
    /* UPDATE                                                                */
    /* ===================================================================== */


    async update(
        tenantId,
        id,
        updates,
        context = {}
    ) {


        this.assertTenant(
            tenantId
        );



        const current =

            await this.repository.findById(

                tenantId,

                id

            );



        if(!current){

            throw new Error(
                "Reconciliation record not found"
            );

        }




        const updated =

            await this.repository.updateById(

                tenantId,

                id,

                updates,

                {

                    updatedBy:
                        context.userId

                }

            );





        await this.publishEvent(

            "RECONCILIATION_UPDATED",

            updated,

            context

        );



        return updated;


    }









    /* ===================================================================== */
    /* GENERATE REPORT                                                       */
    /* ===================================================================== */


    async generateReport(
        tenantId,
        options = {},
        context = {}
    ) {


        this.assertTenant(
            tenantId
        );



        const records =

            await this.repository.findAll(

                tenantId,

                options

            );





        const report = {


            tenantId,


            generatedAt:
                new Date(),



            generatedBy:
                context.requestedBy || null,



            provider:
                options.provider || "ALL",



            totalRecords:

                records.data.length,



            summary:

                this.calculateSummary(
                    records.data
                )

        };





        await this.publishEvent(

            "RECONCILIATION_REPORT_GENERATED",

            report,

            context

        );



        return report;


    }









    /* ===================================================================== */
    /* MATCH SETTLEMENT                                                      */
    /* ===================================================================== */


    async matchSettlement(
        tenantId,
        payload,
        context = {}
    ) {


        this.assertTenant(
            tenantId
        );



        const reconciliation =

            await this.repository.findById(

                tenantId,

                payload.reconciliationId

            );



        if(!reconciliation){


            throw new Error(
                "Reconciliation record not found"
            );

        }





        const matchedAmount =

            payload.transactions.reduce(

                (sum,item)=>

                    sum + item.amount,

                0

            );





        const result =

            await this.repository.updateById(

                tenantId,

                payload.reconciliationId,

                {

                    matchedCount:
                        payload.transactions.length,


                    matchedAmount,


                    status:
                        "COMPLETED"

                },

                {

                    updatedBy:
                        context.userId

                }

            );





        if(this.ledgerService){


            await this.ledgerService.verifyReconciliation(

                tenantId,

                result

            );


        }






        await this.publishEvent(

            "SETTLEMENT_MATCHED",

            result,

            context

        );



        return result;


    }









    /* ===================================================================== */
    /* BULK PROCESS                                                          */
    /* ===================================================================== */


    async bulkProcess(
        tenantId,
        reconciliationIds,
        context = {}
    ) {


        this.assertTenant(
            tenantId
        );



        const results = [];



        for(
            const id of reconciliationIds
        ){


            const record =

                await this.repository.findById(

                    tenantId,

                    id

                );



            if(record){


                results.push(

                    await this.repository.updateById(

                        tenantId,

                        id,

                        {

                            status:
                                "PROCESSING"

                        },

                        {

                            updatedBy:
                                context.userId

                        }

                    )

                );


            }


        }



        return results;


    }









    /* ===================================================================== */
    /* HELPERS                                                               */
    /* ===================================================================== */


    assertTenant(
        tenantId
    ){

        if(
            !tenantId ||
            typeof tenantId !== "string"
        ){

            throw new Error(
                "tenantId is required"
            );

        }

    }






    generateIdempotencyKey(
        tenantId,
        reference
    ){

        return crypto

            .createHash("sha256")

            .update(

                `${tenantId}:${reference}`

            )

            .digest("hex");


    }







    calculateSummary(
        records
    ){


        return {


            totalAmount:

                records.reduce(

                    (sum,r)=>

                        sum +
                        (r.totalAmount || 0),

                    0

                ),



            completed:

                records.filter(

                    r =>
                        r.status === "COMPLETED"

                ).length,


            failed:

                records.filter(

                    r =>
                        r.status === "FAILED"

                ).length


        };


    }








    async publishEvent(
        event,
        data,
        context
    ){


        if(!this.eventBus){

            return;

        }



        await this.eventBus.publish(

            event,

            {

                data,


                correlationId:

                    context.correlationId

            }

        );


    }



}



module.exports =
    ReconciliationService;