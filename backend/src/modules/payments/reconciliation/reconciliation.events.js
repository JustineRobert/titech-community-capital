"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * backend/src/modules/payments/reconciliation/reconciliation.events.js
 *
 * Enterprise Reconciliation Domain Events
 *
 * Responsibilities:
 *
 *  - Define reconciliation events
 *  - Standardize event payloads
 *  - Publish domain events
 *  - Provide event contracts
 *
 * Does NOT:
 *
 *  - Execute reconciliation logic
 *  - Persist records
 *  - Handle HTTP requests
 *
 * ============================================================================
 */



const EVENT_TYPES = Object.freeze({


    RECONCILIATION_CREATED:

        "reconciliation.created",



    RECONCILIATION_UPDATED:

        "reconciliation.updated",



    RECONCILIATION_STARTED:

        "reconciliation.started",



    RECONCILIATION_COMPLETED:

        "reconciliation.completed",



    RECONCILIATION_FAILED:

        "reconciliation.failed",



    RECONCILIATION_PARTIAL:

        "reconciliation.partial",



    RECONCILIATION_REPORT_GENERATED:

        "reconciliation.report.generated",



    SETTLEMENT_MATCH_STARTED:

        "reconciliation.settlement.match.started",



    SETTLEMENT_MATCH_COMPLETED:

        "reconciliation.settlement.match.completed",



    SETTLEMENT_MATCH_FAILED:

        "reconciliation.settlement.match.failed",



    BULK_RECONCILIATION_STARTED:

        "reconciliation.bulk.started",



    BULK_RECONCILIATION_COMPLETED:

        "reconciliation.bulk.completed",



    LEDGER_VERIFICATION_FAILED:

        "reconciliation.ledger.verification.failed"



});








/**
 * ============================================================================
 * Event Factory
 * ============================================================================
 */


function createEvent({

    type,

    tenantId,

    data,

    metadata = {}

}) {



    if(!type){

        throw new Error(
            "Event type is required"
        );

    }



    if(!tenantId){

        throw new Error(
            "tenantId is required"
        );

    }





    return {


        id:

            generateEventId(),



        type,



        version:

            "1.0",



        tenantId,



        timestamp:

            new Date(),



        data:



            data || {},



        metadata: {


            correlationId:

                metadata.correlationId
                ||
                null,



            userId:

                metadata.userId
                ||
                null,



            source:

                metadata.source
                ||
                "reconciliation-service",



            ipAddress:

                metadata.ipAddress
                ||
                null



        }



    };


}








/**
 * ============================================================================
 * Event Publisher Wrapper
 * ============================================================================
 */


class ReconciliationEvents {


    constructor(

        eventBus,

        options = {}

    ){


        if(!eventBus){

            throw new Error(

                "ReconciliationEvents requires eventBus"

            );

        }



        this.eventBus =
            eventBus;



        this.logger =
            options.logger || console;


    }








    async publish(

        type,

        tenantId,

        data,

        metadata = {}

    ){


        const event =

            createEvent({

                type,

                tenantId,

                data,

                metadata

            });




        await this.eventBus.publish(

            type,

            event

        );




        this.logger.info({

            message:

                "Reconciliation event published",


            event:

                type,


            tenantId


        });




        return event;


    }








    async reconciliationCreated(

        tenantId,

        reconciliation,

        metadata = {}

    ){


        return this.publish(

            EVENT_TYPES.RECONCILIATION_CREATED,

            tenantId,

            reconciliation,

            metadata

        );


    }








    async reconciliationCompleted(

        tenantId,

        reconciliation,

        metadata = {}

    ){


        return this.publish(

            EVENT_TYPES.RECONCILIATION_COMPLETED,

            tenantId,

            reconciliation,

            metadata

        );


    }








    async reconciliationFailed(

        tenantId,

        payload,

        metadata = {}

    ){


        return this.publish(

            EVENT_TYPES.RECONCILIATION_FAILED,

            tenantId,

            payload,

            metadata

        );


    }








    async reportGenerated(

        tenantId,

        report,

        metadata = {}

    ){


        return this.publish(

            EVENT_TYPES.RECONCILIATION_REPORT_GENERATED,

            tenantId,

            report,

            metadata

        );


    }








    async settlementMatched(

        tenantId,

        settlement,

        metadata = {}

    ){


        return this.publish(

            EVENT_TYPES.SETTLEMENT_MATCH_COMPLETED,

            tenantId,

            settlement,

            metadata

        );


    }



}








/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */


function generateEventId(){

    return (

        Date.now()

        +

        "-"

        +

        Math.random()

            .toString(36)

            .substring(2,10)

    );

}








/**
 * ============================================================================
 * Exports
 * ============================================================================
 */


module.exports = {


    EVENT_TYPES,


    createEvent,


    ReconciliationEvents

};