"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * File: tests/controllers/savingsController.test.js
 * Enterprise Savings Controller Tests
 * ============================================================================
 */

jest.mock(
    "../../backend/services/savingsService"
);

jest.mock(
    "../../backend/services/auditService"
);

jest.mock(
    "../../backend/services/metricsService"
);

jest.mock(
    "../../backend/services/auditService",
    () => ({
        log: jest.fn()
    })
);

jest.mock(
    "../../backend/services/metricsService",
    () => ({
        increment: jest.fn(),
        timing: jest.fn(),
        gauge: jest.fn()
    })
);

jest.mock(
    "../../backend/services/auditService",
    () => ({
        log: jest.fn()
    })
);

jest.mock(
    "../../backend/services/metricsService",
    () => ({
        increment: jest.fn(),
        timing: jest.fn(),
        gauge: jest.fn()
    })
);

const savingsController =
    require(
        "../../backend/controllers/savingsController"
    );

const savingsService =
    require(
        "../../backend/services/savingsService"
    );

const auditService =
    require(
        "../../backend/services/auditService"
    );

const metricsService =
    require(
        "../../backend/services/metricsService"
    );

const auditService =
    require(
        "../../backend/services/auditService"
    );

const metricsService =
    require(
        "../../backend/services/metricsService"
    );

const auditService =
    require(
        "../../backend/services/auditService"
    );

const metricsService =
    require(
        "../../backend/services/metricsService"
    );

describe(
    "SavingsController",
    () => {

        let req;
        let res;
        let next;

        beforeEach(
            () => {

                req = {

                    tenantId:
                        "tenant-001",

                    userId:
                        "user-001",

                    requestId:
                        "req-001",

                    correlationId:
                        "corr-001",

                    user: {
                        id:
                            "user-001"
                    },

                    params: {},

                    query: {},

                    body: {}
                };

                res = {

                    status:
                        jest.fn()
                            .mockReturnThis(),

                    json:
                        jest.fn()
                };

                next =
                    jest.fn();

                jest.clearAllMocks();
            }
        );

        /* ================================================================ */
        /* CREATE SAVINGS ACCOUNT                                           */
        /* ================================================================ */

        describe(
            "createSavingsAccount",
            () => {

                test(
                    "should create account",
                    async () => {

                        const account = {

                            id:
                                "acc-001",

                            memberId:
                                "mem-001"
                        };

                        savingsService
                            .createSavingsAccount
                            .mockResolvedValue(
                                account
                            );

                        req.body = {

                            memberId:
                                "mem-001",

                            accountType:
                                "ORDINARY"
                        };

                        await savingsController
                            .createSavingsAccount(

                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            201
                        );

                        expect(
                            res.json
                        ).toHaveBeenCalledWith({

                            success:
                                true,

                            data:
                                account
                        });
                    }
                );
            }
        );

        /* ================================================================ */
        /* GET ACCOUNT                                                      */
        /* ================================================================ */

        describe(
            "getSavingsAccount",
            () => {

                test(
                    "should return account",
                    async () => {

                        const account = {

                            id:
                                "acc-001"
                        };

                        savingsService
                            .getSavingsAccount
                            .mockResolvedValue(
                                account
                            );

                        req.params.accountId =
                            "acc-001";

                        await savingsController
                            .getSavingsAccount(

                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );
                    }
                );
            }
        );

        /* ================================================================ */
        /* DEPOSIT                                                          */
        /* ================================================================ */

        describe(
            "deposit",
            () => {

                test(
                    "should process deposit",
                    async () => {

                        const result = {

                            transactionId:
                                "txn001"
                        };

                        savingsService
                            .deposit
                            .mockResolvedValue(
                                result
                            );

                        req.body = {

                            amount:
                                50000
                        };

                        await savingsController
                            .deposit(
                                req,
                                res,
                                next
                            );

                        expect(
                            savingsService.deposit
                        ).toHaveBeenCalled();

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );
                    }
                );
            }
        );

        /* ================================================================ */
        /* WITHDRAW                                                         */
        /* ================================================================ */

        describe(
            "withdraw",
            () => {

                const withdrawalResult = {

                    transactionId:
                        "txn-002",

                    accountId:
                        "acc-001",

                    amount:
                        10000,

                    status:
                        "SUCCESS"
                };

                beforeEach(() => {

                    jest.clearAllMocks();

                    auditService.log.mockClear();

                    metricsService.increment.mockClear();
                });


                /* ======================================================== */
                /* SUCCESS SCENARIOS                                        */
                /* ======================================================== */

                test(
                    "should create withdrawal audit record",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        const auditSpy =
                            jest.spyOn(
                                savingsController,
                                "audit"
                            ).mockResolvedValue();

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                10000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            auditSpy
                        ).toHaveBeenCalledTimes(
                            1
                        );

                        expect(
                            auditSpy
                        ).toHaveBeenCalledWith(

                            req,

                            "SAVINGS_WITHDRAWAL",

                            withdrawalResult
                        );

                        auditSpy.mockRestore();
                    }
                );


                test(
                    "should not audit failed withdrawal",
                    async () => {

                        const error =
                            new Error(
                                "Insufficient funds."
                            );

                        const auditSpy =
                            jest.spyOn(
                                savingsController,
                                "audit"
                            ).mockResolvedValue();

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            auditSpy
                        ).not.toHaveBeenCalled();

                        auditSpy.mockRestore();
                    }
                );


                test(
                    "should increment withdrawal metrics",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                10000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            metricsService.increment
                        ).toHaveBeenCalledWith(
                            "titech.savings.withdrawal"
                        );
                    }
                );


                test(
                    "should not increment success metric when withdrawal fails",
                    async () => {

                        savingsService.withdraw.mockRejectedValue(
                            new Error(
                                "Database unavailable"
                            )
                        );

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            metricsService.increment
                        ).not.toHaveBeenCalledWith(
                            "titech.savings.withdrawal"
                        );
                    }
                );

                test(
                    "should process withdrawal successfully",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            memberId:
                                "mem-001",

                            amount:
                                10000,

                            reason:
                                "Emergency"
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            savingsService.withdraw
                        ).toHaveBeenCalledTimes(1);

                        expect(
                            savingsService.withdraw
                        ).toHaveBeenCalledWith(

                            expect.objectContaining({

                                tenantId:
                                    "tenant-001",

                                userId:
                                    "user-001",

                                accountId:
                                    "acc-001",

                                memberId:
                                    "mem-001",

                                amount:
                                    10000
                            })
                        );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(200);

                        expect(
                            res.json
                        ).toHaveBeenCalledWith({

                            success:
                                true,

                            data:
                                withdrawalResult
                        });
                    }
                );

                /* ======================================================== */
                /* TENANT ISOLATION                                         */
                /* ======================================================== */

                test(
                    "should maintain tenant isolation",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        req.tenantId =
                            "tenant-sacco-a";

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                5000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            savingsService.withdraw
                        ).toHaveBeenCalledWith(

                            expect.objectContaining({

                                tenantId:
                                    "tenant-sacco-a"
                            })
                        );
                    }
                );

                /* ======================================================== */
                /* REQUEST CONTEXT                                          */
                /* ======================================================== */

                test(
                    "should propagate request context",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        req.requestId =
                            "req-123";

                        req.correlationId =
                            "corr-123";

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                10000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        const payload =
                            savingsService.withdraw.mock.calls[0][0];

                        expect(
                            payload.tenantId
                        ).toBe("tenant-001");

                        expect(
                            payload.userId
                        ).toBe("user-001");
                    }
                );

                /* ======================================================== */
                /* AUDIT VALIDATION                                         */
                /* ======================================================== */

                test(
                    "should write audit record after successful withdrawal",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        const auditSpy =
                            jest.spyOn(
                                savingsController,
                                "audit"
                            ).mockResolvedValue();

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                1000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            auditSpy
                        ).toHaveBeenCalledWith(

                            req,

                            "SAVINGS_WITHDRAWAL",

                            withdrawalResult
                        );

                        auditSpy.mockRestore();
                    }
                );

                /* ======================================================== */
                /* METRICS VALIDATION                                       */
                /* ======================================================== */

                test(
                    "should increment withdrawal metrics",
                    async () => {

                        savingsService.withdraw.mockResolvedValue(
                            withdrawalResult
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                10000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            metricsService.increment
                        ).toHaveBeenCalledWith(
                            "titech.savings.withdrawal"
                        );
                    }
                );

                /* ======================================================== */
                /* BUSINESS ERRORS                                          */
                /* ======================================================== */

                test(
                    "should handle insufficient funds error",
                    async () => {

                        const error =
                            new Error(
                                "Insufficient funds."
                            );

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                99999999
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            next
                        ).toHaveBeenCalledWith(error);

                        expect(
                            res.json
                        ).not.toHaveBeenCalled();
                    }
                );

                test(
                    "should handle savings account not found",
                    async () => {

                        const error =
                            new Error(
                                "Savings account not found."
                            );

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        req.body = {

                            accountId:
                                "missing-account",

                            amount:
                                1000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            next
                        ).toHaveBeenCalledWith(error);
                    }
                );

                /* ======================================================== */
                /* AML ERRORS                                               */
                /* ======================================================== */

                test(
                    "should handle AML validation failures",
                    async () => {

                        const error =
                            new Error(
                                "AML validation failed."
                            );

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                25000000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            next
                        ).toHaveBeenCalledWith(error);
                    }
                );

                /* ======================================================== */
                /* FRAUD ERRORS                                             */
                /* ======================================================== */

                test(
                    "should handle fraud detection failures",
                    async () => {

                        const error =
                            new Error(
                                "Fraud validation failed."
                            );

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                7500000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            next
                        ).toHaveBeenCalledWith(error);
                    }
                );

                /* ======================================================== */
                /* INFRASTRUCTURE ERRORS                                    */
                /* ======================================================== */

                test(
                    "should handle database failures",
                    async () => {

                        const error =
                            new Error(
                                "Database unavailable"
                            );

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        req.body = {

                            accountId:
                                "acc-001",

                            amount:
                                1000
                        };

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            next
                        ).toHaveBeenCalledWith(error);
                    }
                );

                test(
                    "should not return success response on failure",
                    async () => {

                        const error =
                            new Error(
                                "Unexpected failure"
                            );

                        savingsService.withdraw.mockRejectedValue(
                            error
                        );

                        await savingsController.withdraw(
                            req,
                            res,
                            next
                        );

                        expect(
                            res.status
                        ).not.toHaveBeenCalledWith(200);

                        expect(
                            res.json
                        ).not.toHaveBeenCalled();
                    }
                );
            }
        );

        /* ================================================================ */
        /* BALANCE                                                          */
        /* ================================================================ */

        describe(
            "getBalance",
            () => {

                test(
                    "should return member balance",
                    async () => {

                        savingsService
                            .getMemberBalance
                            .mockResolvedValue(
                                100000
                            );

                        req.params.memberId =
                            "mem001";

                        await savingsController
                            .getBalance(
                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );

                        expect(
                            res.json
                        ).toHaveBeenCalledWith({

                            success:
                                true,

                            data: {

                                balance:
                                    100000
                            }
                        });
                    }
                );
            }
        );

        /* ================================================================ */
        /* MINI STATEMENT                                                   */
        /* ================================================================ */

        describe(
            "miniStatement",
            () => {

                test(
                    "should return mini statement",
                    async () => {

                        const transactions = [

                            {
                                id: "tx1"
                            },

                            {
                                id: "tx2"
                            }
                        ];

                        savingsService
                            .getMiniStatement
                            .mockResolvedValue(
                                transactions
                            );

                        req.params.memberId =
                            "mem001";

                        await savingsController
                            .miniStatement(
                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );
                    }
                );
            }
        );

        /* ================================================================ */
        /* STATEMENT                                                        */
        /* ================================================================ */

        describe(
            "statement",
            () => {

                test(
                    "should return statement",
                    async () => {

                        const statement =
                            [];

                        savingsService
                            .getStatement
                            .mockResolvedValue(
                                statement
                            );

                        req.params.memberId =
                            "mem001";

                        await savingsController
                            .statement(
                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );
                    }
                );
            }
        );

        /* ================================================================ */
        /* INTEREST                                                         */
        /* ================================================================ */

        describe(
            "calculateInterest",
            () => {

                test(
                    "should calculate interest",
                    async () => {

                        const result = {

                            amount:
                                12000
                        };

                        savingsService
                            .calculateInterest
                            .mockResolvedValue(
                                result
                            );

                        req.params.accountId =
                            "acc001";

                        await savingsController
                            .calculateInterest(
                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );

                        expect(
                            res.json
                        ).toHaveBeenCalledWith({

                            success:
                                true,

                            data:
                                result
                        });
                    }
                );
            }
        );

        /* ================================================================ */
        /* SUMMARY                                                          */
        /* ================================================================ */

        describe(
            "summary",
            () => {

                test(
                    "should return savings summary",
                    async () => {

                        const summary = {

                            totalSavings:
                                500000
                        };

                        savingsService
                            .getSavingsSummary
                            .mockResolvedValue(
                                summary
                            );

                        await savingsController
                            .summary(
                                req,
                                res,
                                next
                            );

                        expect(
                            res.status
                        ).toHaveBeenCalledWith(
                            200
                        );
                    }
                );
            }
        );

        /* ================================================================ */
        /* ERROR HANDLING                                                   */
        /* ================================================================ */

        describe(
            "error handling",
            () => {

                test(
                    "should call next when service throws",
                    async () => {

                        const error =
                            new Error(
                                "Service failure"
                            );

                        savingsService
                            .deposit
                            .mockRejectedValue(
                                error
                            );

                        await savingsController
                            .deposit(
                                req,
                                res,
                                next
                            );

                        expect(
                            next
                        ).toHaveBeenCalledWith(
                            error
                        );
                    }
                );
            }
        );

        /* ================================================================ */
        /* TENANT ISOLATION                                                 */
        /* ================================================================ */

        describe(
            "tenant isolation",
            () => {

                test(
                    "should pass tenantId to service",
                    async () => {

                        savingsService
                            .deposit
                            .mockResolvedValue(
                                {}
                            );

                        req.body = {

                            amount:
                                5000
                        };

                        await savingsController
                            .deposit(
                                req,
                                res,
                                next
                            );

                        expect(
                            savingsService.deposit
                        ).toHaveBeenCalledWith(

                            expect.objectContaining({

                                tenantId:
                                    "tenant-001"
                            })
                        );
                    }
                );
            }
        );
    }
);