"use strict";


/**
 * ============================================================================
 * TITech Community Capital LTD
 *
 * File:
 * tests/validators/reconciliation.validator.test.js
 *
 * Enterprise Reconciliation Validator Tests
 *
 * ============================================================================
 */


const {

    ReconciliationValidator,

    generateReportSchema,

    createReconciliationSchema,

    updateReconciliationSchema,

    reconciliationIdSchema,

    reconciliationQuerySchema,

    settlementMatchSchema,

    bulkReconciliationSchema,

    validate

} = require(
    "../../backend/src/modules/payments/reconciliation/reconciliation.validator"
);



describe(
    "Reconciliation Validator",
    () => {



        let validator;



        beforeEach(
            () => {

                validator =
                    new ReconciliationValidator();

            }
        );




        /* ================================================================== */
        /* CLASS VALIDATOR                                                    */
        /* ================================================================== */


        describe(
            "ReconciliationValidator class",
            () => {



                test(
                    "should validate valid report generation payload",
                    () => {


                        const result =

                            validator.validateGenerateReport({

                                tenantId:
                                    "tenant-001",

                                provider:
                                    "MTN_MOMO",

                                status:
                                    "PENDING"

                            });



                        expect(
                            result.valid
                        ).toBe(
                            true
                        );


                        expect(
                            result.errors
                        ).toHaveLength(
                            0
                        );


                    }
                );





                test(
                    "should reject missing tenantId",
                    () => {


                        const result =

                            validator.validateGenerateReport({

                                provider:
                                    "MTN_MOMO"

                            });



                        expect(
                            result.valid
                        ).toBe(
                            false
                        );



                        expect(
                            result.errors.join(" ")
                        ).toContain(
                            "tenantId"
                        );


                    }
                );



            }
        );






        /* ================================================================== */
        /* CREATE RECONCILIATION                                              */
        /* ================================================================== */


        describe(
            "createReconciliationSchema",
            () => {



                test(
                    "should accept valid reconciliation",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                createReconciliationSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    provider:
                                        "MTN_MOMO",

                                    currency:
                                        "UGX",

                                    settlementReference:
                                        "SETTLEMENT-001",

                                    transactionCount:
                                        100,

                                    totalAmount:
                                        500000,

                                    reconciliationDate:
                                        new Date(),

                                    source:
                                        "AUTOMATED"

                                }

                            );



                        expect(
                            error
                        ).toBeUndefined();


                    }
                );





                test(
                    "should reject missing provider",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                createReconciliationSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    currency:
                                        "UGX"

                                }

                            );



                        expect(
                            error
                        ).toBeDefined();


                    }
                );






                test(
                    "should reject invalid provider",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                createReconciliationSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    provider:
                                        "INVALID",

                                    currency:
                                        "UGX",

                                    settlementReference:
                                        "REF001",

                                    transactionCount:
                                        10,

                                    totalAmount:
                                        1000,

                                    reconciliationDate:
                                        new Date()

                                }

                            );



                        expect(
                            error
                        ).toBeDefined();


                    }
                );



            }
        );







        /* ================================================================== */
        /* UPDATE VALIDATION                                                  */
        /* ================================================================== */


        describe(
            "updateReconciliationSchema",
            () => {



                test(
                    "should accept valid status update",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                updateReconciliationSchema,

                                {

                                    status:
                                        "COMPLETED"

                                }

                            );



                        expect(
                            error
                        ).toBeUndefined();


                    }
                );





                test(
                    "should reject invalid status",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                updateReconciliationSchema,

                                {

                                    status:
                                        "UNKNOWN"

                                }

                            );



                        expect(
                            error
                        ).toBeDefined();


                    }
                );



            }
        );






        /* ================================================================== */
        /* FIND BY ID                                                         */
        /* ================================================================== */


        describe(
            "reconciliationIdSchema",
            () => {



                test(
                    "should accept valid ObjectId",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                reconciliationIdSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    id:
                                        "507f1f77bcf86cd799439011"

                                }

                            );



                        expect(
                            error
                        ).toBeUndefined();


                    }
                );





                test(
                    "should reject invalid ObjectId",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                reconciliationIdSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    id:
                                        "123"

                                }

                            );



                        expect(
                            error
                        ).toBeDefined();


                    }
                );



            }
        );








        /* ================================================================== */
        /* QUERY VALIDATION                                                    */
        /* ================================================================== */


        describe(
            "reconciliationQuerySchema",
            () => {



                test(
                    "should validate pagination query",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                reconciliationQuerySchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    page:
                                        1,

                                    limit:
                                        50

                                }

                            );



                        expect(
                            error
                        ).toBeUndefined();


                    }
                );





                test(
                    "should reject invalid date range",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                reconciliationQuerySchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    startDate:
                                        "2026-02-01",

                                    endDate:
                                        "2026-01-01"

                                }

                            );



                        expect(
                            error
                        ).toBeDefined();


                    }
                );



            }
        );







        /* ================================================================== */
        /* SETTLEMENT MATCH                                                    */
        /* ================================================================== */


        describe(
            "settlementMatchSchema",
            () => {



                test(
                    "should validate settlement transactions",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                settlementMatchSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    reconciliationId:
                                        "507f1f77bcf86cd799439011",

                                    transactions:

                                        [

                                            {

                                                transactionId:
                                                    "TX001",

                                                reference:
                                                    "MM001",

                                                amount:
                                                    10000

                                            }

                                        ]

                                }

                            );



                        expect(
                            error
                        ).toBeUndefined();


                    }
                );



            }
        );








        /* ================================================================== */
        /* BULK VALIDATION                                                     */
        /* ================================================================== */


        describe(
            "bulkReconciliationSchema",
            () => {



                test(
                    "should validate bulk reconciliation request",
                    () => {


                        const {
                            error
                        } =

                            validate(

                                bulkReconciliationSchema,

                                {

                                    tenantId:
                                        "tenant-001",

                                    reconciliationIds:

                                        [

                                            "507f1f77bcf86cd799439011"

                                        ]

                                }

                            );



                        expect(
                            error
                        ).toBeUndefined();


                    }
                );



            }
        );



    }
);