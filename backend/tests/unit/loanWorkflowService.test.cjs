'use strict';

/**
 * ============================================================================
 * LoanWorkflowService Unit Tests
 * ============================================================================
 */

jest.mock(
    '../../modules/loan/repositories/loanRepository.js'
);

jest.mock(
    '../../modules/loan/repositories/loanAuditRepository.js'
);

jest.mock(
    '../../modules/loan/repositories/loanScheduleRepository.js'
);

jest.mock(
    '../../modules/loan/services/creditScoringService.js'
);

jest.mock(
    '../../modules/risk/services/riskEngineService.js'
);

jest.mock(
    '../../services/complianceService.js'
);

const LoanWorkflowService =
    require(
        '../../modules/loan/services/loanWorkflowService.js'
    );

const LoanRepository =
    require(
        '../../modules/loan/repositories/loanRepository.js'
    );

const LoanAuditRepository =
    require(
        '../../modules/loan/repositories/loanAuditRepository.js'
    );

const ScheduleRepository =
    require(
        '../../modules/loan/repositories/loanScheduleRepository.js'
    );

const CreditScoringService =
    require(
        '../../modules/loan/services/creditScoringService.js'
    );

const RiskEngineService =
    require(
        '../../modules/risk/services/riskEngineService.js'
    );

const ComplianceService =
    require(
        '../../services/complianceService.js'
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
                    });
            });
        });
