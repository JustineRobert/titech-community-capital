'use strict';

/**
 * ============================================================================
 * LoanWorkflowService Unit Tests
 * ============================================================================
 */

jest.mock(
    '../../../backend/modules/loan/repositories/loanRepository'
);

jest.mock(
    '../../../backend/modules/loan/repositories/loanAuditRepository'
);

jest.mock(
    '../../../backend/modules/loan/repositories/loanScheduleRepository'
);

jest.mock(
    '../../../backend/modules/loan/services/creditScoringService'
);

jest.mock(
    '../../../backend/modules/risk/services/riskEngineService'
);

jest.mock(
    '../../../backend/modules/compliance/services/complianceService'
);

const LoanWorkflowService =
    require(
        '../../../backend/modules/loan/services/loanWorkflowService'
    );

const LoanRepository =
    require(
        '../../../backend/modules/loan/repositories/loanRepository'
    );

const LoanAuditRepository =
    require(
        '../../../backend/modules/loan/repositories/loanAuditRepository'
    );

const ScheduleRepository =
    require(
        '../../../backend/modules/loan/repositories/loanScheduleRepository'
    );

const CreditScoringService =
    require(
        '../../../backend/modules/loan/services/creditScoringService'
    );

const RiskEngineService =
    require(
        '../../../backend/modules/risk/services/riskEngineService'
    );

const ComplianceService =
    require(
        '../../../backend/modules/compliance/services/complianceService'
    );

describe(
    'LoanWorkflowService',
    () => {

        const tenantId =
            'tenant_001';

        const actor = {

            _id:
                'user_001',

            name:
                'Test User'
        };

        const loan = {

            _id:
                'loan_001',

            member:
                'member_001',

            amount:
                1000000,

            approvedAmount:
                1000000,

            outstandingBalance:
                1000000,

            totalRepayable:
                1200000,

            interestRate:
                12,

            term:
                12,

            status:
                'PENDING'
        };

        beforeEach(
            () => {

                jest.clearAllMocks();
            }
        );

        /* ===============================================================
           CREDIT DECISION
        =============================================================== */

        describe(
            'getCreditDecision',
            () => {

                test(
                    'returns credit decision',
                    async () => {

                        LoanRepository
                            .findById
                            .mockResolvedValue(
                                loan
                            );

                        CreditScoringService
                            .calculateScore
                            .mockResolvedValue({

                                score:
                                    750,

                                grade:
                                    'A',

                                autoApprove:
                                    true
                            });

                        RiskEngineService
                            .assessLoanApplication
                            .mockResolvedValue({

                                riskRating:
                                    'LOW'
                            });

                        const result =
                            await LoanWorkflowService
                                .getCreditDecision(
                                    tenantId,
                                    loan._id,
                                    actor
                                );