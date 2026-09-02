"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: tests/repositories/reconciliationRepository.test.js
 *
 * Enterprise Reconciliation Repository Tests
 * ============================================================================
 */


const ReconciliationRepository =
    require(
        "../../backend/repositories/reconciliationRepository"
    );


describe(
    "ReconciliationRepository",
    () => {


        let repository;
        let ReconciliationModel;



        beforeEach(
            () => {


                ReconciliationModel = {


                    create:
                        jest.fn(),


                    findOne:
                        jest.fn(),


                    find:
                        jest.fn(),


                    countDocuments:
                        jest.fn(),


                    findOneAndUpdate:
                        jest.fn(),


                    exists:
                        jest.fn()

                };



                repository =
                    new ReconciliationRepository(
                        ReconciliationModel
                    );

            }
        );



        afterEach(
            () => {

                jest.clearAllMocks();

            }
        );



        /* ============================================================ */
        /* CONSTRUCTOR                                                  */
        /* ============================================================ */


        test(
            "should require ReconciliationModel",
            () => {


                expect(

                    () =>
                        new ReconciliationRepository()

                ).toThrow(

                    "ReconciliationRepository requires a mongoose model"

                );


            }
        );



        /* ============================================================ */
        /* CREATE                                                       */
        /* ============================================================ */


        test(
            "should create reconciliation report",
            async () => {


                const mockRecord = {

                    reconciliationId:
                        "REC001"

                };



                ReconciliationModel.create
                    .mockResolvedValue(

                        [
                            {
                                toObject:
                                    () =>
                                        mockRecord
                            }
                        ]

                    );



                const result =

                    await repository.create(

                        "tenant-001",

                        {

                            reconciliationId:
                                "REC001"

                        }

                    );



                expect(

                    result.reconciliationId

                ).toBe(

                    "REC001"

                );


            }
        );




        test(
            "should propagate create errors",
            async () => {


                ReconciliationModel.create
                    .mockRejectedValue(

                        new Error(
                            "Database unavailable"
                        )

                    );



                await expect(

                    repository.create(

                        "tenant-001",

                        {}

                    )

                ).rejects.toThrow(

                    "Database unavailable"

                );


            }
        );



        /* ============================================================ */
        /* FIND BY ID                                                   */
        /* ============================================================ */


        test(
            "should find report by id",
            async () => {


                ReconciliationModel.findOne
                    .mockReturnValue({

                        lean:
                            jest.fn()
                                .mockResolvedValue({

                                    reconciliationId:
                                        "REC001"

                                })

                    });



                const result =

                    await repository.findById(

                        "tenant-001",

                        "507f1f77bcf86cd799439011"

                    );



                expect(

                    result.reconciliationId

                ).toBe(

                    "REC001"

                );


            }
        );





        test(
            "should return null when report not found",
            async () => {


                ReconciliationModel.findOne
                    .mockReturnValue({

                        lean:
                            jest.fn()
                                .mockResolvedValue(
                                    null
                                )

                    });



                const result =

                    await repository.findById(

                        "tenant-001",

                        "507f1f77bcf86cd799439011"

                    );



                expect(

                    result

                ).toBeNull();


            }
        );



        /* ============================================================ */
        /* UPDATE                                                       */
        /* ============================================================ */


        test(
            "should update reconciliation record",
            async () => {


                ReconciliationModel
                    .findOneAndUpdate
                    .mockReturnValue({

                        lean:
                            jest.fn()
                                .mockResolvedValue({

                                    status:
                                        "COMPLETED"

                                })

                    });



                const result =

                    await repository.updateById(

                        "tenant-001",

                        "507f1f77bcf86cd799439011",

                        {

                            status:
                                "COMPLETED"

                        }

                    );



                expect(

                    result.status

                ).toBe(

                    "COMPLETED"

                );


            }
        );



        /* ============================================================ */
        /* DELETE                                                       */
        /* ============================================================ */


        test(
            "should soft delete reconciliation record",
            async () => {


                ReconciliationModel
                    .findOneAndUpdate
                    .mockReturnValue({

                        lean:
                            jest.fn()
                                .mockResolvedValue({

                                    deleted:
                                        true

                                })

                    });



                const result =

                    await repository.softDelete(

                        "tenant-001",

                        "507f1f77bcf86cd799439011"

                    );



                expect(

                    result.deleted

                ).toBe(

                    true

                );


            }
        );



    }
);