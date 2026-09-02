"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * backend/src/modules/payments/reconciliation/reconciliation.validator.js
 *
 * Enterprise Reconciliation Validation Layer
 *
 * Responsibilities:
 *
 *  - Validate API payloads
 *  - Validate service inputs
 *  - Protect financial data integrity
 *  - Validate reconciliation workflows
 *
 * Does NOT:
 *
 *  - Execute reconciliation
 *  - Match transactions
 *  - Update ledger
 *  - Persist data
 *
 * ============================================================================
 */


const Joi = require("joi");



/* ========================================================================== */
/* ENUM CONSTANTS                                                            */
/* ========================================================================== */


const PROVIDERS = Object.freeze([

    "MTN_MOMO",

    "AIRTEL_MONEY",

    "LEDGER",

    "BANK",

    "MANUAL",

    "ALL"

]);



const RECONCILIATION_STATUS = Object.freeze([

    "PENDING",

    "PROCESSING",

    "COMPLETED",

    "FAILED",

    "PARTIAL",

    "DISPUTED"

]);



const REPORT_STATUS = Object.freeze([

    "PENDING",

    "RUNNING",

    "COMPLETED",

    "FAILED",

    "PARTIAL"

]);



const SOURCES = Object.freeze([

    "AUTOMATED",

    "MANUAL"

]);



const CURRENCIES = Object.freeze([

    "UGX",

    "USD",

    "KES",

    "TZS",

    "RWF"

]);





/* ========================================================================== */
/* COMMON VALIDATORS                                                         */
/* ========================================================================== */


const objectIdSchema =

    Joi.string()

        .trim()

        .pattern(
            /^[0-9a-fA-F]{24}$/
        )

        .messages({

            "string.pattern.base":
                "Invalid MongoDB ObjectId"

        });





const tenantIdSchema =

    Joi.string()

        .trim()

        .min(2)

        .max(100)

        .required();





const providerSchema =

    Joi.string()

        .uppercase()

        .valid(
            ...PROVIDERS
        );





const currencySchema =

    Joi.string()

        .uppercase()

        .valid(
            ...CURRENCIES
        );





const amountSchema =

    Joi.number()

        .integer()

        .min(0);






/* ========================================================================== */
/* CREATE RECONCILIATION                                                     */
/* ========================================================================== */


const createReconciliationSchema =

    Joi.object({


        tenantId:

            tenantIdSchema,



        provider:

            providerSchema

                .required(),



        currency:

            currencySchema

                .required(),



        settlementReference:

            Joi.string()

                .trim()

                .max(150)

                .required(),



        transactionCount:

            Joi.number()

                .integer()

                .min(0)

                .required(),



        totalAmount:

            amountSchema

                .required(),



        reconciliationDate:

            Joi.date()

                .required(),



        source:

            Joi.string()

                .valid(
                    ...SOURCES
                )

                .default(
                    "AUTOMATED"
                ),



        notes:

            Joi.string()

                .trim()

                .max(2000)

                .allow("")



    })

    .strict();







/* ========================================================================== */
/* UPDATE RECONCILIATION                                                     */
/* ========================================================================== */


const updateReconciliationSchema =

    Joi.object({


        status:

            Joi.string()

                .uppercase()

                .valid(
                    ...RECONCILIATION_STATUS
                ),



        matchedCount:

            Joi.number()

                .integer()

                .min(0),



        unmatchedCount:

            Joi.number()

                .integer()

                .min(0),



        matchedAmount:

            amountSchema,



        notes:

            Joi.string()

                .trim()

                .max(2000)



    })

    .min(1)

    .strict();







/* ========================================================================== */
/* GET BY ID                                                                 */
/* ========================================================================== */


const reconciliationIdSchema =

    Joi.object({


        tenantId:

            tenantIdSchema,



        id:

            objectIdSchema

                .required()



    })

    .strict();







/* ========================================================================== */
/* LIST / SEARCH                                                             */
/* ========================================================================== */


const reconciliationQuerySchema =

    Joi.object({


        tenantId:

            tenantIdSchema,



        provider:

            providerSchema,



        status:

            Joi.string()

                .uppercase()

                .valid(
                    ...RECONCILIATION_STATUS
                ),



        startDate:

            Joi.date(),



        endDate:

            Joi.date()

                .min(
                    Joi.ref(
                        "startDate"
                    )
                ),



        page:

            Joi.number()

                .integer()

                .min(1)

                .default(1),



        limit:

            Joi.number()

                .integer()

                .min(1)

                .max(200)

                .default(50)



    })

    .strict();







/* ========================================================================== */
/* REPORT GENERATION                                                        */
/* ========================================================================== */


const generateReportSchema =

    Joi.object({


        tenantId:

            tenantIdSchema,



        provider:

            providerSchema

                .default(
                    "ALL"
                ),



        status:

            Joi.string()

                .uppercase()

                .valid(
                    ...REPORT_STATUS
                )

                .default(
                    "PENDING"
                ),



        startDate:

            Joi.date(),



        endDate:

            Joi.date()

                .min(
                    Joi.ref(
                        "startDate"
                    )
                ),



        reconciliationIds:

            Joi.array()

                .items(
                    objectIdSchema
                )

                .max(10000)



    })

    .strict();







/* ========================================================================== */
/* SETTLEMENT MATCH                                                          */
/* ========================================================================== */


const settlementMatchSchema =

    Joi.object({


        tenantId:

            tenantIdSchema,



        reconciliationId:

            objectIdSchema

                .required(),



        transactions:

            Joi.array()

                .items(

                    Joi.object({


                        transactionId:

                            Joi.string()

                                .trim()

                                .required(),



                        reference:

                            Joi.string()

                                .trim()

                                .required(),



                        amount:

                            amountSchema

                                .required()



                    })

                )

                .min(1)

                .max(5000)

                .required()



    })

    .strict();







/* ========================================================================== */
/* BULK RECONCILIATION                                                       */
/* ========================================================================== */


const bulkReconciliationSchema =

    Joi.object({


        tenantId:

            tenantIdSchema,



        reconciliationIds:

            Joi.array()

                .items(
                    objectIdSchema
                )

                .min(1)

                .max(500)

                .required()



    })

    .strict();







/* ========================================================================== */
/* VALIDATION HELPER                                                        */
/* ========================================================================== */


function validate(

    schema,

    payload

){


    return schema.validate(

        payload,

        {

            abortEarly:false,

            stripUnknown:true

        }

    );

}





/* ========================================================================== */
/* CLASS VALIDATOR                                                            */
/* ========================================================================== */


class ReconciliationValidator {


    validateGenerateReport(
        payload = {}
    ){


        const {
            error,
            value
        } =

            validate(

                generateReportSchema,

                payload

            );



        return {

            valid:
                !error,


            errors:

                error

                    ? error.details.map(
                        item =>
                            item.message
                    )

                    : [],



            value

        };


    }



    validateCreate(
        payload = {}
    ){


        const {
            error,
            value
        } =

            validate(

                createReconciliationSchema,

                payload

            );



        return {

            valid:
                !error,


            errors:

                error

                    ? error.details.map(
                        item =>
                            item.message
                    )

                    : [],



            value

        };


    }



}






/* ========================================================================== */
/* EXPORTS                                                                    */
/* ========================================================================== */


module.exports = {


    ReconciliationValidator,


    validate,


    createReconciliationSchema,


    updateReconciliationSchema,


    reconciliationIdSchema,


    reconciliationQuerySchema,


    generateReportSchema,


    settlementMatchSchema,


    bulkReconciliationSchema,


    PROVIDERS,


    RECONCILIATION_STATUS,


    REPORT_STATUS,


    SOURCES,


    CURRENCIES

};