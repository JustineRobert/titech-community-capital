'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE LOAN WORKFLOW SERVICE
 * ============================================================================
 *
 * SACCO Core Banking Platform
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Multi-tenant loan lifecycle orchestration
 * - Loan application workflow
 * - Credit scoring orchestration
 * - Risk assessment orchestration
 * - Compliance gates
 * - Approval / rejection / manual review
 * - Loan disbursement orchestration
 * - Repayment orchestration
 * - Delinquency monitoring
 * - Portfolio risk reporting
 * - Fraud / compliance alert aggregation
 * - Audit trail orchestration
 * - Write-off management
 * - Recovery management
 * - Loan restructuring
 * - Bulk operations
 * - Export orchestration
 *
 * Architectural Rules
 * ----------------------------------------------------------------------------
 * 1. NO direct MongoDB access from this service.
 * 2. All persistence goes through repositories.
 * 3. tenantId is mandatory for tenant-scoped operations.
 * 4. Financial mutations must be auditable.
 * 5. Invalid lifecycle transitions are rejected.
 * 6. External risk/compliance services are treated as gates.
 * 7. The service orchestrates; repositories persist.
 * 8. Financial accounting should ultimately be delegated to the Ledger Engine.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * LoanRepository.update signature:
 *
 *   update(loanId, tenantId, updates)
 *
 * This service consistently uses that contract.
 * ============================================================================
 */

const crypto = require('crypto');

const logger =
    require('../../../utils/logger');

const LoanRepository =
    require('../repositories/loanRepository');

const LoanAuditRepository =
    require('../repositories/loanAuditRepository');

const ScheduleRepository =
    require('../repositories/loanScheduleRepository');

const CreditScoringService =
    require('./creditScoringService');

const RiskEngineService =
    require('../../risk/services/riskEngineService');

const ComplianceService =
    require('../../compliance/services/complianceService');

const {
    validateLoanApplication
} = require('../../../utils/validateInput');


/* ============================================================================
 * CONSTANTS
 * ========================================================================== */

const STATUS = Object.freeze({

    PENDING:
        'PENDING',

    MANUAL_REVIEW:
        'MANUAL_REVIEW',

    PENDING_CREDIT_COMMITTEE:
        'PENDING_CREDIT_COMMITTEE',

    APPROVED:
        'APPROVED',

    REJECTED:
        'REJECTED',

    DISBURSED:
        'DISBURSED',

    ACTIVE:
        'ACTIVE',

    OVERDUE:
        'OVERDUE',

    DEFAULTED:
        'DEFAULTED',

    RESTRUCTURED:
        'RESTRUCTURED',

    WRITTEN_OFF:
        'WRITTEN_OFF',

    RECOVERED:
        'RECOVERED',

    CLOSED:
        'CLOSED'
});


const ACTION = Object.freeze({

    APPLICATION_CREATED:
        'LOAN_APPLICATION_CREATED',

    APPROVED:
        'LOAN_APPROVED',

    REJECTED:
        'LOAN_REJECTED',

    MANUAL_REVIEW:
        'LOAN_MANUAL_REVIEW',

    DISBURSED:
        'LOAN_DISBURSED',

    REPAYMENT:
        'LOAN_REPAYMENT_RECORDED',

    WRITTEN_OFF:
        'LOAN_WRITTEN_OFF',

    RECOVERY:
        'LOAN_RECOVERY',

    RESTRUCTURED:
        'LOAN_RESTRUCTURED',

    BULK_APPROVED:
        'LOAN_BULK_APPROVED',

    BULK_REJECTED:
        'LOAN_BULK_REJECTED'
});


const APPROVABLE_STATUSES = Object.freeze([
    STATUS.PENDING,
    STATUS.MANUAL_REVIEW,
    STATUS.PENDING_CREDIT_COMMITTEE
]);


const REPAYABLE_STATUSES = Object.freeze([
    STATUS.DISBURSED,
    STATUS.ACTIVE,
    STATUS.OVERDUE,
    STATUS.RESTRUCTURED,
    STATUS.DEFAULTED
]);


const RESTRUCTURABLE_STATUSES = Object.freeze([
    STATUS.ACTIVE,
    STATUS.OVERDUE,
    STATUS.DEFAULTED
]);


const WRITE_OFF_STATUSES = Object.freeze([
    STATUS.DEFAULTED,
    STATUS.OVERDUE
]);


const RECOVERY_STATUSES = Object.freeze([
    STATUS.WRITTEN_OFF,
    STATUS.DEFAULTED
]);


/* ============================================================================
 * SERVICE
 * ========================================================================== */

class LoanWorkflowService {


    /* ========================================================================
     * INTERNAL VALIDATION HELPERS
     * ====================================================================== */

    static assertTenant(
        tenantId
    ) {

        if (
            tenantId === undefined ||
            tenantId === null ||
            tenantId === ''
        ) {

            throw new Error(
                'tenantId is required'
            );
        }

        return tenantId;
    }


    static assertLoanId(
        loanId
    ) {

        if (
            loanId === undefined ||
            loanId === null ||
            loanId === ''
        ) {

            throw new Error(
                'loanId is required'
            );
        }

        return loanId;
    }


    static getActorId(
        actor
    ) {

        return (
            actor?._id ||
            actor?.id ||
            null
        );
    }


    static getActorName(
        actor
    ) {

        return (
            actor?.name ||
            actor?.fullName ||
            actor?.username ||
            null
        );
    }


    static normalizeAmount(
        value,
        fieldName = 'amount'
    ) {

        const amount =
            Number(value);

        if (
            !Number.isFinite(amount) ||
            amount <= 0
        ) {

            throw new Error(
                `${fieldName} must be a positive number`
            );
        }

        return Number(
            amount.toFixed(2)
        );
    }


    static normalizeDate(
        value,
        fieldName = 'date'
    ) {

        if (!value) {

            return new Date();
        }

        const date =
            value instanceof Date
                ? value
                : new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {

            throw new Error(
                `Invalid ${fieldName}`
            );
        }

        return date;
    }


    static generateReference(
        prefix
    ) {

        return `${prefix}-${Date.now()}-${crypto
            .randomBytes(4)
            .toString('hex')
            .toUpperCase()}`;
    }


    static roundMoney(
        value
    ) {

        return Number(
            Number(value || 0)
                .toFixed(2)
        );
    }


    static async getLoanOrThrow(
        loanId,
        tenantId
    ) {

        this.assertLoanId(loanId);
        this.assertTenant(tenantId);

        const loan =
            await LoanRepository.findById(
                loanId,
                tenantId
            );

        if (!loan) {

            throw new Error(
                'Loan not found'
            );
        }

        return loan;
    }


    static assertStatus(
        loan,
        allowedStatuses
    ) {

        if (
            !allowedStatuses.includes(
                loan.status
            )
        ) {

            throw new Error(
                `Loan cannot proceed from status ${loan.status}`
            );
        }
    }


    static async audit(
        {
            tenantId,
            loanId,
            action,
            actor,
            metadata = {},
            source = 'LOAN_WORKFLOW'
        }
    ) {

        try {

            return await LoanAuditRepository.create({

                tenantId,

                loanId,

                action,

                actor:
                    this.getActorId(actor),

                actorName:
                    this.getActorName(actor),

                source,

                metadata,

                createdAt:
                    new Date()
            });

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Audit persistence failed',
                {
                    tenantId,
                    loanId,
                    action,
                    error:
                        error.message
                }
            );

            /*
             * Audit failures are intentionally surfaced.
             *
             * A financial workflow should not silently succeed
             * when its audit trail cannot be persisted.
             */

            throw error;
        }
    }


    static async runComplianceGate(
        method,
        ...args
    ) {

        if (
            !ComplianceService ||
            typeof ComplianceService[method] !==
                'function'
        ) {

            return {
                passed: true,
                skipped: true
            };
        }

        const result =
            await ComplianceService[method](
                ...args
            );

        if (
            result &&
            result.passed === false
        ) {

            throw new Error(
                result.message ||
                `Compliance validation failed: ${method}`
            );
        }

        return (
            result || {
                passed: true
            }
        );
    }


    static async runRiskAssessment(
        method,
        ...args
    ) {

        if (
            !RiskEngineService ||
            typeof RiskEngineService[method] !==
                'function'
        ) {

            return null;
        }

        return RiskEngineService[method](
            ...args
        );
    }


    /* ========================================================================
     * APPLICATION
     * ====================================================================== */

    static async createLoanApplication(
        user,
        payload,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            validateLoanApplication(
                payload
            );

            if (
                !payload ||
                !payload.memberId
            ) {

                throw new Error(
                    'memberId is required'
                );
            }

            if (
                !payload.amount ||
                Number(payload.amount) <= 0
            ) {

                throw new Error(
                    'Loan amount must be greater than zero'
                );
            }

            logger.info(
                '[LoanWorkflow] Creating loan application',
                {
                    tenantId,
                    memberId:
                        payload.memberId,
                    amount:
                        payload.amount
                }
            );


            const fraudAssessment =
                await this.runRiskAssessment(
                    'assessLoanApplication',
                    payload,
                    tenantId
                );


            if (
                fraudAssessment?.blockApplication === true
            ) {

                throw new Error(
                    fraudAssessment.reason ||
                    'Loan application blocked by risk engine'
                );
            }


            const complianceCheck =
                await this.runComplianceGate(
                    'validateLoanApplication',
                    payload,
                    tenantId
                );


            let creditDecision =
                null;

            if (
                CreditScoringService &&
                typeof CreditScoringService.calculateScore ===
                    'function'
            ) {

                creditDecision =
                    await CreditScoringService.calculateScore(
                        payload.memberId,
                        payload
                    );
            }


            const score =
                Number(
                    creditDecision?.score ??
                    creditDecision?.creditScore ??
                    0
                );


            let decision =
                STATUS.PENDING;


            if (
                creditDecision?.autoApprove === true
            ) {

                decision =
                    STATUS.APPROVED;

            } else if (
                creditDecision?.manualReview === true
            ) {

                decision =
                    STATUS.MANUAL_REVIEW;
            }


            const now =
                new Date();


            const loanData = {

                ...payload,

                tenantId,

                status:
                    decision,

                creditScore:
                    score || undefined,

                riskRating:
                    fraudAssessment?.riskRating ||
                    'LOW',

                riskAssessment:
                    fraudAssessment || undefined,

                complianceAssessment:
                    complianceCheck || undefined,

                applicationDate:
                    now,

                createdBy:
                    this.getActorId(user)
            };


            const loan =
                await LoanRepository.create(
                    loanData
                );


            await this.audit({

                tenantId,

                loanId:
                    loan._id,

                action:
                    ACTION.APPLICATION_CREATED,

                actor:
                    user,

                metadata: {

                    amount:
                        payload.amount,

                    decision,

                    creditScore:
                        score,

                    riskRating:
                        fraudAssessment?.riskRating,

                    riskAssessment:
                        fraudAssessment,

                    compliancePassed:
                        complianceCheck?.passed !== false
                }
            });


            return {

                success: true,

                message:
                    'Loan application submitted successfully',

                loan,

                workflow: {

                    decision,

                    creditScore:
                        score,

                    riskRating:
                        fraudAssessment?.riskRating ||
                        'LOW',

                    compliance:
                        complianceCheck,

                    riskAssessment:
                        fraudAssessment
                }
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Failed to create loan application',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * APPROVAL
     * ====================================================================== */

    static async approveLoan(
        loanId,
        payload = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                APPROVABLE_STATUSES
            );


            await this.runComplianceGate(
                'validateLoanApproval',
                loan,
                tenantId
            );


            const approvedAmount =
                payload.approvedAmount !== undefined
                    ? this.normalizeAmount(
                        payload.approvedAmount,
                        'approvedAmount'
                    )
                    : this.roundMoney(
                        loan.approvedAmount ||
                        loan.amount
                    );


            if (
                approvedAmount >
                Number(loan.amount || approvedAmount)
            ) {

                throw new Error(
                    'Approved amount cannot exceed requested loan amount'
                );
            }


            const approvedAt =
                new Date();


            const approvalData = {

                status:
                    STATUS.APPROVED,

                approvedAt,

                approvedBy:
                    this.getActorId(actor),

                approvedByName:
                    this.getActorName(actor),

                approvalNotes:
                    payload.notes,

                approvalReference:
                    payload.reference ||
                    this.generateReference('APR'),

                committeeResolution:
                    payload.committeeResolution,

                finalApprovedAmount:
                    approvedAmount,

                approvedAmount
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    approvalData
                );


            if (!updatedLoan) {

                throw new Error(
                    'Loan approval update failed'
                );
            }


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.APPROVED,

                actor,

                metadata:
                    approvalData
            });


            logger.info(
                '[LoanWorkflow] Loan approved',
                {
                    tenantId,
                    loanId,
                    approvedAmount
                }
            );


            return {

                success: true,

                loan:
                    updatedLoan,

                status:
                    STATUS.APPROVED,

                approvedAmount,

                approvedAt
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Approval failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * REJECTION
     * ====================================================================== */

    static async rejectLoan(
        loanId,
        payload = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                APPROVABLE_STATUSES
            );


            if (
                !payload.reason
            ) {

                throw new Error(
                    'Rejection reason is required'
                );
            }


            const rejectionData = {

                status:
                    STATUS.REJECTED,

                rejectedAt:
                    new Date(),

                rejectedBy:
                    this.getActorId(actor),

                rejectedByName:
                    this.getActorName(actor),

                rejectionReason:
                    payload.reason,

                rejectionCode:
                    payload.code
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    rejectionData
                );


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.REJECTED,

                actor,

                metadata:
                    rejectionData
            });


            return {

                success: true,

                loan:
                    updatedLoan,

                status:
                    STATUS.REJECTED
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Rejection failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * MANUAL REVIEW
     * ====================================================================== */

    static async manualReviewLoan(
        loanId,
        reviewData = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                [
                    STATUS.PENDING,
                    STATUS.MANUAL_REVIEW,
                    STATUS.PENDING_CREDIT_COMMITTEE
                ]
            );


            const decision =
                String(
                    reviewData.decision ||
                    'PENDING_REVIEW'
                ).toUpperCase();


            let status =
                STATUS.MANUAL_REVIEW;


            if (
                decision === 'APPROVE'
            ) {

                status =
                    STATUS.APPROVED;

            } else if (
                decision === 'REJECT'
            ) {

                status =
                    STATUS.REJECTED;
            }


            const now =
                new Date();


            const updateData = {

                status,

                reviewedAt:
                    now,

                reviewedBy:
                    this.getActorId(actor),

                reviewedByName:
                    this.getActorName(actor),

                reviewNotes:
                    reviewData.notes,

                reviewReason:
                    reviewData.reason,

                riskAssessment:
                    reviewData.riskAssessment,

                recommendation:
                    reviewData.recommendation,

                escalationRequired:
                    Boolean(
                        reviewData.escalationRequired
                    ),

                escalatedTo:
                    reviewData.escalatedTo,

                committeeDecision:
                    reviewData.committeeDecision
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    updateData
                );


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.MANUAL_REVIEW,

                actor,

                metadata: {

                    decision,

                    ...updateData
                }
            });


            return {

                success: true,

                loan:
                    updatedLoan,

                status,

                reviewDecision:
                    decision
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Manual review failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * DISBURSEMENT
     * ====================================================================== */

    static async disburseLoan(
        loanId,
        payload = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                [STATUS.APPROVED]
            );


            if (
                loan.disbursedAt
            ) {

                throw new Error(
                    'Loan has already been disbursed'
                );
            }


            await this.runComplianceGate(
                'validateLoanDisbursement',
                loan,
                tenantId
            );


            const fraudAssessment =
                await this.runRiskAssessment(
                    'assessLoanApplication',
                    loan,
                    tenantId
                );


            if (
                fraudAssessment?.blockDisbursement === true
            ) {

                throw new Error(
                    fraudAssessment.reason ||
                    'Disbursement blocked by fraud engine'
                );
            }


            const disbursementAmount =
                payload.amount !== undefined

                    ? this.normalizeAmount(
                        payload.amount,
                        'disbursement amount'
                    )

                    : this.normalizeAmount(
                        loan.approvedAmount ||
                        loan.finalApprovedAmount ||
                        loan.amount,
                        'disbursement amount'
                    );


            const maximumApproved =
                Number(
                    loan.approvedAmount ||
                    loan.finalApprovedAmount ||
                    loan.amount ||
                    0
                );


            if (
                disbursementAmount >
                maximumApproved
            ) {

                throw new Error(
                    'Disbursement amount exceeds approved amount'
                );
            }


            const disbursementReference =
                payload.reference ||
                this.generateReference('DIS');


            const disbursedAt =
                new Date();


            const disbursementData = {

                status:
                    STATUS.DISBURSED,

                disbursedAt,

                disbursedBy:
                    this.getActorId(actor),

                disbursedByName:
                    this.getActorName(actor),

                disbursementReference,

                disbursementChannel:
                    payload.channel ||
                    'INTERNAL',

                disbursementAccount:
                    payload.accountNumber,

                disbursementAmount,

                transactionReference:
                    payload.transactionReference,

                valueDate:
                    this.normalizeDate(
                        payload.valueDate,
                        'valueDate'
                    )
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    disbursementData
                );


            if (!updatedLoan) {

                throw new Error(
                    'Loan disbursement update failed'
                );
            }


            /*
             * Schedule generation is performed only after
             * the loan has successfully entered DISBURSED state.
             */

            if (
                ScheduleRepository &&
                typeof ScheduleRepository.generateSchedule ===
                    'function'
            ) {

                await ScheduleRepository.generateSchedule(
                    loanId,
                    tenantId
                );
            }


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.DISBURSED,

                actor,

                metadata: {

                    reference:
                        disbursementReference,

                    amount:
                        disbursementAmount,

                    channel:
                        disbursementData.disbursementChannel,

                    transactionReference:
                        disbursementData.transactionReference,

                    riskAssessment:
                        fraudAssessment
                }
            });


            logger.info(
                '[LoanWorkflow] Loan disbursed successfully',
                {
                    tenantId,
                    loanId,
                    reference:
                        disbursementReference,
                    amount:
                        disbursementAmount
                }
            );


            return {

                success: true,

                loan:
                    updatedLoan,

                status:
                    STATUS.DISBURSED,

                reference:
                    disbursementReference,

                amount:
                    disbursementAmount,

                disbursedAt
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Loan disbursement failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * REPAYMENT
     * ====================================================================== */

    static async recordRepayment(
        loanId,
        repaymentData = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                REPAYABLE_STATUSES
            );


            const amount =
                this.normalizeAmount(
                    repaymentData.amount,
                    'repayment amount'
                );


            const outstandingBalance =
                this.roundMoney(
                    loan.outstandingBalance ??
                    loan.totalRepayable ??
                    0
                );


            if (
                outstandingBalance <= 0
            ) {

                throw new Error(
                    'Loan has no outstanding balance'
                );
            }


            if (
                amount >
                outstandingBalance
            ) {

                throw new Error(
                    'Repayment amount exceeds outstanding balance'
                );
            }


            const newBalance =
                this.roundMoney(
                    Math.max(
                        outstandingBalance -
                        amount,
                        0
                    )
                );


            let loanStatus =
                loan.status;


            if (
                newBalance === 0
            ) {

                loanStatus =
                    STATUS.CLOSED;

            } else if (
                loan.status ===
                STATUS.OVERDUE
            ) {

                loanStatus =
                    STATUS.ACTIVE;
            }


            const paymentReference =
                repaymentData.reference ||
                this.generateReference('PAY');


            const paymentDate =
                this.normalizeDate(
                    repaymentData.paymentDate,
                    'paymentDate'
                );


            /*
             * Repository-level repayment history support.
             * This is optional to preserve compatibility with
             * existing repositories.
             */

            const repaymentRecord = {

                amount,

                paymentDate,

                reference:
                    paymentReference,

                paymentChannel:
                    repaymentData.channel ||
                    'CASH',

                transactionReference:
                    repaymentData.transactionReference,

                receivedBy:
                    this.getActorId(actor),

                notes:
                    repaymentData.notes
            };


            if (
                typeof LoanRepository.recordRepayment ===
                    'function'
            ) {

                await LoanRepository.recordRepayment(
                    loanId,
                    repaymentRecord,
                    tenantId
                );
            }


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    {

                        outstandingBalance:
                            newBalance,

                        lastRepaymentDate:
                            paymentDate,

                        lastRepaymentAmount:
                            amount,

                        repaymentCount:
                            Number(
                                loan.repaymentCount || 0
                            ) + 1,

                        status:
                            loanStatus
                    }
                );


            if (
                !updatedLoan
            ) {

                throw new Error(
                    'Repayment update failed'
                );
            }


            if (
                ScheduleRepository &&
                typeof ScheduleRepository.applyRepayment ===
                    'function'
            ) {

                await ScheduleRepository.applyRepayment(
                    loanId,
                    amount,
                    tenantId
                );
            }


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.REPAYMENT,

                actor,

                metadata: {

                    amount,

                    balanceBefore:
                        outstandingBalance,

                    balanceAfter:
                        newBalance,

                    paymentReference,

                    paymentDate,

                    channel:
                        repaymentRecord.paymentChannel,

                    transactionReference:
                        repaymentRecord.transactionReference
                }
            });


            logger.info(
                '[LoanWorkflow] Repayment recorded',
                {
                    tenantId,
                    loanId,
                    amount,
                    balance:
                        newBalance
                }
            );


            return {

                success: true,

                loan:
                    updatedLoan,

                paymentReference,

                amountPaid:
                    amount,

                outstandingBalance:
                    newBalance,

                status:
                    loanStatus
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Repayment failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    static async repayLoan(
        loanId,
        repaymentData,
        actor,
        tenantId
    ) {

        return this.recordRepayment(
            loanId,
            repaymentData,
            actor,
            tenantId
        );
    }


    /* ========================================================================
     * SCHEDULES
     * ====================================================================== */

    static async getLoanSchedule(
        loanId,
        tenantId
    ) {

        const loan =
            await this.getLoanOrThrow(
                loanId,
                tenantId
            );


        if (
            !ScheduleRepository ||
            typeof ScheduleRepository.findByLoan !==
                'function'
        ) {

            throw new Error(
                'Loan schedule service is unavailable'
            );
        }


        return ScheduleRepository.findByLoan(
            loan._id,
            tenantId
        );
    }


    /* ========================================================================
     * LOAN SUMMARY
     * ====================================================================== */

    static async getLoanSummary(
        loanId,
        user,
        tenantId
    ) {

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            const [
                schedule,
                auditTrail
            ] = await Promise.all([

                ScheduleRepository.findByLoan(
                    loanId,
                    tenantId
                ),

                LoanAuditRepository.findByLoan(
                    loanId,
                    tenantId
                )
            ]);


            const scheduleItems =
                Array.isArray(schedule)
                    ? schedule
                    : [];


            const auditItems =
                Array.isArray(auditTrail)
                    ? auditTrail
                    : [];


            const totalInstallments =
                scheduleItems.length;


            const paidInstallments =
                scheduleItems.filter(
                    item =>
                        item.status === 'PAID'
                ).length;


            const overdueInstallments =
                scheduleItems.filter(
                    item =>
                        item.status === 'OVERDUE'
                ).length;


            const upcomingInstallment =
                scheduleItems.find(
                    item =>
                        [
                            'PENDING',
                            'DUE'
                        ].includes(
                            item.status
                        )
                ) || null;


            const totalPaid =
                this.roundMoney(
                    scheduleItems.reduce(
                        (
                            total,
                            installment
                        ) =>
                            total +
                            Number(
                                installment.amountPaid || 0
                            ),
                        0
                    )
                );


            const totalRepayable =
                Number(
                    loan.totalRepayable || 0
                );


            const totalOutstanding =
                this.roundMoney(
                    loan.outstandingBalance ??
                    Math.max(
                        totalRepayable -
                        totalPaid,
                        0
                    )
                );


            const repaymentProgress =
                totalRepayable > 0

                    ? Number(
                        (
                            (
                                totalPaid /
                                totalRepayable
                            ) * 100
                        ).toFixed(2)
                    )

                    : 0;


            const portfolioCategory =

                totalOutstanding <= 0

                    ? 'CLOSED'

                    : overdueInstallments > 0

                        ? 'AT_RISK'

                        : 'PERFORMING';


            let creditDecision =
                null;


            try {

                if (
                    CreditScoringService &&
                    typeof CreditScoringService.calculateScore ===
                        'function'
                ) {

                    creditDecision =
                        await CreditScoringService.calculateScore(
                            loan.member,
                            loan
                        );
                }

            } catch (error) {

                logger.warn(
                    '[LoanWorkflow] Credit score unavailable',
                    {
                        tenantId,
                        loanId,
                        error:
                            error.message
                    }
                );
            }


            return {

                loanId:
                    loan._id,

                loanNumber:
                    loan.loanNumber,

                tenantId,

                member:
                    loan.member,

                product:
                    loan.loanProduct,

                status:
                    loan.status,

                principal:
                    loan.principal,

                approvedAmount:
                    loan.approvedAmount,

                interestRate:
                    loan.interestRate,

                term:
                    loan.term,

                disbursedAt:
                    loan.disbursedAt,

                maturityDate:
                    loan.maturityDate,

                totalRepayable,

                totalPaid,

                outstandingBalance:
                    totalOutstanding,

                repaymentProgress,

                scheduleMetrics: {

                    totalInstallments,

                    paidInstallments,

                    overdueInstallments,

                    remainingInstallments:
                        Math.max(
                            totalInstallments -
                            paidInstallments,
                            0
                        )
                },

                nextInstallment:
                    upcomingInstallment,

                creditInformation:
                    creditDecision,

                auditMetrics: {

                    totalAuditRecords:
                        auditItems.length,

                    latestActivity:
                        auditItems.length
                            ? auditItems[
                                auditItems.length - 1
                            ]
                            : null
                },

                riskClassification:
                    portfolioCategory,

                generatedAt:
                    new Date().toISOString(),

                generatedFor:
                    this.getActorId(user)
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Summary generation failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * DELINQUENCY
     * ====================================================================== */

    static async getOverdueLoans(
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loans =
                await LoanRepository.getOverdueLoans(
                    tenantId
                );


            const enhancedLoans =
                (loans || []).map(
                    loan => {

                        const daysPastDue =
                            Number(
                                loan.daysPastDue || 0
                            );


                        let parCategory =
                            'PAR_0';


                        if (
                            daysPastDue >= 90
                        ) {

                            parCategory =
                                'PAR_90';

                        } else if (
                            daysPastDue >= 60
                        ) {

                            parCategory =
                                'PAR_60';

                        } else if (
                            daysPastDue >= 30
                        ) {

                            parCategory =
                                'PAR_30';
                        }


                        return {

                            ...loan,

                            daysPastDue,

                            parCategory,

                            collectionPriority:

                                daysPastDue >= 90
                                    ? 'CRITICAL'

                                    : daysPastDue >= 60
                                        ? 'HIGH'

                                        : daysPastDue >= 30
                                            ? 'MEDIUM'
                                            : 'LOW',

                            riskClassification:

                                daysPastDue >= 90
                                    ? 'SEVERE'

                                    : daysPastDue >= 60
                                        ? 'HIGH'
                                        : 'MODERATE'
                        };
                    }
                );


            return {

                count:
                    enhancedLoans.length,

                loans:
                    enhancedLoans,

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Failed to retrieve overdue loans',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    static async getDefaultedLoans(
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loans =
                await LoanRepository.getDefaultedLoans(
                    tenantId
                );


            const enhancedLoans =
                (loans || []).map(
                    loan => ({

                        ...loan,

                        collectionStatus:
                            loan.collectionStatus ||
                            'RECOVERY_REQUIRED',

                        recoveryStage:
                            loan.recoveryStage ||
                            'PRE_LEGAL',

                        writeOffEligible:
                            Number(
                                loan.daysPastDue || 0
                            ) >= 180,

                        riskClassification:
                            'DEFAULTED'
                    })
                );


            const totalOutstanding =
                this.roundMoney(
                    enhancedLoans.reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            return {

                count:
                    enhancedLoans.length,

                totalOutstanding,

                loans:
                    enhancedLoans,

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Failed to retrieve defaulted loans',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * PORTFOLIO METRICS
     * ====================================================================== */

    static async getPortfolioMetrics(
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const [
                par30,
                par60,
                par90,
                averageLoanSize,
                loanBook,
                overdueLoans,
                defaultedLoans
            ] = await Promise.all([

                LoanRepository.calculatePAR30(
                    tenantId
                ),

                LoanRepository.calculatePAR60(
                    tenantId
                ),

                LoanRepository.calculatePAR90(
                    tenantId
                ),

                LoanRepository.getAverageLoanSize(
                    tenantId
                ),

                LoanRepository.getLoanBookSummary(
                    tenantId
                ),

                LoanRepository.getOverdueLoans(
                    tenantId
                ),

                LoanRepository.getDefaultedLoans(
                    tenantId
                )
            ]);


            const overdueExposure =
                this.roundMoney(
                    (overdueLoans || []).reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            const defaultExposure =
                this.roundMoney(
                    (defaultedLoans || []).reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            const totalLoans =
                Number(
                    loanBook.totalLoans || 0
                );


            const portfolioHealth =

                par30 <= 5
                    ? 'EXCELLENT'

                    : par30 <= 10
                        ? 'GOOD'

                        : par30 <= 15
                            ? 'WATCH'

                            : par30 <= 25
                                ? 'HIGH_RISK'
                                : 'CRITICAL';


            return {

                tenantId,

                totalLoans,

                totalPortfolioValue:
                    this.roundMoney(
                        loanBook.totalAmount
                    ),

                outstandingBalance:
                    this.roundMoney(
                        loanBook.outstandingBalance
                    ),

                repaidAmount:
                    this.roundMoney(
                        loanBook.repaidAmount
                    ),

                averageLoanSize:
                    this.roundMoney(
                        averageLoanSize
                    ),

                par30,
                par60,
                par90,

                overdueExposure,

                defaultExposure,

                overdueLoanCount:
                    (overdueLoans || []).length,

                defaultedLoanCount:
                    (defaultedLoans || []).length,

                portfolioHealth,

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Portfolio metrics failed',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * RISK METRICS
     * ====================================================================== */

    static async getRiskMetrics(
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const [
                nplRatio,
                collectionRatio,
                recoveryRate,
                writeOffRate,
                averageDaysPastDue,
                portfolioAtRisk,
                overdueLoans,
                defaultedLoans,
                fraudRiskScore
            ] = await Promise.all([

                LoanRepository.calculateNPLRatio(
                    tenantId
                ),

                LoanRepository.calculateCollectionRatio(
                    tenantId
                ),

                LoanRepository.calculateRecoveryRate(
                    tenantId
                ),

                LoanRepository.calculateWriteOffRate(
                    tenantId
                ),

                LoanRepository.calculateAverageDaysPastDue(
                    tenantId
                ),

                LoanRepository.calculatePortfolioAtRisk(
                    tenantId
                ),

                LoanRepository.getOverdueLoans(
                    tenantId
                ),

                LoanRepository.getDefaultedLoans(
                    tenantId
                ),

                typeof RiskEngineService?.calculateFraudRiskScore ===
                    'function'

                    ? RiskEngineService.calculateFraudRiskScore(
                        tenantId
                    )

                    : 0
            ]);


            const delinquencyExposure =
                this.roundMoney(
                    (overdueLoans || []).reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            const defaultExposure =
                this.roundMoney(
                    (defaultedLoans || []).reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            let portfolioRiskRating =
                'LOW';


            if (
                nplRatio >= 15 ||
                fraudRiskScore >= 80
            ) {

                portfolioRiskRating =
                    'CRITICAL';

            } else if (
                nplRatio >= 10
            ) {

                portfolioRiskRating =
                    'HIGH';

            } else if (
                nplRatio >= 5
            ) {

                portfolioRiskRating =
                    'MODERATE';
            }


            const earlyWarningIndicators = {

                highNPL:
                    nplRatio > 5,

                highFraudRisk:
                    fraudRiskScore > 70,

                highPortfolioRisk:
                    Number(
                        portfolioAtRisk?.par30 || 0
                    ) > 10,

                weakCollections:
                    collectionRatio < 85,

                highWriteOffs:
                    writeOffRate > 3
            };


            /*
             * This is an operational estimate only.
             * Regulatory ECL should eventually be supplied by
             * the institution's approved impairment engine.
             */

            const expectedCreditLoss =
                this.roundMoney(
                    (
                        delinquencyExposure * 0.05
                    ) +
                    (
                        defaultExposure * 0.25
                    )
                );


            return {

                tenantId,

                portfolioRiskRating,

                creditRisk: {

                    nplRatio,

                    portfolioAtRisk,

                    averageDaysPastDue,

                    expectedCreditLoss
                },

                operationalRisk: {

                    fraudRiskScore,

                    collectionRatio,

                    loanRecoveryRate:
                        recoveryRate,

                    writeOffRate
                },

                exposureMetrics: {

                    overdueLoans:
                        (overdueLoans || []).length,

                    defaultedLoans:
                        (defaultedLoans || []).length,

                    delinquencyExposure,

                    defaultExposure
                },

                earlyWarningIndicators,

                generatedAt:
                    new Date().toISOString()
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Risk metrics generation failed',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * FRAUD ALERTS
     * ====================================================================== */

    static async getFraudAlerts(
        tenantId
    ) {

        this.assertTenant(tenantId);

        if (
            !RiskEngineService ||
            typeof RiskEngineService.getFraudAlerts !==
                'function'
        ) {

            return {

                totalAlerts: 0,

                criticalAlerts: 0,

                highRiskAlerts: 0,

                mediumRiskAlerts: 0,

                lowRiskAlerts: 0,

                alerts: []
            };
        }


        const alerts =
            await RiskEngineService.getFraudAlerts(
                tenantId
            );


        const enhancedAlerts =
            (alerts || []).map(
                alert => {

                    const score =
                        Number(
                            alert.riskScore || 0
                        );


                    const severity =
                        score >= 90
                            ? 'CRITICAL'
                            : score >= 75
                                ? 'HIGH'
                                : score >= 50
                                    ? 'MEDIUM'
                                    : 'LOW';


                    return {

                        ...alert,

                        severity,

                        priority:
                            severity === 'CRITICAL'
                                ? 1
                                : severity === 'HIGH'
                                    ? 2
                                    : severity === 'MEDIUM'
                                        ? 3
                                        : 4,

                        escalationRequired:
                            severity === 'CRITICAL' ||
                            severity === 'HIGH'
                    };
                }
            );


        return {

            totalAlerts:
                enhancedAlerts.length,

            criticalAlerts:
                enhancedAlerts.filter(
                    item =>
                        item.severity ===
                        'CRITICAL'
                ).length,

            highRiskAlerts:
                enhancedAlerts.filter(
                    item =>
                        item.severity ===
                        'HIGH'
                ).length,

            mediumRiskAlerts:
                enhancedAlerts.filter(
                    item =>
                        item.severity ===
                        'MEDIUM'
                ).length,

            lowRiskAlerts:
                enhancedAlerts.filter(
                    item =>
                        item.severity ===
                        'LOW'
                ).length,

            alerts:
                enhancedAlerts
        };
    }


    /* ========================================================================
     * COMPLIANCE ALERTS
     * ====================================================================== */

    static async getComplianceAlerts(
        tenantId
    ) {

        this.assertTenant(tenantId);

        if (
            !ComplianceService
        ) {

            return [];
        }


        if (
            typeof ComplianceService.getLoanAlerts ===
                'function'
        ) {

            return (
                await ComplianceService.getLoanAlerts(
                    tenantId
                )
            ) || [];
        }


        if (
            typeof ComplianceService.getComplianceAlerts ===
                'function'
        ) {

            return (
                await ComplianceService.getComplianceAlerts(
                    tenantId
                )
            ) || [];
        }


        return [];
    }


    /* ========================================================================
     * BOARD REPORTING
     * ====================================================================== */

    static async getBoardReport(
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const [
                portfolio,
                risk,
                overdueResult,
                defaultedResult,
                fraudAlerts,
                complianceAlerts
            ] = await Promise.all([

                this.getPortfolioMetrics(
                    tenantId
                ),

                this.getRiskMetrics(
                    tenantId
                ),

                this.getOverdueLoans(
                    tenantId
                ),

                this.getDefaultedLoans(
                    tenantId
                ),

                this.getFraudAlerts(
                    tenantId
                ),

                this.getComplianceAlerts(
                    tenantId
                )
            ]);


            const overdueLoans =
                overdueResult?.loans || [];


            const defaultedLoans =
                defaultedResult?.loans || [];


            const totalOverdueExposure =
                this.roundMoney(
                    overdueLoans.reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            const totalDefaultExposure =
                this.roundMoney(
                    defaultedLoans.reduce(
                        (
                            total,
                            loan
                        ) =>
                            total +
                            Number(
                                loan.outstandingBalance || 0
                            ),
                        0
                    )
                );


            return {

                success: true,

                tenantId,

                generatedAt:
                    new Date().toISOString(),

                executiveSummary: {

                    portfolioHealth:
                        portfolio.portfolioHealth,

                    portfolioRisk:
                        risk.portfolioRiskRating,

                    par30:
                        portfolio.par30,

                    par60:
                        portfolio.par60,

                    par90:
                        portfolio.par90,

                    nplRatio:
                        risk.creditRisk.nplRatio,

                    expectedCreditLoss:
                        risk.creditRisk.expectedCreditLoss,

                    fraudAlerts:
                        fraudAlerts.totalAlerts,

                    complianceAlerts:
                        Array.isArray(
                            complianceAlerts
                        )
                            ? complianceAlerts.length
                            : 0
                },

                portfolio,

                risk,

                delinquency: {

                    overdueLoanCount:
                        overdueLoans.length,

                    totalOverdueExposure,

                    defaultedLoanCount:
                        defaultedLoans.length,

                    totalDefaultExposure
                },

                fraud: {

                    summary:
                        fraudAlerts,

                    alerts:
                        fraudAlerts.alerts || []
                },

                compliance: {

                    totalAlerts:
                        Array.isArray(
                            complianceAlerts
                        )
                            ? complianceAlerts.length
                            : 0,

                    alerts:
                        complianceAlerts
                }
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Board report generation failed',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * AUDIT TRAIL
     * ====================================================================== */

    static async getAuditTrail(
        loanId,
        tenantId
    ) {

        const loan =
            await this.getLoanOrThrow(
                loanId,
                tenantId
            );


        const records =
            await LoanAuditRepository.findByLoan(
                loan._id,
                tenantId
            );


        const timeline =
            (records || []).map(
                record => ({

                    auditId:
                        record._id,

                    action:
                        record.action,

                    actor:
                        record.actor,

                    actorName:
                        record.actorName,

                    metadata:
                        record.metadata,

                    ipAddress:
                        record.ipAddress,

                    source:
                        record.source ||
                        'SYSTEM',

                    timestamp:
                        record.createdAt
                })
            );


        return {

            loanId,

            tenantId,

            timeline,

            statistics: {

                totalEvents:
                    timeline.length,

                approvals:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.APPROVED
                    ).length,

                rejections:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.REJECTED
                    ).length,

                disbursements:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.DISBURSED
                    ).length,

                repayments:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.REPAYMENT
                    ).length,

                manualReviews:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.MANUAL_REVIEW
                    ).length,

                writeOffs:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.WRITTEN_OFF
                    ).length,

                recoveries:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.RECOVERY
                    ).length,

                restructurings:
                    timeline.filter(
                        item =>
                            item.action ===
                            ACTION.RESTRUCTURED
                    ).length
            },

            latestActivity:
                timeline.length
                    ? timeline[
                        timeline.length - 1
                    ]
                    : null,

            generatedAt:
                new Date().toISOString()
        };
    }


    /* ========================================================================
     * WRITE-OFF
     * ====================================================================== */

    static async writeOffLoan(
        loanId,
        payload = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                WRITE_OFF_STATUSES
            );


            const writeOffAmount =
                payload.amount !== undefined

                    ? this.normalizeAmount(
                        payload.amount,
                        'writeOff amount'
                    )

                    : this.normalizeAmount(
                        loan.outstandingBalance || 0,
                        'writeOff amount'
                    );


            const outstanding =
                Number(
                    loan.outstandingBalance || 0
                );


            if (
                writeOffAmount >
                outstanding
            ) {

                throw new Error(
                    'Write-off amount cannot exceed outstanding balance'
                );
            }


            if (
                !payload.reason
            ) {

                throw new Error(
                    'Write-off reason is required'
                );
            }


            const writeOffDate =
                new Date();


            const writeOffData = {

                status:
                    STATUS.WRITTEN_OFF,

                writeOffAmount,

                writeOffReason:
                    payload.reason,

                writeOffReference:
                    payload.reference ||
                    this.generateReference('WO'),

                writeOffApprovedBy:
                    this.getActorId(actor),

                writeOffApprovedByName:
                    this.getActorName(actor),

                writeOffDate,

                provisionReleased:
                    Boolean(
                        payload.provisionReleased
                    ),

                boardApprovalReference:
                    payload.boardApprovalReference,

                outstandingBalance:
                    this.roundMoney(
                        outstanding -
                        writeOffAmount
                    )
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    writeOffData
                );


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.WRITTEN_OFF,

                actor,

                metadata:
                    writeOffData
            });


            return {

                success: true,

                status:
                    STATUS.WRITTEN_OFF,

                loan:
                    updatedLoan,

                writeOffAmount,

                writeOffDate
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Write-off failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * RECOVERY
     * ====================================================================== */

    static async recoverLoan(
        loanId,
        payload = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                RECOVERY_STATUSES
            );


            const recoveryAmount =
                this.normalizeAmount(
                    payload.amount,
                    'recovery amount'
                );


            const previousBalance =
                this.roundMoney(
                    loan.outstandingBalance || 0
                );


            if (
                recoveryAmount >
                previousBalance
            ) {

                throw new Error(
                    'Recovery amount cannot exceed outstanding balance'
                );
            }


            const remainingBalance =
                this.roundMoney(
                    Math.max(
                        previousBalance -
                        recoveryAmount,
                        0
                    )
                );


            const recoveredAt =
                new Date();


            const recoveryData = {

                recoveredAmount:
                    recoveryAmount,

                recoveryReason:
                    payload.reason,

                recoveryReference:
                    payload.reference ||
                    this.generateReference('REC'),

                recoveryChannel:
                    payload.channel ||
                    'MANUAL',

                recoveredBy:
                    this.getActorId(actor),

                recoveredByName:
                    this.getActorName(actor),

                recoveredAt,

                transactionReference:
                    payload.transactionReference
            };


            if (
                typeof LoanRepository.recordRecovery ===
                    'function'
            ) {

                await LoanRepository.recordRecovery(
                    loanId,
                    recoveryData,
                    tenantId
                );
            }


            const updatePayload = {

                outstandingBalance:
                    remainingBalance,

                recoveryStatus:
                    remainingBalance === 0
                        ? 'FULLY_RECOVERED'
                        : 'PARTIALLY_RECOVERED',

                lastRecoveryDate:
                    recoveredAt,

                totalRecovered:
                    this.roundMoney(
                        Number(
                            loan.totalRecovered || 0
                        ) +
                        recoveryAmount
                    ),

                status:
                    remainingBalance === 0
                        ? STATUS.RECOVERED
                        : loan.status
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    updatePayload
                );


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.RECOVERY,

                actor,

                metadata: {

                    recoveryAmount,

                    previousBalance,

                    remainingBalance,

                    reference:
                        recoveryData.recoveryReference
                }
            });


            return {

                success: true,

                loan:
                    updatedLoan,

                recoveredAmount:
                    recoveryAmount,

                remainingBalance,

                recoveryStatus:
                    updatePayload.recoveryStatus,

                recoveredAt
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Loan recovery failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * RESTRUCTURING
     * ====================================================================== */

    static async restructureLoan(
        loanId,
        payload = {},
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const loan =
                await this.getLoanOrThrow(
                    loanId,
                    tenantId
                );


            this.assertStatus(
                loan,
                RESTRUCTURABLE_STATUSES
            );


            const restructuringReference =
                payload.reference ||
                this.generateReference('RST');


            const restructuringType =
                payload.restructureType ||
                'RESCHEDULE';


            const oldTerms = {

                principal:
                    loan.principal,

                interestRate:
                    loan.interestRate,

                term:
                    loan.term,

                maturityDate:
                    loan.maturityDate,

                outstandingBalance:
                    loan.outstandingBalance
            };


            const revisedTerm =
                payload.term ??
                loan.term;


            const revisedInterestRate =
                payload.interestRate ??
                loan.interestRate;


            const revisedPrincipal =
                payload.principal ??
                loan.principal;


            const moratoriumMonths =
                Number(
                    payload.moratoriumMonths || 0
                );


            if (
                Number(revisedTerm) <= 0
            ) {

                throw new Error(
                    'Revised term must be greater than zero'
                );
            }


            if (
                Number(revisedInterestRate) < 0
            ) {

                throw new Error(
                    'Revised interest rate cannot be negative'
                );
            }


            if (
                Number(revisedPrincipal) <= 0
            ) {

                throw new Error(
                    'Revised principal must be greater than zero'
                );
            }


            const restructuredAt =
                new Date();


            const restructuringData = {

                status:
                    STATUS.RESTRUCTURED,

                restructureType:
                    restructuringType,

                restructuringReference,

                restructuredAt,

                restructuredBy:
                    this.getActorId(actor),

                restructuredByName:
                    this.getActorName(actor),

                restructuringReason:
                    payload.reason,

                originalTerm:
                    loan.term,

                originalInterestRate:
                    loan.interestRate,

                originalMaturityDate:
                    loan.maturityDate,

                revisedTerm,

                revisedInterestRate,

                revisedPrincipal,

                revisedMaturityDate:
                    payload.maturityDate,

                moratoriumMonths,

                committeeApprovalRef:
                    payload.committeeApprovalRef,

                restructuringNotes:
                    payload.notes
            };


            const updatedLoan =
                await LoanRepository.update(
                    loanId,
                    tenantId,
                    restructuringData
                );


            if (
                ScheduleRepository &&
                typeof ScheduleRepository.regenerateSchedule ===
                    'function'
            ) {

                await ScheduleRepository.regenerateSchedule(
                    loanId,
                    {
                        term:
                            revisedTerm,

                        interestRate:
                            revisedInterestRate,

                        principal:
                            revisedPrincipal,

                        moratoriumMonths
                    },
                    tenantId
                );
            }


            let riskAssessment =
                null;


            if (
                RiskEngineService &&
                typeof RiskEngineService.assessRestructuredLoan ===
                    'function'
            ) {

                riskAssessment =
                    await RiskEngineService.assessRestructuredLoan(
                        updatedLoan,
                        tenantId
                    );
            }


            await this.audit({

                tenantId,

                loanId,

                action:
                    ACTION.RESTRUCTURED,

                actor,

                metadata: {

                    restructuringReference,

                    restructuringType,

                    reason:
                        payload.reason,

                    oldTerms,

                    newTerms: {

                        principal:
                            revisedPrincipal,

                        interestRate:
                            revisedInterestRate,

                        term:
                            revisedTerm,

                        maturityDate:
                            payload.maturityDate
                    },

                    riskAssessment
                }
            });


            return {

                success: true,

                status:
                    STATUS.RESTRUCTURED,

                loan:
                    updatedLoan,

                restructuringReference,

                restructuringType,

                previousTerms:
                    oldTerms,

                revisedTerms: {

                    principal:
                        revisedPrincipal,

                    interestRate:
                        revisedInterestRate,

                    term:
                        revisedTerm,

                    maturityDate:
                        payload.maturityDate
                },

                riskAssessment,

                restructuredAt
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Loan restructuring failed',
                {
                    tenantId,
                    loanId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }


    /* ========================================================================
     * BULK APPROVAL
     * ====================================================================== */

    static async bulkApproveLoans(
        loanIds,
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);


        if (
            !Array.isArray(loanIds) ||
            loanIds.length === 0
        ) {

            throw new Error(
                'Loan IDs are required'
            );
        }


        const uniqueLoanIds =
            [
                ...new Set(
                    loanIds.map(
                        id =>
                            String(id)
                    )
                )
            ];


        const results = {

            total:
                uniqueLoanIds.length,

            approved: [],

            failed: []
        };


        for (
            const loanId of uniqueLoanIds
        ) {

            try {

                const result =
                    await this.approveLoan(
                        loanId,
                        {
                            reference:
                                this.generateReference('BAPR')
                        },
                        actor,
                        tenantId
                    );


                results.approved.push({

                    loanId,

                    status:
                        result.status
                });

            } catch (error) {

                results.failed.push({

                    loanId,

                    reason:
                        error.message
                });
            }
        }


        await Promise.all(
            results.approved.map(
                item =>
                    this.audit({

                        tenantId,

                        loanId:
                            item.loanId,

                        action:
                            ACTION.BULK_APPROVED,

                        actor,

                        metadata: {

                            bulkOperation:
                                true
                        }
                    })
            )
        );


        return {

            success:
                results.failed.length === 0,

            operation:
                'BULK_APPROVE',

            totalLoans:
                results.total,

            approvedCount:
                results.approved.length,

            failedCount:
                results.failed.length,

            approvedLoans:
                results.approved,

            failedLoans:
                results.failed,

            completedAt:
                new Date().toISOString()
        };
    }


    /* ========================================================================
     * BULK REJECTION
     * ====================================================================== */

    static async bulkRejectLoans(
        loanIds,
        reason,
        actor,
        tenantId
    ) {

        this.assertTenant(tenantId);


        if (
            !Array.isArray(loanIds) ||
            loanIds.length === 0
        ) {

            throw new Error(
                'Loan IDs are required'
            );
        }


        if (
            !reason ||
            String(reason).trim().length < 3
        ) {

            throw new Error(
                'Bulk rejection reason is required'
            );
        }


        const uniqueLoanIds =
            [
                ...new Set(
                    loanIds.map(
                        id =>
                            String(id)
                    )
                )
            ];


        const approved = [];
        const failed = [];


        for (
            const loanId of uniqueLoanIds
        ) {

            try {

                await this.rejectLoan(
                    loanId,
                    {
                        reason,
                        reference:
                            this.generateReference('BREJ')
                    },
                    actor,
                    tenantId
                );


                approved.push(
                    loanId
                );

            } catch (error) {

                failed.push({

                    loanId,

                    reason:
                        error.message
                });
            }
        }


        return {

            success:
                failed.length === 0,

            operation:
                'BULK_REJECT',

            totalLoans:
                uniqueLoanIds.length,

            rejectedCount:
                approved.length,

            failedCount:
                failed.length,

            rejectedLoans:
                approved,

            failedLoans:
                failed,

            completedAt:
                new Date().toISOString()
        };
    }


    /* ========================================================================
     * EXPORT
     * ====================================================================== */

    static async exportLoans(
        filters = {},
        tenantId
    ) {

        this.assertTenant(tenantId);

        try {

            const {
                format,
                requestedBy,
                ...loanFilters
            } = filters || {};


            const exportData =
                await LoanRepository.exportLoans(
                    loanFilters,
                    tenantId
                );


            const portfolioMetrics =
                await this.getPortfolioMetrics(
                    tenantId
                );


            const summary = {

                totalRecords:
                    Array.isArray(
                        exportData
                    )
                        ? exportData.length
                        : 0,

                exportType:
                    format ||
                    'JSON',

                generatedAt:
                    new Date().toISOString(),

                generatedBy:
                    requestedBy,

                tenantId
            };


            logger.info(
                '[LoanWorkflow] Loan export generated',
                {
                    tenantId,
                    records:
                        summary.totalRecords,
                    format:
                        summary.exportType
                }
            );


            return {

                success: true,

                exportSummary:
                    summary,

                portfolioSnapshot:
                    portfolioMetrics,

                data:
                    exportData
            };

        } catch (error) {

            logger.error(
                '[LoanWorkflow] Export failed',
                {
                    tenantId,
                    error:
                        error.message
                }
            );

            throw error;
        }
    }
}


/* ============================================================================
 * EXPORT
 * ========================================================================== */

module.exports =
    LoanWorkflowService;