"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: tests/repositories/complianceRepository.test.js
 * Enterprise Compliance Repository Tests
 * ============================================================================
 */

const ComplianceRepository =
    require(
        "../../backend/repositories/complianceRepository"
    );

describe(
    "ComplianceRepository",
    () => {

        let repository;
        let ComplianceModel;

        beforeEach(
            () => {

                ComplianceModel = {

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
                        jest.fn(),

                    updateMany:
                        jest.fn()
                };

                repository =
                    new ComplianceRepository(
                        ComplianceModel
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
            "should require ComplianceModel",
            () => {

                expect(
                    () => new ComplianceRepository()
                ).toThrow(
                    "ComplianceModel is required."
                );
            }
        );

        /* ============================================================ */
        /* CREATE                                                      */
        /* ============================================================ */

        test(
            "should create compliance case",
            async () => {

                ComplianceModel.create
                    .mockResolvedValue({

                        _id:
                            "case123"
                    });

                const result =

                    await repository.create({

                        tenantId:
                            "tenant-001"
                    });

                expect(
                    result._id
                ).toBe(
                    "case123"
                );

                expect(
                    ComplianceModel.create
                ).toHaveBeenCalled();
            }
        );

        test(
            "should throw create errors",
            async () => {

                ComplianceModel.create
                    .mockRejectedValue(

                        new Error(
                            "Database unavailable"
                        )
                    );

                await expect(

                    repository.create({

                        tenantId:
                            "tenant-001"
                    })

                ).rejects.toThrow(
                    "Database unavailable"
                );
            }
        );

        /* ============================================================ */
        /* FIND BY ID                                                  */
        /* ============================================================ */

        test(
            "should find case by id",
            async () => {

                ComplianceModel.findOne
                    .mockReturnValue({

                        lean:
                            jest.fn()
                                .mockResolvedValue({

                                    _id:
                                        "case123"
                                })
                    });

                const result =

                    await repository.findById(

                        "tenant-001",

                        "case123"
                    );

                expect(
                    result._id
                ).toBe(
                    "case123"
                );
            }
        );

        test(
            "should enforce tenant isolation",
            async () => {

                ComplianceModel.findOne
                    .mockReturnValue({

                        lean:
                            jest.fn()
                    });

                await repository.findById(

                    "tenant-abc",

                    "case123"
                );

                expect(
                    ComplianceModel.findOne
                ).toHaveBeenCalledWith(

                    expect.objectContaining({

                        tenantId:
                            "tenant-abc"
                    })
                );
            }
        );

        /* ============================================================ */
        /* UPDATE                                                      */
        /* ============================================================ */

        test(
            "should update case",
            async () => {

                ComplianceModel
                    .findOneAndUpdate
                    .mockReturnValue({

                        lean:
                            jest.fn()
                                .mockResolvedValue({

                                    status:
                                        "CLOSED"
                                })
                    });

                const result =

                    await repository
                        .updateById(

                            "tenant-001",

                            "case123",

                            {

                                status:
                                    "CLOSED"
                            }
                        );

                expect(
                    result.status
                ).toBe(
                    "CLOSED"
                );
            }
        );

        /* ============================================================ */
        /* CLOSE CASE                                                  */
        /* ============================================================ */

        test(
            "should close compliance case",
            async () => {

                repository.updateById =
                    jest.fn()
                        .mockResolvedValue({

    status:
        "CLOSED"
});

const result =

    await repository
        .closeCase(

            "tenant-001",

            "case123",

            {

                notes:
                    "False positive"
            }
        );

expect(
    result.status
).toBe(
    "CLOSED"
);

expect(
    repository.updateById
).toHaveBeenCalled();
        }
    );

    /* ============================================================ */
    /* EXISTS                                                      */
    /* ============================================================ */

    test(
        "should check existence",
        async () => {

            ComplianceModel.exists
                .mockResolvedValue(
                    true
                );

            const result =

                await repository.exists(

                    "tenant-001",

                    {

                        transactionId:
                            "txn123"
                    }
                );

            expect(
                result
            ).toBe(
                true
            );
        }
    );

    /* ============================================================ */
    /* BULK UPDATE                                                  */
    /* ============================================================ */

    test(
        "should bulk update cases",
        async () => {

            ComplianceModel
                .updateMany
                .mockResolvedValue({

                    modifiedCount:
                        20
                });

            const result =

                await repository.bulkUpdate(

                    "tenant-001",

                    {

                        category:
                            "AML"
                    },

                    {

                        reviewer:
                            "admin"
                    }
                );

            expect(
                result.modifiedCount
            ).toBe(
                20
            );
        }
    );

    /* ============================================================ */
    /* COMPLIANCE METRICS                                           */
    /* ============================================================ */

    test(
        "should return compliance metrics",
        async () => {

            ComplianceModel
                .countDocuments
                .mockResolvedValueOnce(
                    100
                )
                .mockResolvedValueOnce(
                    40
                )
                .mockResolvedValueOnce(
                    20
                )
                .mockResolvedValueOnce(
                    10
                )
                .mockResolvedValueOnce(
                    30
                );

            const metrics =

                await repository
                    .getComplianceMetrics(

                        "tenant-001"
                    );

            expect(
                metrics.totalCases
            ).toBe(
                100
            );

            expect(
                metrics.amlCases
            ).toBe(
                40
            );

            expect(
                metrics.fraudCases
            ).toBe(
                20
            );

            expect(
                metrics.highRiskCases
            ).toBe(
                10
            );

            expect(
                metrics.openCases
            ).toBe(
                30
            );
        }
    );

    /* ============================================================ */
    /* AML CASES                                                   */
    /* ============================================================ */

    test(
        "should get aml cases",
        async () => {

            repository.find =
                jest.fn()
                    .mockResolvedValue([]);

            await repository
                .getAmlCases(
                    "tenant-001"
                );

            expect(
                repository.find
            ).toHaveBeenCalledWith(

                "tenant-001",

                {
                    category:
                        "AML"
                }
            );
        }
    );

    /* ============================================================ */
    /* FRAUD CASES                                                 */
    /* ============================================================ */

    test(
        "should get fraud cases",
        async () => {

            repository.find =
                jest.fn()
                    .mockResolvedValue([]);

            await repository
                .getFraudCases(
                    "tenant-001"
                );

            expect(
                repository.find
            ).toHaveBeenCalledWith(

                "tenant-001",

                {
                    category:
                        "FRAUD"
                }
            );
        }
    );

    /* ============================================================ */
    /* HIGH RISK CASES                                             */
    /* ============================================================ */

    test(
        "should get high risk cases",
        async () => {

            repository.find =
                jest.fn()
                    .mockResolvedValue([]);

            await repository
                .getHighRiskCases(
                    "tenant-001"
                );

            expect(
                repository.find
            ).toHaveBeenCalledWith(

                "tenant-001",

                {
                    riskLevel:
                        "HIGH"
                }
            );
        }
    );

    /* ============================================================ */
    /* SANCTIONS MATCHES                                            */
    /* ============================================================ */

    test(
        "should get sanctions matches",
        async () => {

            repository.find =
                jest.fn()
                    .mockResolvedValue([]);

            await repository
                .getSanctionsMatches(
                    "tenant-001"
                );

            expect(
                repository.find
            ).toHaveBeenCalledWith(

                "tenant-001",

                {
                    type:
                        "SANCTIONS_MATCH"
                }
            );
        }
    );

    /* ============================================================ */
    /* PEP MATCHES                                                  */
    /* ============================================================ */

    test(
        "should get pep matches",
        async () => {

            repository.find =
                jest.fn()
                    .mockResolvedValue([]);

            await repository
                .getPepMatches(
                    "tenant-001"
                );

            expect(
                repository.find
            ).toHaveBeenCalledWith(

                "tenant-001",

                {
                    type:
                        "PEP_MATCH"
                }
            );
        }
    );

    /* ============================================================ */
/* CASE NOT FOUND                                               */
/* ============================================================ */

test(
    "should return null when case does not exist",
    async () => {

        ComplianceModel.findOne
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

                "missing-case"
            );

        expect(
            result
        ).toBeNull();
    }
);

/* ============================================================ */
/* UPDATE NON EXISTENT CASE                                     */
/* ============================================================ */

test(
    "should return null when updating missing case",
    async () => {

        const leanMock =
            jest.fn()
                .mockResolvedValue(
                    null
                );

        ComplianceModel
            .findOneAndUpdate
            .mockReturnValue({

                lean:
                    leanMock
            });

        const result =

            await repository.updateById(

                "tenant-001",

                "missing-case",

                {
                    status:
                        "CLOSED"
                }
            );

        expect(
            result
        ).toBeNull();

        expect(
            ComplianceModel
                .findOneAndUpdate
        ).toHaveBeenCalledWith(

            expect.objectContaining({

                _id:
                    "missing-case",

                tenantId:
                    "tenant-001"
            }),

            expect.any(Object),

            expect.any(Object)
        );
    }
);


/* ============================================================ */
/* EMPTY SEARCH RESULTS                                         */
/* ============================================================ */

test(
    "should return empty search results",
    async () => {

        ComplianceModel.find
            .mockReturnValue({

                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                lean:
                    jest.fn()
                        .mockResolvedValue([])
            });

        ComplianceModel.countDocuments
            .mockResolvedValue(
                0
            );

        const result =

            await repository.search(

                "tenant-001",

                {}
            );

        expect(
            result.total
        ).toBe(
            0
        );

        expect(
            result.data
        ).toEqual(
            []
        );
    }
);


/* ============================================================ */
/* EXISTS FALSE                                                 */
/* ============================================================ */

test(
    "should return false when record does not exist",
    async () => {

        ComplianceModel.exists
            .mockResolvedValue(
                null
            );

        const result =

            await repository.exists(

                "tenant-001",

                {
                    transactionId:
                        "missing-txn"
                }
            );

        expect(
            result
        ).toBe(
            false
        );
    }
);


/* ============================================================ */
/* BULK UPDATE NO MATCHES                                       */
/* ============================================================ */

test(
    "should handle bulk update with no matching records",
    async () => {

        ComplianceModel.updateMany
            .mockResolvedValue({

                acknowledged:
                    true,

                matchedCount:
                    0,

                modifiedCount:
                    0
            });

        const result =

            await repository.bulkUpdate(

                "tenant-001",

                {
                    category:
                        "AML"
                },

                {
                    reviewer:
                        "admin"
                }
            );

        expect(
            result.acknowledged
        ).toBe(
            true
        );

        expect(
            result.matchedCount
        ).toBe(
            0
        );

        expect(
            result.modifiedCount
        ).toBe(
            0
        );
    }
);


/* ============================================================ */
/* DATABASE ERROR - FIND BY ID                                  */
/* ============================================================ */

test(
    "should propagate findById database errors",
    async () => {

        ComplianceModel.findOne
            .mockReturnValue({

                lean:
                    jest.fn()
                        .mockRejectedValue(

                            new Error(
                                "Database connection lost"
                            )
                        )
            });

        await expect(

            repository.findById(

                "tenant-001",

                "case123"
            )

        ).rejects.toThrow(
            "Database connection lost"
        );
    }
);

/* ============================================================ */
/* DATABASE ERROR - UPDATE                                      */
/* ============================================================ */

test(
    "should propagate update errors",
    async () => {

        ComplianceModel
            .findOneAndUpdate
            .mockImplementation(() => {

                throw new Error(
                    "Update failed"
                );
            });

        await expect(

            repository.updateById(

                "tenant-001",

                "case123",

                {

                    status:
                        "CLOSED"
                }
            )

        ).rejects.toThrow(
            "Update failed"
        );
    }
);

/* ============================================================ */
/* DATABASE ERROR - METRICS                                     */
/* ============================================================ */

test(
    "should propagate metrics errors",
    async () => {

        ComplianceModel
            .countDocuments
            .mockRejectedValue(

                new Error(
                    "Metrics query failure"
                )
            );

        await expect(

            repository.getComplianceMetrics(
                "tenant-001"
            )

        ).rejects.toThrow(
            "Metrics query failure"
        );
    }
);


/* ============================================================ */
/* DATABASE ERROR - BULK UPDATE                                 */
/* ============================================================ */

test(
    "should propagate bulk update errors",
    async () => {

        ComplianceModel
            .updateMany
            .mockRejectedValue(

                new Error(
                    "Bulk update failed"
                )
            );

        await expect(

            repository.bulkUpdate(

                "tenant-001",

                {},

                {
                    reviewer:
                        "admin"
                }
            )

        ).rejects.toThrow(
            "Bulk update failed"
        );
    }
);

/* ============================================================ */
/* INVALID INPUT - EMPTY PAYLOAD                                */
/* ============================================================ */

test(
    "should handle empty create payload",
    async () => {

        ComplianceModel.create
            .mockResolvedValue(
                {}
            );

        const result =

            await repository.create(
                {}
            );

        expect(
            result
        ).toEqual(
            {}
        );
    }
);

/* ============================================================ */
/* INVALID INPUT - NULL TENANT                                  */
/* ============================================================ */

test(
    "should handle null tenant id",
    async () => {

        ComplianceModel.findOne
            .mockReturnValue({

                lean:
                    jest.fn()
                        .mockResolvedValue(
                            null
                        )
            });

        const result =

            await repository.findById(

                null,

                "case123"
            );

        expect(
            result
        ).toBeNull();
    }
);

/* ============================================================ */
/* INVALID INPUT - CASE ID                                      */
/* ============================================================ */

test(
    "should handle undefined case id",
    async () => {

        ComplianceModel.findOne
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

                undefined
            );

        expect(
            result
        ).toBeNull();
    }
);

/* ============================================================ */
/* INVALID INPUT - EMPTY SEARCH                                 */
/* ============================================================ */

test(
    "should handle empty search filters",
    async () => {

        ComplianceModel.find
            .mockReturnValue({

                skip: jest.fn().mockReturnThis(),
                limit: jest.fn().mockReturnThis(),
                sort: jest.fn().mockReturnThis(),
                lean:
                    jest.fn()
                        .mockResolvedValue([])
            });

        ComplianceModel.countDocuments
            .mockResolvedValue(
                0
            );

        const result =

            await repository.search(

                "tenant-001",

                {}
            );

        expect(
            result.data
        ).toEqual(
            []
        );
    }
);

/* ============================================================ */
/* INVALID SESSION                                              */
/* ============================================================ */

test(
    "should fail createWithSession on invalid session",
    async () => {

        repository.model =
            jest.fn(() => ({

                save:
                    jest.fn()
                        .mockRejectedValue(

                            new Error(
                                "Invalid session"
                            )
                        )
            }));

        await expect(

            repository
                .createWithSession(

                    {

                        tenantId:
                            "tenant-001"
                    },

                    null
                )

        ).rejects.toThrow(
            "Invalid session"
        );
    }
);

/* ============================================================ */
/* INVALID EXISTS QUERY                                         */
/* ============================================================ */

test(
    "should handle invalid exists query",
    async () => {

        ComplianceModel.exists
            .mockResolvedValue(
                null
            );

        const result =

            await repository.exists(

                "tenant-001",

                null
            );

        expect(
            result
        ).toBe(
            false
        );
    }
);

/* ============================================================ */
/* INVALID FORMAT - MALFORMED OBJECT ID                         */
/* ============================================================ */

test(
    "should handle malformed object id",
    async () => {

        ComplianceModel.findOne
            .mockImplementation(() => {

                throw new Error(
                    "Cast to ObjectId failed"
                );
            });

        await expect(

            repository.findById(

                "tenant-001",

                "invalid-id-format"
            )

        ).rejects.toThrow(
            "Cast to ObjectId failed"
        );
    }
);

/* ============================================================ */
/* INVALID FORMAT - NON STRING TENANT ID                        */
/* ============================================================ */

test(
    "should handle numeric tenant id",
    async () => {

        ComplianceModel.findOne
            .mockReturnValue({

                lean:
                    jest.fn()
                        .mockResolvedValue(
                            null
                        )
            });

        const result =

            await repository.findById(

                12345,

                "case123"
            );

        expect(
            result
        ).toBeNull();
    }
);

/* ============================================================ */
/* INVALID FORMAT - INVALID FILTER OBJECT                       */
/* ============================================================ */

test(
    "should handle invalid search filter",
    async () => {

        ComplianceModel.find
            .mockImplementation(() => {

                throw new Error(
                    "Invalid query filter"
                );
            });

        await expect(

            repository.search(

                "tenant-001",

                "invalid-filter"
            )

        ).rejects.toThrow(
            "Invalid query filter"
        );
    }
);

/* ============================================================ */
/* DATABASE TIMEOUT - CREATE                                    */
/* ============================================================ */

test(
    "should handle create timeout",
    async () => {

        ComplianceModel.create
            .mockRejectedValue(

                Object.assign(

                    new Error(
                        "Connection timeout"
                    ),

                    {
                        code:
                            "ETIMEDOUT"
                    }
                )
            );

        await expect(

            repository.create({

                tenantId:
                    "tenant-001"
            })

        ).rejects.toThrow(
            "Connection timeout"
        );
    }
);

/* ============================================================ */
/* DATABASE TIMEOUT - FIND                                      */
/* ============================================================ */

test(
    "should handle find timeout",
    async () => {

        ComplianceModel.findOne
            .mockImplementation(() => {

                throw Object.assign(

                    new Error(
                        "Database timeout"
                    ),

                    {
                        code:
                            "ETIMEDOUT"
                    }
                );
            });

        await expect(

            repository.findById(

                "tenant-001",

                "case123"
            )

        ).rejects.toThrow(
            "Database timeout"
        );
    }
);

/* ============================================================ */
/* DATABASE TIMEOUT - BULK UPDATE                               */
/* ============================================================ */

test(
    "should handle bulk update timeout",
    async () => {

        ComplianceModel.updateMany
            .mockRejectedValue(

                Object.assign(

                    new Error(
                        "Update timeout"
                    ),

                    {
                        code:
                            "ETIMEDOUT"
                    }
                )
            );

        await expect(

            repository.bulkUpdate(

                "tenant-001",

                {},

                {
                    reviewer:
                        "admin"
                }
            )

        ).rejects.toThrow(
            "Update timeout"
        );
    }
);

/* ============================================================ */
/* NULL VALUE - CREATE RETURNS NULL                             */
/* ============================================================ */

test(
    "should handle null create result",
    async () => {

        ComplianceModel.create
            .mockResolvedValue(
                null
            );

        const result =

            await repository.create({

                tenantId:
                    "tenant-001"
            });

        expect(
            result
        ).toBeNull();
    }
);

/* ============================================================ */
/* NULL VALUE - UPDATE RETURNS NULL                             */
/* ============================================================ */

test(
    "should handle null update result",
    async () => {

        ComplianceModel
            .findOneAndUpdate
            .mockReturnValue({

                lean:
                    jest.fn()
                        .mockResolvedValue(
                            null
                        )
            });

        const result =

            await repository.updateById(

                "tenant-001",

                "case123",

                {

                    status:
                        "CLOSED"
                }
            );

        expect(
            result
        ).toBeNull();
    }
);

/* ============================================================ */
/* NULL VALUE - EXISTS RETURNS UNDEFINED                        */
/* ============================================================ */

test(
    "should handle undefined exists result",
    async () => {

        ComplianceModel.exists
            .mockResolvedValue(
                undefined
            );

        const result =

            await repository.exists(

                "tenant-001",

                {

                    transactionId:
                        "txn123"
                }
            );

        expect(
            result
        ).toBe(
            false
        );
    }
);

/* ============================================================ */
/* NULL VALUE - METRICS COUNTS                                  */
/* ============================================================ */
test(
    "should handle null metrics counts",
    async () => {

        ComplianceModel
            .countDocuments
            .mockResolvedValue(
                null
            );

        const metrics =

            await repository
                .getComplianceMetrics(

                    "tenant-001"
                );

        expect(
            metrics.totalCases
        ).toBeNull();

        expect(
            metrics.amlCases
        ).toBeNull();
    }
); 
}
);