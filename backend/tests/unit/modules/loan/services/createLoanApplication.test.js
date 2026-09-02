"use strict";

jest.mock(
    "../../../../../modules/loan/repositories/loanRepository"
);

jest.mock(
    "../../../../../modules/loan/repositories/loanAuditRepository"
);

jest.mock(
    "../../../../../modules/loan/services/creditScoringService"
);

jest.mock(
    "../../../../../modules/risk/services/riskEngineService"
);

jest.mock(
    "../../../../../utils/logger",
    () => ({
        info: jest.fn(),
        error: jest.fn()
    })
);

const mongoose =
    require("mongoose");

const LoanWorkflowService =
    require("../../../../../modules/loan/services/loanWorkflowService");

const LoanRepository =
    require("../../../../../modules/loan/repositories/loanRepository");

const LoanAuditRepository =
    require("../../../../../modules/loan/repositories/loanAuditRepository");

const CreditScoringService =
    require("../../../../../modules/loan/services/creditScoringService");

const RiskEngineService =
    require("../../../../../modules/risk/services/riskEngineService");

describe(
    "Loan Workflow Service - Create Loan Application",
    () => {

        let user;
        let payload;

        beforeEach(() => {

            jest.clearAllMocks();

            user = {
                _id:
                    new mongoose.Types.ObjectId(),

                firstName:
                    "Justine",

                tenantId:
                    "tenant1"
            };

            payload = {

                memberId:
                    user._id,

                groupId:
                    new mongoose.Types.ObjectId(),

                amount:
                    500000,

                interestRate:
                    12,

                repaymentPeriod:
                    12
            };
        });

        /**
         * =====================================================
         * SUCCESS PATH
         * =====================================================
         */

        test(
            "should create loan application successfully",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockResolvedValue({
                        score: 85
                    });

                RiskEngineService
                    .assessLoanRisk
                    .mockResolvedValue({

                        eligible: true,

                        riskLevel: "LOW"
                    });

                LoanRepository
                    .create
                    .mockResolvedValue({

                        _id:
                            "loan123",

                        status:
                            "PENDING"
                    });

                const result =
                    await LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        );

                expect(
                    LoanRepository.create
                ).toHaveBeenCalled();

                expect(
                    result.success
                ).toBe(true);

                expect(
                    result.loan
                ).toBeDefined();

            }
        );

        /**
         * =====================================================
         * VALIDATION TESTS
         * =====================================================
         */

        test(
            "should reject missing amount",
            async () => {

                delete payload.amount;

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow();

            }
        );

        test(
            "should reject invalid loan amount",
            async () => {

                payload.amount = 0;

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow();

            }
        );

        test(
            "should reject invalid repayment period",
            async () => {

                payload.repaymentPeriod = 0;

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow();

            }
        );

        /**
         * =====================================================
         * CREDIT SCORING
         * =====================================================
         */

        test(
            "should call credit scoring service",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockResolvedValue({
                        score: 80
                    });

                RiskEngineService
                    .assessLoanRisk
                    .mockResolvedValue({

                        eligible: true,

                        riskLevel: "LOW"
                    });

                LoanRepository
                    .create
                    .mockResolvedValue({
                        _id: "loan1"
                    });

                await LoanWorkflowService
                    .createLoanApplication(
                        user,
                        payload,
                        "tenant1"
                    );

                expect(

                    CreditScoringService
                        .calculateScore

                ).toHaveBeenCalled();

            }
        );

        test(
            "should handle scoring failure",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockRejectedValue(
                        new Error(
                            "Scoring failed"
                        )
                    );

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow(
                    "Scoring failed"
                );

            }
        );

        /**
         * =====================================================
         * RISK ENGINE
         * =====================================================
         */

        test(
            "should reject ineligible member",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockResolvedValue({
                        score: 25
                    });

                RiskEngineService
                    .assessLoanRisk
                    .mockResolvedValue({

                        eligible: false,

                        riskLevel:
                            "HIGH",

                        reason:
                            "Poor repayment history"
                    });

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow();

            }
        );

        test(
            "should create eligibility audit entry",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockResolvedValue({
                        score: 10
                    });

                RiskEngineService
                    .assessLoanRisk
                    .mockResolvedValue({

                        eligible: false,

                        riskLevel:
                            "HIGH",

                        reason:
                            "Fraud risk"
                    });

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow();

                expect(

                    LoanAuditRepository
                        .logEligibilityAssessment

                ).toHaveBeenCalled();

            }
        );

        /**
         * =====================================================
         * REPOSITORY TESTS
         * =====================================================
         */

        test(
            "should create loan repository record",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockResolvedValue({
                        score: 82
                    });

                RiskEngineService
                    .assessLoanRisk
                    .mockResolvedValue({

                        eligible: true,

                        riskLevel:
                            "LOW"
                    });

                LoanRepository
                    .create
                    .mockResolvedValue({
                        _id:
                            "loan123"
                    });

                await LoanWorkflowService
                    .createLoanApplication(
                        user,
                        payload,
                        "tenant1"
                    );

                expect(

                    LoanRepository.create

                ).toHaveBeenCalledTimes(
                    1
                );

            }
        );

        test(
            "should handle repository failure",
            async () => {

                CreditScoringService
                    .calculateScore
                    .mockResolvedValue({
                        score: 85
                    });

                RiskEngineService
                    .assessLoanRisk
                    .mockResolvedValue({

                        eligible: true,

                        riskLevel:
                            "LOW"
                    });

                LoanRepository
                    .create
                    .mockRejectedValue(
                        new Error(
                            "Database error"
                        )
                    );

                await expect(

                    LoanWorkflowService
                        .createLoanApplication(
                            user,
                            payload,
                            "tenant1"
                        )

                ).rejects.toThrow(
                    "Database error"
                );

            }
        );

        /**
 * =====================================================
 * AUDIT TRAIL
 * =====================================================
 */

test(
    "should create audit entry",
    async () => {

        CreditScoringService
            .calculateScore
            .mockResolvedValue({
                score: 80
            });

        RiskEngineService
            .assessLoanRisk
            .mockResolvedValue({

                eligible: true,

                riskLevel: "LOW"
            });

        LoanRepository
            .create
            .mockResolvedValue({
                _id: "loan1"
            });

        await LoanWorkflowService
            .createLoanApplication(
                user,
                payload,
                "tenant1"
            );

        expect(
            LoanAuditRepository
                .logApplicationCreated
        ).toHaveBeenCalled();

    }
);

test(
    "should continue if audit entry succeeds",
    async () => {

        CreditScoringService
            .calculateScore
            .mockResolvedValue({
                score: 90
            });

        RiskEngineService
            .assessLoanRisk
            .mockResolvedValue({

                eligible: true,

                riskLevel: "LOW"
            });

        LoanRepository
            .create
            .mockResolvedValue({
                _id: "loan999"
            });

        LoanAuditRepository
            .logApplicationCreated
            .mockResolvedValue(true);

        const result =
            await LoanWorkflowService
                .createLoanApplication(
                    user,
                    payload,
                    "tenant1"
                );

        expect(
            LoanAuditRepository
                .logApplicationCreated
        ).toHaveBeenCalledTimes(1);

        expect(
            result.success
        ).toBe(true);

        expect(
            result.loan
        ).toBeDefined();

    }
);

/**
 * =====================================================
 * TENANT SAFETY
 * =====================================================
 */

test(
    "should preserve tenant context",
    async () => {

        CreditScoringService
            .calculateScore
            .mockResolvedValue({
                score: 90
            });

        RiskEngineService
            .assessLoanRisk
            .mockResolvedValue({

                eligible: true,

                riskLevel: "LOW"
            });

        LoanRepository
            .create
            .mockResolvedValue({
                _id: "loan456"
            });

        await LoanWorkflowService
            .createLoanApplication(
                user,
                payload,
                "tenantABC"
            );

        expect(
            LoanRepository.create
        ).toHaveBeenCalledWith(

            expect.objectContaining({

                tenantId:
                    "tenantABC"
            })
        );

    }
);

}); // end describe