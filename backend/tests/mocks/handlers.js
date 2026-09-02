'use strict';

const { http, HttpResponse } = require('msw');

const API_PREFIX =
    '/api/v1';

const mockLoan = {

    _id:
        'loan_001',

    loanNumber:
        'LN-2026-0001',

    member:
        'member_001',

    principal:
        1000000,

    approvedAmount:
        1000000,

    outstandingBalance:
        850000,

    interestRate:
        12,

    term:
        12,

    status:
        'ACTIVE',

    tenantId:
        'tenant_001'
};

const handlers = [

    /* ===================================================================
       LOAN APPLICATIONS
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans`,
        async () => {

            return HttpResponse.json({

                success: true,

                message:
                    'Loan application submitted successfully',

                loan: {

                    ...mockLoan,

                    status:
                        'PENDING'
                }
            });
        }
    ),

    /* ===================================================================
       CREDIT DECISION
    =================================================================== */

    http.get(
        `${API_PREFIX}/loans/:loanId/credit-decision`,
        async () => {

            return HttpResponse.json({

                success: true,

                creditScore:
                    745,

                grade:
                    'A',

                riskBand:
                    'LOW',

                recommendation:
                    'APPROVE',

                autoApprove:
                    true
            });
        }
    ),

    /* ===================================================================
       APPROVALS
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/:loanId/approve`,
        async () => {

            return HttpResponse.json({

                success: true,

                status:
                    'APPROVED',

                loan: {

                    ...mockLoan,

                    status:
                        'APPROVED'
                }
            });
        }
    ),

    http.post(
        `${API_PREFIX}/loans/:loanId/reject`,
        async () => {

            return HttpResponse.json({

                success: true,

                status:
                    'REJECTED'
            });
        }
    ),

    http.post(
        `${API_PREFIX}/loans/:loanId/manual-review`,
        async () => {

            return HttpResponse.json({

                success: true,

                status:
                    'MANUAL_REVIEW',

                reviewDecision:
                    'PENDING_REVIEW'
            });
        }
    ),

    /* ===================================================================
       DISBURSEMENT
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/:loanId/disburse`,
        async () => {

            return HttpResponse.json({

                success: true,

                status:
                    'DISBURSED',

                reference:
                    'DIS-20260710'
            });
        }
    ),

    /* ===================================================================
       REPAYMENTS
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/:loanId/repay`,
        async () => {

            return HttpResponse.json({

                success: true,

                amountPaid:
                    150000,

                outstandingBalance:
                    700000,

                paymentReference:
                    'PAY-20260710'
            });
        }
    ),

    /* ===================================================================
       SCHEDULES
    =================================================================== */

    http.get(
        `${API_PREFIX}/loans/:loanId/schedule`,
        async () => {

            return HttpResponse.json({

                success: true,

                schedule: [

                    {

                        installmentNumber:
                            1,

                        dueDate:
                            '2026-08-01',

                        amount:
                            100000,

                        status:
                            'PENDING'
                    }
                ]
            });
        }
    ),

    http.get(
        `${API_PREFIX}/loans/:loanId/summary`,
        async () => {

            return HttpResponse.json({

                success: true,

                loan: mockLoan,

                repaymentProgress:
                    15,

                totalPaid:
                    150000
            });
        }
    ),

    /* ===================================================================
       DELINQUENCY
    =================================================================== */

    http.get(
        `${API_PREFIX}/loans/overdue`,
        async () => {

            return HttpResponse.json({

                count: 1,

                loans: [

                    {

                        ...mockLoan,

                        daysPastDue:
                            35,

                        parCategory:
                            'PAR_30'
                    }
                ]
            });
        }
    ),

    http.get(
        `${API_PREFIX}/loans/defaulted`,
        async () => {

            return HttpResponse.json({

                count: 1,

                loans: [

                    {

                        ...mockLoan,

                        status:
                            'DEFAULTED'
                    }
                ]
            });
        }
    ),

    /* ===================================================================
       PORTFOLIO METRICS
    =================================================================== */

    http.get(
        `${API_PREFIX}/reports/portfolio`,
        async () => {

            return HttpResponse.json({

                totalLoans:
                    120,

                portfolioHealthScore:
                    'GOOD',

                financialMetrics: {

                    totalPortfolioValue:
                        250000000,

                    averageLoanSize:
                        2083333
                }
            });
        }
    ),

    /* ===================================================================
       RISK METRICS
    =================================================================== */

    http.get(
        `${API_PREFIX}/reports/risk`,
        async () => {

            return HttpResponse.json({

                portfolioRiskRating:
                    'LOW',

                creditRisk: {

                    nplRatio:
                        2.5,

                    portfolioAtRisk:
                        4.1
                },

                operationalRisk: {

                    fraudRiskScore:
                        18
                }
            });
        }
    ),

    /* ===================================================================
       BOARD REPORT
    =================================================================== */

    http.get(
        `${API_PREFIX}/reports/board`,
        async () => {

            return HttpResponse.json({

                reportType:
                    'BOARD_PORTFOLIO_REPORT',

                generatedAt:
                    new Date()
                        .toISOString()
            });
        }
    ),

    /* ===================================================================
       FRAUD
    =================================================================== */

    http.get(
        `${API_PREFIX}/fraud/alerts`,
        async () => {

            return HttpResponse.json({

                alerts: [

                    {

                        id:
                            'fraud_001',

                        riskScore:
                            82,

                        severity:
                            'HIGH'
                    }
                ]
            });
        }
    ),

    /* ===================================================================
       COMPLIANCE
    =================================================================== */

    http.get(
        `${API_PREFIX}/compliance/alerts`,
        async () => {

            return HttpResponse.json({

                complianceScore:
                    94,

                complianceRating:
                    'EXCELLENT',

                alerts: []
            });
        }
    ),

    /* ===================================================================
       AUDIT
    =================================================================== */

    http.get(
        `${API_PREFIX}/loans/:loanId/audit`,
        async () => {

            return HttpResponse.json({

                summary: {

                    totalAuditEvents:
                        6
                },

                timeline: [

                    {

                        action:
                            'LOAN_CREATED',

                        timestamp:
                            new Date()
                                .toISOString()
                    }
                ]
            });
        }
    ),

    /* ===================================================================
       WRITE OFF
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/:loanId/writeoff`,
        async () => {

            return HttpResponse.json({

                success: true,

                status:
                    'WRITTEN_OFF'
            });
        }
    ),

    /* ===================================================================
       RECOVERY
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/:loanId/recover`,
        async () => {

            return HttpResponse.json({

                success: true,

                recoveryStatus:
                    'PARTIALLY_RECOVERED'
            });
        }
    ),

    /* ===================================================================
       RESTRUCTURE
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/:loanId/restructure`,
        async () => {

            return HttpResponse.json({

                success: true,

                status:
                    'RESTRUCTURED',

                restructureType:
                    'TERM_EXTENSION'
            });
        }
    ),

    /* ===================================================================
       BULK APPROVE
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/bulk-approve`,
        async () => {

            return HttpResponse.json({

                success: true,

                approvedCount:
                    25,

                failedCount:
                    0
            });
        }
    ),

    /* ===================================================================
       BULK REJECT
    =================================================================== */

    http.post(
        `${API_PREFIX}/loans/bulk-reject`,
        async () => {

            return HttpResponse.json({

                success: true,

                rejectedCount:
                    12,

                failedCount:
                    0
            });
        }
    ),

    /* ===================================================================
       EXPORTS
    =================================================================== */

    http.get(
        `${API_PREFIX}/loans/export`,
        async () => {

            return HttpResponse.json({

                success: true,

                exportSummary: {

                    totalRecords:
                        120,

                    exportType:
                        'JSON'
                },

                data: [
                    mockLoan
                ]
            });
        }
    )
];

module.exports = {
    handlers
};