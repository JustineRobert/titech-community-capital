'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Loan Credit Scoring Service
 * ============================================================================
 *
 * Enterprise Production-Grade Loan Credit Scoring Engine
 *
 * Responsibilities:
 *
 *   - Applicant credit scoring
 *   - Payment history analysis
 *   - Debt-to-income analysis
 *   - Loan utilization analysis
 *   - Account age analysis
 *   - Fraud / sanctions risk integration
 *   - Risk classification
 *   - Recommendation generation
 *   - Score explainability
 *   - Tenant isolation
 *   - Deterministic scoring
 *   - Score integrity hashing
 *   - Input fingerprinting
 *   - Idempotent score generation
 *   - Risk profile persistence
 *   - Audit hooks
 *   - Optional transaction/session propagation
 *
 * Design Principles:
 *
 *   - Deterministic scoring
 *   - Tenant isolated
 *   - Fail closed on critical risk signals
 *   - No mutation of applicant or loan data
 *   - No floating-point scoring drift
 *   - Explainable scoring
 *   - Audit friendly
 *   - Backward compatible public API
 *
 * Public API:
 *
 *   scoreApplicant(applicant, loanData, riskFlags)
 *
 * Optional advanced API:
 *
 *   scoreApplicant(applicant, loanData, riskFlags, options)
 *
 * ============================================================================ */

const crypto = require('crypto');

const LoanRiskProfile = require('../../models/LoanRiskProfile');

/**
 * ============================================================================
 * Optional Logger Resolution
 * ============================================================================
 */

let logger = console;

try {
    // eslint-disable-next-line global-require
    const applicationLogger = require('../../utils/logger');

    if (applicationLogger) {
        logger = applicationLogger;
    }
} catch (error) {
    // Logger intentionally remains optional.
}

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SCORE_MIN = 300;
const SCORE_MAX = 850;

const SCORE_RANGE =
    SCORE_MAX - SCORE_MIN;

const RISK_LEVEL = Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
    SEVERE: 'SEVERE'
});

const DECISION = Object.freeze({
    APPROVE: 'APPROVE',
    REVIEW: 'REVIEW',
    RESTRICT: 'RESTRICT',
    DECLINE: 'DECLINE',
    BLOCK: 'BLOCK'
});

const DEFAULT_CONFIG = Object.freeze({
    weights: Object.freeze({
        PAYMENT_HISTORY: 35,
        DEBT_TO_INCOME: 25,
        LOAN_UTILIZATION: 20,
        ACCOUNT_AGE: 10,
        FRAUD_SANCTIONS: 10
    }),

    thresholds: Object.freeze({
        EXCELLENT: 750,
        GOOD: 650,
        FAIR: 550,
        POOR: 450,
        VERY_POOR: 300
    }),

    limits: Object.freeze({
        MAX_DTI: 1,
        MAX_UTILIZATION: 1,
        MAX_ACCOUNT_AGE_MONTHS: 60
    }),

    persistence: Object.freeze({
        enabled: true,
        failClosed: true
    }),

    audit: Object.freeze({
        required: false
    })
});

const HARD_BLOCK_FLAGS = Object.freeze([
    'sanctions',
    'fraud',
    'complianceBlock',
    'identityMismatch',
    'deceased'
]);

/**
 * ============================================================================
 * Custom Errors
 * ============================================================================
 */

class LoanCreditScoringError extends Error {

    constructor(
        message,
        details = {},
        options = {}
    ) {
        super(message);

        this.name =
            'LoanCreditScoringError';

        this.code =
            options.code ||
            details.code ||
            'LOAN_CREDIT_SCORING_ERROR';

        this.details =
            details;

        if (options.cause) {
            this.cause =
                options.cause;
        }

        Error.captureStackTrace?.(
            this,
            LoanCreditScoringError
        );
    }
}

/**
 * ============================================================================
 * Service
 * ============================================================================
 */

class LoanCreditScoringService {

    constructor(options = {}) {

        this.config =
            this.buildConfig(
                options.config || {}
            );

        this.auditService =
            options.auditService || null;

        this.riskProfileModel =
            options.riskProfileModel ||
            LoanRiskProfile;
    }

    /**
     * =========================================================================
     * Main Entrypoint
     * =========================================================================
     *
     * Backward-compatible signature:
     *
     *   scoreApplicant(applicant, loanData, riskFlags)
     *
     * Advanced:
     *
     *   scoreApplicant(
     *       applicant,
     *       loanData,
     *       riskFlags,
     *       {
     *           correlationId,
     *           idempotencyKey,
     *           session
     *       }
     *   )
     *
     * @param {Object} applicant
     * @param {Object} loanData
     * @param {Object} riskFlags
     * @param {Object} options
     *
     * @returns {Promise<Object>}
     */
    async scoreApplicant(
        applicant,
        loanData,
        riskFlags = {},
        options = {}
    ) {

        const startedAt =
            Date.now();

        try {

            this.validateApplicant(
                applicant
            );

            this.validateLoanData(
                loanData
            );

            this.validateRiskFlags(
                riskFlags
            );

            this.validateOptions(
                options
            );

            const tenantId =
                this.resolveTenantId(
                    applicant,
                    loanData
                );

            const applicantId =
                this.normalizeIdentifier(
                    applicant._id ||
                    applicant.id ||
                    applicant.applicantId
                );

            const normalized =
                this.normalizeScoringInputs(
                    loanData,
                    riskFlags
                );

            /**
             * Deterministic fingerprint of the scoring inputs.
             *
             * This makes repeated scoring requests traceable and allows
             * callers to correlate identical evaluations.
             */
            const inputFingerprint =
                this.generateInputFingerprint({
                    tenantId,
                    applicantId,
                    normalized,
                    scoringVersion:
                        this.getScoringVersion()
                });

            const scoreId =
                this.generateScoreId(
                    tenantId,
                    applicantId,
                    loanData,
                    inputFingerprint
                );

            /**
             * Calculate component scores.
             */
            const breakdown =
                this.calculateScoreBreakdown(
                    normalized
                );

            /**
             * Calculate aggregate score.
             */
            const creditScore =
                this.calculateWeightedScore(
                    breakdown
                );

            /**
             * Apply hard risk controls.
             */
            const controls =
                this.evaluateRiskControls(
                    normalized,
                    normalized.riskFlags,
                    creditScore
                );

            const finalScore =
                controls.scoreOverride !== null
                    ? controls.scoreOverride
                    : creditScore;

            const riskLevel =
                this.classifyRisk(
                    finalScore,
                    controls
                );

            const decision =
                this.determineDecision(
                    finalScore,
                    riskLevel,
                    controls
                );

            const recommendations =
                this.generateRecommendations(
                    riskLevel,
                    decision,
                    controls
                );

            const timestamp =
                new Date();

            const scoreIntegrity =
                this.generateScoreIntegrityHash({
                    scoreId,
                    tenantId,
                    applicantId,
                    creditScore:
                        finalScore,
                    riskLevel,
                    decision,
                    breakdown,
                    controls,
                    inputFingerprint,
                    scoringVersion:
                        this.getScoringVersion()
                });

            const result = {
                scoreId,

                applicantId,

                tenantId,

                creditScore:
                    finalScore,

                baseScore:
                    creditScore,

                riskLevel,

                decision,

                breakdown,

                controls,

                recommendations,

                inputFingerprint,

                scoreIntegrity,

                correlationId:
                    this.normalizeIdentifier(
                        options.correlationId ||
                        loanData.correlationId ||
                        applicant.correlationId
                    ),

                idempotencyKey:
                    this.normalizeIdentifier(
                        options.idempotencyKey ||
                        loanData.idempotencyKey
                    ),

                scoringVersion:
                    this.getScoringVersion(),

                timestamp:
                    timestamp.toISOString(),

                processingTimeMs:
                    Date.now() - startedAt
            };

            /**
             * Persist latest risk profile.
             */
            await this.persistRiskProfile({
                applicantId,
                tenantId,
                scoreId,
                creditScore:
                    finalScore,
                baseScore:
                    creditScore,
                riskLevel,
                decision,
                loanData,
                breakdown,
                controls,
                recommendations,
                inputFingerprint,
                scoreIntegrity,
                correlationId:
                    result.correlationId,
                idempotencyKey:
                    result.idempotencyKey,
                scoringVersion:
                    this.getScoringVersion(),
                session:
                    options.session || null
            });

            /**
             * Audit after successful persistence.
             */
            await this.auditScore({
                ...result,

                auditType:
                    'LOAN_CREDIT_SCORE_CALCULATED'
            });

            this.safeLog(
                'info',
                '[LoanCreditScoringService] Credit score calculated',
                {
                    scoreId,
                    tenantId,
                    applicantId,
                    creditScore:
                        finalScore,
                    riskLevel,
                    decision,
                    inputFingerprint
                }
            );

            return Object.freeze(
                this.deepFreeze(
                    result
                )
            );

        } catch (error) {

            this.safeLog(
                'error',
                '[LoanCreditScoringService] Credit scoring failed',
                {
                    applicantId:
                        applicant?._id ||
                        applicant?.id ||
                        applicant?.applicantId ||
                        null,

                    tenantId:
                        applicant?.tenantId ||
                        loanData?.tenantId ||
                        null,

                    error:
                        error.message,

                    code:
                        error.code || null
                }
            );

            if (
                error instanceof
                LoanCreditScoringError
            ) {
                throw error;
            }

            throw new LoanCreditScoringError(
                'Loan credit scoring failed',
                {
                    originalError:
                        error.message
                },
                {
                    code:
                        'CREDIT_SCORING_FAILED',
                    cause:
                        error
                }
            );
        }
    }

    /**
     * =========================================================================
     * Configuration
     * =========================================================================
     */

    buildConfig(customConfig = {}) {

        const config = {
            weights: {
                ...DEFAULT_CONFIG.weights,
                ...(customConfig.weights || {})
            },

            thresholds: {
                ...DEFAULT_CONFIG.thresholds,
                ...(customConfig.thresholds || {})
            },

            limits: {
                ...DEFAULT_CONFIG.limits,
                ...(customConfig.limits || {})
            },

            persistence: {
                ...DEFAULT_CONFIG.persistence,
                ...(customConfig.persistence || {})
            },

            audit: {
                ...DEFAULT_CONFIG.audit,
                ...(customConfig.audit || {})
            }
        };

        this.validateConfiguration(
            config
        );

        return config;
    }

    validateConfiguration(config) {

        const weights =
            config.weights;

        const requiredWeights = [
            'PAYMENT_HISTORY',
            'DEBT_TO_INCOME',
            'LOAN_UTILIZATION',
            'ACCOUNT_AGE',
            'FRAUD_SANCTIONS'
        ];

        let totalWeight = 0;

        for (
            const key of requiredWeights
        ) {

            const value =
                Number(weights[key]);

            if (
                !Number.isFinite(value) ||
                value < 0
            ) {
                throw new LoanCreditScoringError(
                    `Invalid scoring weight: ${key}`,
                    {
                        key,
                        value:
                            weights[key]
                    },
                    {
                        code:
                            'INVALID_SCORING_CONFIGURATION'
                    }
                );
            }

            totalWeight +=
                value;
        }

        if (
            Math.abs(
                totalWeight - 100
            ) > Number.EPSILON
        ) {
            throw new LoanCreditScoringError(
                'Scoring weights must total exactly 100',
                {
                    totalWeight
                },
                {
                    code:
                        'INVALID_SCORING_CONFIGURATION'
                }
            );
        }

        const thresholds =
            config.thresholds;

        const orderedThresholds = [
            thresholds.EXCELLENT,
            thresholds.GOOD,
            thresholds.FAIR,
            thresholds.POOR,
            thresholds.VERY_POOR
        ].map(Number);

        for (
            const threshold of orderedThresholds
        ) {

            if (
                !Number.isFinite(
                    threshold
                )
            ) {
                throw new LoanCreditScoringError(
                    'Invalid scoring threshold',
                    {
                        threshold
                    },
                    {
                        code:
                            'INVALID_SCORING_CONFIGURATION'
                    }
                );
            }
        }

        if (
            thresholds.EXCELLENT <
            thresholds.GOOD ||

            thresholds.GOOD <
            thresholds.FAIR ||

            thresholds.FAIR <
            thresholds.POOR ||

            thresholds.POOR <
            thresholds.VERY_POOR
        ) {
            throw new LoanCreditScoringError(
                'Scoring thresholds must be ordered from highest to lowest',
                {
                    thresholds
                },
                {
                    code:
                        'INVALID_SCORING_CONFIGURATION'
                }
            );
        }

        if (
            thresholds.VERY_POOR <
            SCORE_MIN ||

            thresholds.EXCELLENT >
            SCORE_MAX
        ) {
            throw new LoanCreditScoringError(
                'Scoring thresholds must fall within the supported score range',
                {
                    thresholds,
                    SCORE_MIN,
                    SCORE_MAX
                },
                {
                    code:
                        'INVALID_SCORING_CONFIGURATION'
                }
            );
        }

        const limits =
            config.limits;

        [
            'MAX_DTI',
            'MAX_UTILIZATION',
            'MAX_ACCOUNT_AGE_MONTHS'
        ].forEach(key => {

            const value =
                Number(limits[key]);

            if (
                !Number.isFinite(value) ||
                value <= 0
            ) {
                throw new LoanCreditScoringError(
                    `Invalid scoring limit: ${key}`,
                    {
                        key,
                        value:
                            limits[key]
                    },
                    {
                        code:
                            'INVALID_SCORING_CONFIGURATION'
                        }
                );
            }
        });
    }

    getScoringVersion() {
        return '2026.2';
    }

    /**
     * =========================================================================
     * Validation
     * =========================================================================
     */

    validateApplicant(applicant) {

        if (
            !applicant ||
            typeof applicant !== 'object' ||
            Array.isArray(applicant)
        ) {
            throw new LoanCreditScoringError(
                'Applicant data required',
                {},
                {
                    code:
                        'MISSING_APPLICANT'
                }
            );
        }

        const applicantId =
            applicant._id ||
            applicant.id ||
            applicant.applicantId;

        if (!applicantId) {
            throw new LoanCreditScoringError(
                'Applicant identifier required',
                {},
                {
                    code:
                        'MISSING_APPLICANT_ID'
                }
            );
        }

        if (
            !this.normalizeIdentifier(
                applicant.tenantId
            )
        ) {
            throw new LoanCreditScoringError(
                'Applicant tenant context required',
                {},
                {
                    code:
                        'MISSING_TENANT_ID'
                }
            );
        }
    }

    validateLoanData(loanData) {

        if (
            !loanData ||
            typeof loanData !== 'object' ||
            Array.isArray(loanData)
        ) {
            throw new LoanCreditScoringError(
                'Loan data required',
                {},
                {
                    code:
                        'MISSING_LOAN_DATA'
                }
            );
        }

        const numericFields = [
            'onTimePayments',
            'totalPayments',
            'debt',
            'income',
            'currentLoans',
            'loanLimit',
            'accountAgeMonths'
        ];

        for (
            const field of numericFields
        ) {

            const value =
                loanData[field];

            if (
                value !== undefined &&
                value !== null
            ) {

                const numericValue =
                    Number(value);

                if (
                    !Number.isFinite(
                        numericValue
                    ) ||
                    numericValue < 0
                ) {
                    throw new LoanCreditScoringError(
                        `Invalid numeric loan field: ${field}`,
                        {
                            field,
                            value
                        },
                        {
                            code:
                                'INVALID_SCORING_INPUT'
                        }
                    );
                }
            }
        }
    }

    validateRiskFlags(riskFlags) {

        if (
            !riskFlags ||
            typeof riskFlags !== 'object' ||
            Array.isArray(riskFlags)
        ) {
            throw new LoanCreditScoringError(
                'Risk flags must be an object',
                {},
                {
                    code:
                        'INVALID_RISK_FLAGS'
                }
            );
        }
    }

    validateOptions(options) {

        if (
            !options ||
            typeof options !== 'object' ||
            Array.isArray(options)
        ) {
            throw new LoanCreditScoringError(
                'Scoring options must be an object',
                {},
                {
                    code:
                        'INVALID_SCORING_OPTIONS'
                }
            );
        }
    }

    /**
     * =========================================================================
     * Tenant Resolution
     * =========================================================================
     */

    resolveTenantId(
        applicant,
        loanData
    ) {

        const applicantTenant =
            this.normalizeIdentifier(
                applicant.tenantId
            );

        const loanTenant =
            this.normalizeIdentifier(
                loanData.tenantId
            );

        if (
            applicantTenant &&
            loanTenant &&
            applicantTenant !==
            loanTenant
        ) {
            throw new LoanCreditScoringError(
                'Applicant and loan tenant mismatch',
                {
                    applicantTenant,
                    loanTenant
                },
                {
                    code:
                        'TENANT_CONTEXT_MISMATCH'
                }
            );
        }

        const tenantId =
            applicantTenant ||
            loanTenant;

        if (!tenantId) {
            throw new LoanCreditScoringError(
                'Tenant identifier required',
                {},
                {
                    code:
                        'MISSING_TENANT_ID'
                }
            );
        }

        return tenantId;
    }

    /**
     * =========================================================================
     * Input Normalization
     * =========================================================================
     */

    normalizeScoringInputs(
        loanData,
        riskFlags
    ) {

        const totalPayments =
            this.nonNegativeNumber(
                loanData.totalPayments
            );

        const onTimePayments =
            Math.min(
                this.nonNegativeNumber(
                    loanData.onTimePayments
                ),
                totalPayments
            );

        const debt =
            this.nonNegativeNumber(
                loanData.debt
            );

        const income =
            this.nonNegativeNumber(
                loanData.income
            );

        const currentLoans =
            this.nonNegativeNumber(
                loanData.currentLoans
            );

        const loanLimit =
            this.nonNegativeNumber(
                loanData.loanLimit
            );

        const accountAgeMonths =
            this.nonNegativeNumber(
                loanData.accountAgeMonths
            );

        return {
            onTimePayments,
            totalPayments,
            debt,
            income,
            currentLoans,
            loanLimit,
            accountAgeMonths,

            paymentHistoryRate:
                totalPayments > 0
                    ? this.normalizeRatio(
                        onTimePayments,
                        totalPayments
                    )
                    : 0,

            dti:
                income > 0
                    ? this.normalizeRatio(
                        debt,
                        income
                    )
                    : 1,

            utilization:
                loanLimit > 0
                    ? this.normalizeRatio(
                        currentLoans,
                        loanLimit
                    )
                    : 1,

            riskFlags:
                this.normalizeRiskFlags(
                    riskFlags
                )
        };
    }

    normalizeRiskFlags(
        riskFlags = {}
    ) {

        const normalized = {};

        Object.keys(
            riskFlags
        ).forEach(key => {

            normalized[key] =
                this.normalizeBoolean(
                    riskFlags[key]
                );
        });

        return Object.freeze(
            normalized
        );
    }

    normalizeBoolean(value) {

        if (
            value === true ||
            value === 1
        ) {
            return true;
        }

        if (
            typeof value === 'string'
        ) {
            const normalized =
                value
                    .trim()
                    .toLowerCase();

            return [
                'true',
                '1',
                'yes',
                'y'
            ].includes(normalized);
        }

        return false;
    }

    nonNegativeNumber(value) {

        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return 0;
        }

        const number =
            Number(value);

        if (
            !Number.isFinite(number)
        ) {
            return 0;
        }

        return Math.max(
            0,
            number
        );
    }

    normalizeRatio(
        numerator,
        denominator
    ) {

        if (
            denominator <= 0
        ) {
            return 0;
        }

        const ratio =
            numerator /
            denominator;

        return this.roundPrecision(
            ratio,
            12
        );
    }

    /**
     * =========================================================================
     * Score Breakdown
     * =========================================================================
     */

    calculateScoreBreakdown(data) {

        const weights =
            this.config.weights;

        const paymentHistory =
            this.calculatePaymentHistoryScore(
                data
            );

        const debtToIncome =
            this.calculateDebtToIncomeScore(
                data
            );

        const utilization =
            this.calculateUtilizationScore(
                data
            );

        const accountAge =
            this.calculateAccountAgeScore(
                data
            );

        const fraudSanctions =
            this.calculateFraudSanctionsScore(
                data
            );

        return Object.freeze({
            PAYMENT_HISTORY: Object.freeze({
                weight:
                    weights.PAYMENT_HISTORY,
                factor:
                    paymentHistory.factor,
                contribution:
                    paymentHistory.contribution
            }),

            DEBT_TO_INCOME: Object.freeze({
                weight:
                    weights.DEBT_TO_INCOME,
                factor:
                    debtToIncome.factor,
                contribution:
                    debtToIncome.contribution
            }),

            LOAN_UTILIZATION: Object.freeze({
                weight:
                    weights.LOAN_UTILIZATION,
                factor:
                    utilization.factor,
                contribution:
                    utilization.contribution
            }),

            ACCOUNT_AGE: Object.freeze({
                weight:
                    weights.ACCOUNT_AGE,
                factor:
                    accountAge.factor,
                contribution:
                    accountAge.contribution
            }),

            FRAUD_SANCTIONS: Object.freeze({
                weight:
                    weights.FRAUD_SANCTIONS,
                factor:
                    fraudSanctions.factor,
                contribution:
                    fraudSanctions.contribution
            })
        });
    }

    calculatePaymentHistoryScore(data) {

        const factor =
            this.clamp(
                data.paymentHistoryRate,
                0,
                1
            );

        return {
            factor,
            contribution:
                this.roundScore(
                    factor *
                    this.config.weights
                        .PAYMENT_HISTORY
                )
        };
    }

    calculateDebtToIncomeScore(data) {

        const normalizedDti =
            this.clamp(
                data.dti /
                this.config.limits
                    .MAX_DTI,
                0,
                1
            );

        const factor =
            this.roundPrecision(
                1 - normalizedDti,
                12
            );

        return {
            factor,
            contribution:
                this.roundScore(
                    factor *
                    this.config.weights
                        .DEBT_TO_INCOME
                )
        };
    }

    calculateUtilizationScore(data) {

        const normalizedUtilization =
            this.clamp(
                data.utilization /
                this.config.limits
                    .MAX_UTILIZATION,
                0,
                1
            );

        const factor =
            this.roundPrecision(
                1 - normalizedUtilization,
                12
            );

        return {
            factor,
            contribution:
                this.roundScore(
                    factor *
                    this.config.weights
                        .LOAN_UTILIZATION
                )
        };
    }

    calculateAccountAgeScore(data) {

        const factor =
            this.clamp(
                data.accountAgeMonths /
                this.config.limits
                    .MAX_ACCOUNT_AGE_MONTHS,
                0,
                1
            );

        return {
            factor:
                this.roundPrecision(
                    factor,
                    12
                ),

            contribution:
                this.roundScore(
                    factor *
                    this.config.weights
                        .ACCOUNT_AGE
                )
        };
    }

    calculateFraudSanctionsScore(data) {

        const flagged =
            Boolean(
                data.riskFlags.fraud ||
                data.riskFlags.sanctions ||
                data.riskFlags.complianceBlock
            );

        const factor =
            flagged ? 0 : 1;

        return {
            factor,
            contribution:
                this.roundScore(
                    factor *
                    this.config.weights
                        .FRAUD_SANCTIONS
                )
        };
    }

    /**
     * =========================================================================
     * Aggregate Score
     * =========================================================================
     */

    calculateWeightedScore(breakdown) {

        let contributionTotal = 0;

        Object.keys(
            breakdown
        ).forEach(component => {

            contributionTotal +=
                Number(
                    breakdown[component]
                        .contribution || 0
                );
        });

        /**
         * Weighted contribution is normalized to 0-100.
         *
         * Score range:
         *
         *   300 + (contribution / 100 × 550)
         */
        const normalizedContribution =
            this.clamp(
                contributionTotal,
                0,
                100
            );

        const score =
            SCORE_MIN +
            (
                normalizedContribution /
                100
            ) *
            SCORE_RANGE;

        return this.clamp(
            Math.round(score),
            SCORE_MIN,
            SCORE_MAX
        );
    }

    /**
     * =========================================================================
     * Risk Controls
     * =========================================================================
     */

    evaluateRiskControls(
        data,
        riskFlags,
        calculatedScore
    ) {

        const reasons = [];

        let scoreOverride =
            null;

        const normalizedFlags =
            this.normalizeRiskFlags(
                riskFlags ||
                data.riskFlags ||
                {}
            );

        const flagReasonMap = {
            sanctions:
                'SANCTIONS_MATCH',

            fraud:
                'FRAUD_FLAG',

            complianceBlock:
                'COMPLIANCE_BLOCK',

            identityMismatch:
                'IDENTITY_MISMATCH',

            deceased:
                'DECEASED_IDENTITY_FLAG'
        };

        HARD_BLOCK_FLAGS.forEach(flag => {

            if (
                normalizedFlags[flag]
            ) {
                reasons.push(
                    flagReasonMap[flag]
                );
            }
        });

        if (
            reasons.length > 0
        ) {
            scoreOverride =
                SCORE_MIN;
        }

        return Object.freeze({
            hardBlock:
                reasons.length > 0,

            reasons:
                Object.freeze(reasons),

            scoreOverride,

            originalScore:
                calculatedScore,

            normalizedFlags
        });
    }

    /**
     * =========================================================================
     * Risk Classification
     * =========================================================================
     */

    classifyRisk(
        score,
        controls = {}
    ) {

        if (
            controls.hardBlock
        ) {
            return RISK_LEVEL.SEVERE;
        }

        if (
            score >=
            this.config.thresholds
                .EXCELLENT
        ) {
            return RISK_LEVEL.LOW;
        }

        if (
            score >=
            this.config.thresholds
                .GOOD
        ) {
            return RISK_LEVEL.MEDIUM;
        }

        if (
            score >=
            this.config.thresholds
                .FAIR
        ) {
            return RISK_LEVEL.HIGH;
        }

        if (
            score >=
            this.config.thresholds
                .POOR
        ) {
            return RISK_LEVEL.CRITICAL;
        }

        return RISK_LEVEL.SEVERE;
    }

    /**
     * =========================================================================
     * Decision Engine
     * =========================================================================
     */

    determineDecision(
        score,
        riskLevel,
        controls = {}
    ) {

        if (
            controls.hardBlock
        ) {
            return DECISION.BLOCK;
        }

        switch (riskLevel) {

            case RISK_LEVEL.LOW:
                return DECISION.APPROVE;

            case RISK_LEVEL.MEDIUM:
                return DECISION.REVIEW;

            case RISK_LEVEL.HIGH:
                return DECISION.RESTRICT;

            case RISK_LEVEL.CRITICAL:
                return DECISION.DECLINE;

            case RISK_LEVEL.SEVERE:
                return DECISION.BLOCK;

            default:
                return DECISION.REVIEW;
        }
    }

    /**
     * =========================================================================
     * Recommendations
     * =========================================================================
     */

    generateRecommendations(
        riskLevel,
        decision,
        controls = {}
    ) {

        if (
            controls.hardBlock ||
            decision === DECISION.BLOCK
        ) {
            return [
                'Do not approve the loan',
                'Escalate application to compliance and risk teams',
                'Resolve identified blocking conditions before reconsideration'
            ];
        }

        switch (riskLevel) {

            case RISK_LEVEL.LOW:

                return [
                    'Loan approval recommended',
                    'Applicant may qualify for standard or premium loan products',
                    'Apply normal affordability and product limits'
                ];

            case RISK_LEVEL.MEDIUM:

                return [
                    'Manual or policy-based review recommended',
                    'Consider moderate loan limits',
                    'Verify affordability before disbursement'
                ];

            case RISK_LEVEL.HIGH:

                return [
                    'Enhanced credit review recommended',
                    'Consider reduced loan amount',
                    'Consider collateral or guarantor requirements',
                    'Review existing debt obligations'
                ];

            case RISK_LEVEL.CRITICAL:

                return [
                    'Loan approval not recommended',
                    'Escalate for senior credit review',
                    'Consider restructuring existing obligations where appropriate'
                ];

            case RISK_LEVEL.SEVERE:

                return [
                    'Block loan application',
                    'Escalate to compliance and risk teams',
                    'Do not disburse until blocking conditions are resolved'
                ];

            default:

                return [
                    'Manual risk review required'
                ];
        }
    }

    /**
     * =========================================================================
     * Persistence
     * =========================================================================
     */

    async persistRiskProfile(data) {

        if (
            !this.config.persistence.enabled
        ) {
            return null;
        }

        try {

            if (
                !this.riskProfileModel ||
                typeof this.riskProfileModel
                    .updateOne !== 'function'
            ) {
                throw new Error(
                    'LoanRiskProfile model is unavailable'
                );
            }

            const filter = {
                tenantId:
                    data.tenantId,

                applicantId:
                    data.applicantId
            };

            /**
             * Persist a controlled scoring snapshot.
             *
             * Avoid storing arbitrary raw objects where possible.
             */
            const scoringSnapshot = {
                loanId:
                    this.normalizeIdentifier(
                        data.loanData.loanId ||
                        data.loanData.applicationId ||
                        null
                    ),

                reference:
                    this.normalizeIdentifier(
                        data.loanData.reference ||
                        null
                    ),

                requestedAmount:
                    this.safeOptionalNumber(
                        data.loanData.amount ||
                        data.loanData.requestedAmount
                    ),

                debt:
                    this.safeOptionalNumber(
                        data.loanData.debt
                    ),

                income:
                    this.safeOptionalNumber(
                        data.loanData.income
                    ),

                currentLoans:
                    this.safeOptionalNumber(
                        data.loanData.currentLoans
                    ),

                loanLimit:
                    this.safeOptionalNumber(
                        data.loanData.loanLimit
                    ),

                accountAgeMonths:
                    this.safeOptionalNumber(
                        data.loanData.accountAgeMonths
                    ),

                totalPayments:
                    this.safeOptionalNumber(
                        data.loanData.totalPayments
                    ),

                onTimePayments:
                    this.safeOptionalNumber(
                        data.loanData.onTimePayments
                    )
            };

            const now =
                new Date();

            const update = {
                $set: {
                    tenantId:
                        data.tenantId,

                    applicantId:
                        data.applicantId,

                    creditScore:
                        data.creditScore,

                    baseScore:
                        data.baseScore,

                    riskLevel:
                        data.riskLevel,

                    decision:
                        data.decision,

                    loanData:
                        scoringSnapshot,

                    breakdown:
                        data.breakdown,

                    riskControls:
                        data.controls,

                    recommendations:
                        data.recommendations,

                    scoreId:
                        data.scoreId,

                    inputFingerprint:
                        data.inputFingerprint,

                    scoreIntegrity:
                        data.scoreIntegrity,

                    correlationId:
                        data.correlationId ||
                        null,

                    idempotencyKey:
                        data.idempotencyKey ||
                        null,

                    scoringVersion:
                        data.scoringVersion,

                    scoredAt:
                        now,

                    updatedAt:
                        now
                },

                $setOnInsert: {
                    createdAt:
                        now
                }
            };

            const options = {
                upsert: true,
                runValidators: true,
                setDefaultsOnInsert: true
            };

            if (
                data.session
            ) {
                options.session =
                    data.session;
            }

            return await this.riskProfileModel
                .updateOne(
                    filter,
                    update,
                    options
                );

        } catch (error) {

            const wrappedError =
                new LoanCreditScoringError(
                    'Failed to persist loan risk profile',
                    {
                        tenantId:
                            data.tenantId,

                        applicantId:
                            data.applicantId,

                        originalError:
                            error.message
                    },
                    {
                        code:
                            'RISK_PROFILE_PERSISTENCE_FAILED',
                        cause:
                            error
                    }
                );

            if (
                this.config.persistence
                    .failClosed
            ) {
                throw wrappedError;
            }

            this.safeLog(
                'error',
                '[LoanCreditScoringService] Risk profile persistence failed',
                {
                    tenantId:
                        data.tenantId,

                    applicantId:
                        data.applicantId,

                    error:
                        error.message
                }
            );

            return null;
        }
    }

    /**
     * =========================================================================
     * Audit
     * =========================================================================
     */

    async auditScore(data) {

        if (
            !this.auditService
        ) {

            if (
                this.config.audit.required
            ) {
                throw new LoanCreditScoringError(
                    'Audit service is required but unavailable',
                    {
                        scoreId:
                            data.scoreId
                    },
                    {
                        code:
                            'AUDIT_SERVICE_UNAVAILABLE'
                    }
                );
            }

            return;
        }

        try {

            if (
                typeof this.auditService.log !==
                'function'
            ) {
                throw new Error(
                    'Audit service does not implement log()'
                );
            }

            await this.auditService.log({
                tenantId:
                    data.tenantId,

                applicantId:
                    data.applicantId,

                action:
                    data.auditType,

                eventType:
                    data.auditType,

                entityType:
                    'LOAN_CREDIT_SCORE',

                entityId:
                    data.scoreId,

                correlationId:
                    data.correlationId ||
                    null,

                idempotencyKey:
                    data.idempotencyKey ||
                    null,

                data: {
                    creditScore:
                        data.creditScore,

                    baseScore:
                        data.baseScore,

                    riskLevel:
                        data.riskLevel,

                    decision:
                        data.decision,

                    controls:
                        data.controls,

                    inputFingerprint:
                        data.inputFingerprint,

                    scoreIntegrity:
                        data.scoreIntegrity,

                    scoringVersion:
                        data.scoringVersion
                }
            });

        } catch (error) {

            this.safeLog(
                'error',
                '[LoanCreditScoringService] Audit logging failed',
                {
                    scoreId:
                        data.scoreId,

                    tenantId:
                        data.tenantId,

                    error:
                        error.message
                }
            );

            if (
                this.config.audit.required
            ) {
                throw new LoanCreditScoringError(
                    'Loan credit scoring audit failed',
                    {
                        scoreId:
                            data.scoreId,

                        tenantId:
                            data.tenantId,

                        originalError:
                            error.message
                    },
                    {
                        code:
                            'CREDIT_SCORING_AUDIT_FAILED',
                        cause:
                            error
                    }
                );
            }
        }
    }

    /**
     * =========================================================================
     * Score Identifier
     * =========================================================================
     *
     * Deterministic score identifier.
     *
     * Identical scoring inputs under the same scoring version produce the same
     * score identity.
     */
    generateScoreId(
        tenantId,
        applicantId,
        loanData,
        inputFingerprint
    ) {

        const loanReference =
            this.normalizeIdentifier(
                loanData.loanId ||
                loanData.applicationId ||
                loanData.reference ||
                'NO_LOAN_REFERENCE'
            );

        const digest =
            crypto
                .createHash('sha256')
                .update(
                    [
                        tenantId,
                        applicantId,
                        loanReference,
                        inputFingerprint,
                        this.getScoringVersion()
                    ].join('|')
                )
                .digest('hex')
                .substring(0, 32);

        return `SCORE-${digest}`;
    }

    /**
     * =========================================================================
     * Input Fingerprint
     * =========================================================================
     */

    generateInputFingerprint(payload) {

        return crypto
            .createHash('sha256')
            .update(
                this.stableSerialize(
                    payload
                )
            )
            .digest('hex');
    }

    /**
     * =========================================================================
     * Score Integrity
     * =========================================================================
     */

    generateScoreIntegrityHash(payload) {

        const canonical =
            this.stableSerialize(
                payload
            );

        return crypto
            .createHash('sha256')
            .update(canonical)
            .digest('hex');
    }

    /**
     * =========================================================================
     * Deterministic Serialization
     * =========================================================================
     */

    stableSerialize(value) {

        if (
            value === null
        ) {
            return 'null';
        }

        if (
            value === undefined
        ) {
            return '"__undefined__"';
        }

        if (
            value instanceof Date
        ) {
            return JSON.stringify(
                value.toISOString()
            );
        }

        if (
            typeof value === 'number'
        ) {

            if (
                !Number.isFinite(value)
            ) {
                return JSON.stringify(
                    String(value)
                );
            }

            return JSON.stringify(
                value
            );
        }

        if (
            typeof value !== 'object'
        ) {
            return JSON.stringify(
                value
            );
        }

        if (
            Array.isArray(value)
        ) {
            return (
                '[' +
                value
                    .map(item =>
                        this.stableSerialize(
                            item
                        )
                    )
                    .join(',') +
                ']'
            );
        }

        return (
            '{' +
            Object.keys(value)
                .sort()
                .map(key =>
                    JSON.stringify(key) +
                    ':' +
                    this.stableSerialize(
                        value[key]
                    )
                )
                .join(',') +
            '}'
        );
    }

    /**
     * =========================================================================
     * Utility Functions
     * =========================================================================
     */

    normalizeIdentifier(value) {

        if (
            value === null ||
            value === undefined
        ) {
            return null;
        }

        const normalized =
            typeof value === 'object' &&
            typeof value.toString ===
                'function'
                ? value.toString()
                : String(value);

        const trimmed =
            normalized.trim();

        return trimmed ||
            null;
    }

    clamp(
        value,
        min,
        max
    ) {

        const number =
            Number(value);

        if (
            !Number.isFinite(number)
        ) {
            return min;
        }

        return Math.min(
            max,
            Math.max(
                min,
                number
            )
        );
    }

    roundScore(value) {

        return (
            Math.round(
                (
                    Number(value) +
                    Number.EPSILON
                ) *
                100
            ) /
            100
        );
    }

    roundPrecision(
        value,
        precision = 12
    ) {

        const factor =
            10 ** precision;

        return (
            Math.round(
                (
                    Number(value) +
                    Number.EPSILON
                ) *
                factor
            ) /
            factor
        );
    }

    safeOptionalNumber(value) {

        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return null;
        }

        const number =
            Number(value);

        return Number.isFinite(number)
            ? number
            : null;
    }

    deepFreeze(object) {

        if (
            !object ||
            typeof object !== 'object' ||
            Object.isFrozen(object)
        ) {
            return object;
        }

        Object.freeze(object);

        Object.keys(object)
            .forEach(key => {

                const value =
                    object[key];

                if (
                    value &&
                    typeof value === 'object'
                ) {
                    this.deepFreeze(
                        value
                    );
                }
            });

        return object;
    }

    safeLog(
        level,
        message,
        metadata
    ) {

        try {

            if (
                logger &&
                typeof logger[level] ===
                'function'
            ) {
                logger[level](
                    message,
                    metadata
                );
            }

        } catch (error) {
            // Logging must never break credit/risk workflows.
        }
    }
}

/**
 * ============================================================================
 * Singleton Export
 * ============================================================================
 *
 * Preserves existing import contract:
 *
 *   const loanCreditScoringService =
 *       require('./LoanCreditScoringService');
 *
 * ============================================================================
 */

module.exports =
    new LoanCreditScoringService();

/**
 * Optional named exports for testing and dependency injection.
 */

module.exports.LoanCreditScoringService =
    LoanCreditScoringService;

module.exports.LoanCreditScoringError =
    LoanCreditScoringError;

module.exports.RISK_LEVEL =
    RISK_LEVEL;

module.exports.DECISION =
    DECISION;

module.exports.DEFAULT_CONFIG =
    DEFAULT_CONFIG;

module.exports.SCORE_MIN =
    SCORE_MIN;

module.exports.SCORE_MAX =
    SCORE_MAX;