'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * AIRepairRecommendationEngine
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/ai/AIRepairRecommendationEngine.js
 *
 * Purpose:
 *   Enterprise decision-support engine for statement repair recommendations.
 *
 * Responsibilities:
 *
 *   - Convert repair classifications into actionable recommendations
 *   - Prioritize repair candidates
 *   - Assess financial / operational risk
 *   - Determine recommended execution mode
 *   - Determine approval requirements
 *   - Identify missing evidence
 *   - Detect unsafe automation conditions
 *   - Generate explainable recommendation reasons
 *   - Produce deterministic recommendation IDs
 *   - Support batch recommendation processing
 *   - Preserve separation between intelligence and transaction execution
 *
 * IMPORTANT:
 *
 *   This module DOES NOT:
 *
 *   - modify ledger records
 *   - create journal entries
 *   - post financial transactions
 *   - execute repairs
 *   - approve repairs
 *   - settle payments
 *   - mutate statements
 *
 *   It produces recommendations for downstream workflow services.
 *
 * ============================================================================
 */

const crypto =
    require('crypto');

const MODULE_NAME =
    'AIRepairRecommendationEngine';

const MODULE_VERSION =
    '1.0.0';

const MODULE_TYPE =
    'STATEMENT_REPAIR_RECOMMENDATION_ENGINE';

/**
 * ============================================================================
 * Optional Dependencies
 * ============================================================================
 */

let AIRepairClassifier = null;

try {

    AIRepairClassifier =
        require(
            './AIRepairClassifier'
        );

} catch (
    error
) {

    AIRepairClassifier = null;
}

let AIConfidenceScorer = null;

try {

    AIConfidenceScorer =
        require(
            './AIConfidenceScorer'
        );

} catch (
    error
) {

    AIConfidenceScorer = null;
}

/**
 * ============================================================================
 * Repair Types
 * ============================================================================
 */

const REPAIR_TYPE =
    Object.freeze({

        MISSING_LEDGER_ENTRY:
            'MISSING_LEDGER_ENTRY',

        DUPLICATE_LEDGER_ENTRY:
            'DUPLICATE_LEDGER_ENTRY',

        AMOUNT_VARIANCE:
            'AMOUNT_VARIANCE',

        LOAN_REPAYMENT_VARIANCE:
            'LOAN_REPAYMENT_VARIANCE',

        FAILED_SETTLEMENT_POSTING:
            'FAILED_SETTLEMENT_POSTING',

        UNMATCHED_TRANSACTION:
            'UNMATCHED_TRANSACTION',

        INCORRECT_ACCOUNT_MAPPING:
            'INCORRECT_ACCOUNT_MAPPING',

        INCORRECT_TRANSACTION_DATE:
            'INCORRECT_TRANSACTION_DATE',

        INCORRECT_TRANSACTION_REFERENCE:
            'INCORRECT_TRANSACTION_REFERENCE',

        CURRENCY_MISMATCH:
            'CURRENCY_MISMATCH',

        UNKNOWN_REPAIR:
            'UNKNOWN_REPAIR'
    });

/**
 * ============================================================================
 * Recommendation Types
 * ============================================================================
 */

const RECOMMENDATION_TYPE =
    Object.freeze({

        CREATE_LEDGER_ENTRY:
            'CREATE_LEDGER_ENTRY',

        REVERSE_DUPLICATE:
            'REVERSE_DUPLICATE',

        INVESTIGATE_AMOUNT_VARIANCE:
            'INVESTIGATE_AMOUNT_VARIANCE',

        REVIEW_LOAN_REPAYMENT:
            'REVIEW_LOAN_REPAYMENT',

        RETRY_SETTLEMENT_POSTING:
            'RETRY_SETTLEMENT_POSTING',

        MATCH_TRANSACTION:
            'MATCH_TRANSACTION',

        CORRECT_ACCOUNT_MAPPING:
            'CORRECT_ACCOUNT_MAPPING',

        CORRECT_TRANSACTION_DATE:
            'CORRECT_TRANSACTION_DATE',

        CORRECT_TRANSACTION_REFERENCE:
            'CORRECT_TRANSACTION_REFERENCE',

        INVESTIGATE_CURRENCY_MISMATCH:
            'INVESTIGATE_CURRENCY_MISMATCH',

        MANUAL_INVESTIGATION:
            'MANUAL_INVESTIGATION'
    });

/**
 * ============================================================================
 * Recommendation Status
 * ============================================================================
 */

const RECOMMENDATION_STATUS =
    Object.freeze({

        RECOMMENDED:
            'RECOMMENDED',

        REVIEW_REQUIRED:
            'REVIEW_REQUIRED',

        BLOCKED:
            'BLOCKED',

        INSUFFICIENT_EVIDENCE:
            'INSUFFICIENT_EVIDENCE',

        DEFERRED:
            'DEFERRED',

        NOT_RECOMMENDED:
            'NOT_RECOMMENDED'
    });

/**
 * ============================================================================
 * Execution Modes
 * ============================================================================
 */

const EXECUTION_MODE =
    Object.freeze({

        AUTOMATIC:
            'AUTOMATIC',

        SUPERVISED:
            'SUPERVISED',

        MANUAL:
            'MANUAL',

        ADVISORY:
            'ADVISORY',

        BLOCKED:
            'BLOCKED'
    });

/**
 * ============================================================================
 * Approval Levels
 * ============================================================================
 */

const APPROVAL_LEVEL =
    Object.freeze({

        NONE:
            'NONE',

        OPERATOR:
            'OPERATOR',

        FINANCE_REVIEW:
            'FINANCE_REVIEW',

        SENIOR_FINANCE:
            'SENIOR_FINANCE',

        DUAL_CONTROL:
            'DUAL_CONTROL'
    });

/**
 * ============================================================================
 * Risk Levels
 * ============================================================================
 */

const RISK_LEVEL =
    Object.freeze({

        LOW:
            'LOW',

        MEDIUM:
            'MEDIUM',

        HIGH:
            'HIGH',

        CRITICAL:
            'CRITICAL'
    });

/**
 * ============================================================================
 * Priority
 * ============================================================================
 */

const PRIORITY =
    Object.freeze({

        P0:
            'P0',

        P1:
            'P1',

        P2:
            'P2',

        P3:
            'P3',

        P4:
            'P4'
    });

/**
 * ============================================================================
 * Evidence Requirements
 * ============================================================================
 */

const EVIDENCE_REQUIREMENT =
    Object.freeze({

        STATEMENT:
            'STATEMENT',

        LEDGER:
            'LEDGER',

        SETTLEMENT:
            'SETTLEMENT',

        ACCOUNT:
            'ACCOUNT',

        LOAN:
            'LOAN',

        PAYMENT_PROVIDER:
            'PAYMENT_PROVIDER',

        TRANSACTION_REFERENCE:
            'TRANSACTION_REFERENCE',

        HISTORICAL:
            'HISTORICAL',

        APPROVAL:
            'APPROVAL'
    });

/**
 * ============================================================================
 * Defaults
 * ============================================================================
 */

const DEFAULT_CONFIG =
    Object.freeze({

        minimumRecommendationConfidence:
            0.70,

        automaticExecutionConfidence:
            0.92,

        supervisedExecutionConfidence:
            0.80,

        criticalRiskThreshold:
            0.80,

        highRiskThreshold:
            0.60,

        financialImpactThresholds:
            Object.freeze({

                low:
                    100,

                medium:
                    1000,

                high:
                    10000,

                critical:
                    100000
            }),

        defaultCurrency:
            'UGX',

        maximumBatchSize:
            1000,

        duplicateSimilarityThreshold:
            0.95,

        recommendationVersion:
            '1.0',

        priorityWeights:
            Object.freeze({

                severity:
                    0.20,

                confidence:
                    0.25,

                financialImpact:
                    0.20,

                aging:
                    0.10,

                recurrence:
                    0.10,

                operationalRisk:
                    0.10,

                regulatoryRisk:
                    0.05
            }),

        amountTolerance:
            0.01,

        agingThresholds:
            Object.freeze({

                p0:
                    30,

                p1:
                    14,

                p2:
                    7,

                p3:
                    2
            })
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class AIRepairRecommendationEngineError
    extends Error {

    constructor(
        message,
        code = 'AI_REPAIR_RECOMMENDATION_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'AIRepairRecommendationEngineError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            AIRepairRecommendationEngineError
        );
    }
}

/**
 * ============================================================================
 * Numeric Utilities
 * ============================================================================
 */

function toNumber(
    value,
    fallback = 0
) {

    const number =
        Number(value);

    return Number.isFinite(
        number
    )
        ? number
        : fallback;
}

function clamp(
    value,
    minimum = 0,
    maximum = 1
) {

    return Math.min(
        Math.max(
            toNumber(
                value
            ),
            minimum
        ),
        maximum
    );
}

function round(
    value,
    decimals = 6
) {

    const factor =
        Math.pow(
            10,
            decimals
        );

    return Math.round(
        (
            toNumber(value) +
            Number.EPSILON
        ) *
        factor
    ) /
    factor;
}

function normalizeScore(
    value
) {

    const number =
        toNumber(
            value
        );

    if (
        Math.abs(number) >
        1
    ) {

        return clamp(
            number /
            100
        );
    }

    return clamp(
        number
    );
}

/**
 * ============================================================================
 * String Utilities
 * ============================================================================
 */

function normalizeString(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return '';
    }

    return String(
        value
    )
        .trim()
        .toUpperCase();
}

function hasValue(
    value
) {

    return (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ''
    );
}

/**
 * ============================================================================
 * Date Utilities
 * ============================================================================
 */

function parseDate(
    value
) {

    if (
        !hasValue(value)
    ) {

        return null;
    }

    const date =
        new Date(
            value
        );

    return Number.isNaN(
        date.getTime()
    )
        ? null
        : date;
}

function daysSince(
    value,
    now = new Date()
) {

    const date =
        parseDate(
            value
        );

    if (
        !date
    ) {

        return 0;
    }

    return Math.max(
        0,
        (
            now.getTime() -
            date.getTime()
        ) /
        (
            1000 *
            60 *
            60 *
            24
        )
    );
}

/**
 * ============================================================================
 * Hash / ID Utilities
 * ============================================================================
 */

function stableSerialize(
    value
) {

    if (
        value === null ||
        typeof value !== 'object'
    ) {

        return JSON.stringify(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {

        return `[${value
            .map(
                item =>
                    stableSerialize(
                        item
                    )
            )
            .join(',')}]`;
    }

    return `{${Object.keys(value)
        .sort()
        .map(
            key =>
                `${JSON.stringify(key)}:${stableSerialize(value[key])}`
        )
        .join(',')}}`;
}

function hash(
    value
) {

    return crypto
        .createHash(
            'sha256'
        )
        .update(
            stableSerialize(
                value
            )
        )
        .digest(
            'hex'
        );
}

function generateRecommendationId(
    input,
    recommendationType
) {

    const transactionReference =
        input.transactionReference ??
        input.reference ??
        input.statementTransactionId ??
        input.transactionId ??
        '';

    const fingerprint =
        {

            tenantId:
                input.tenantId ??
                null,

            statementId:
                input.statementId ??
                null,

            transactionId:
                input.transactionId ??
                null,

            transactionReference,

            repairType:
                input.repairType ??
                input.classification?.type ??
                null,

            recommendationType,

            amount:
                input.amount ??
                input.statementAmount ??
                null,

            currency:
                input.currency ??
                null
        };

    return `RR-${hash(
        fingerprint
    ).slice(
        0,
        24
    )}`;
}

/**
 * ============================================================================
 * Severity Normalization
 * ============================================================================
 */

const SEVERITY_SCORE =
    Object.freeze({

        INFO:
            0.10,

        LOW:
            0.25,

        MEDIUM:
            0.50,

        HIGH:
            0.75,

        CRITICAL:
            1.00
    });

function severityScore(
    severity
) {

    return (
        SEVERITY_SCORE[
            normalizeString(
                severity
            )
        ] ||
        0
    );
}

/**
 * ============================================================================
 * Repair Recommendation Profiles
 * ============================================================================
 */

const RECOMMENDATION_PROFILES =
    Object.freeze({

        [REPAIR_TYPE.MISSING_LEDGER_ENTRY]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .CREATE_LEDGER_ENTRY,

                severity:
                    'HIGH',

                defaultRisk:
                    'HIGH',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER,
                    EVIDENCE_REQUIREMENT
                        .TRANSACTION_REFERENCE
                ],

                approval:
                    APPROVAL_LEVEL
                        .FINANCE_REVIEW,

                automationAllowed:
                    true
            }),

        [REPAIR_TYPE.DUPLICATE_LEDGER_ENTRY]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .REVERSE_DUPLICATE,

                severity:
                    'HIGH',

                defaultRisk:
                    'HIGH',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER,
                    EVIDENCE_REQUIREMENT
                        .TRANSACTION_REFERENCE
                ],

                approval:
                    APPROVAL_LEVEL
                        .DUAL_CONTROL,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.AMOUNT_VARIANCE]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .INVESTIGATE_AMOUNT_VARIANCE,

                severity:
                    'HIGH',

                defaultRisk:
                    'HIGH',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER
                ],

                approval:
                    APPROVAL_LEVEL
                        .FINANCE_REVIEW,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.LOAN_REPAYMENT_VARIANCE]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .REVIEW_LOAN_REPAYMENT,

                severity:
                    'HIGH',

                defaultRisk:
                    'HIGH',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LOAN,
                    EVIDENCE_REQUIREMENT
                        .LEDGER
                ],

                approval:
                    APPROVAL_LEVEL
                        .FINANCE_REVIEW,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.FAILED_SETTLEMENT_POSTING]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .RETRY_SETTLEMENT_POSTING,

                severity:
                    'CRITICAL',

                defaultRisk:
                    'CRITICAL',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .SETTLEMENT,
                    EVIDENCE_REQUIREMENT
                        .PAYMENT_PROVIDER
                ],

                approval:
                    APPROVAL_LEVEL
                        .SENIOR_FINANCE,

                automationAllowed:
                    true
            }),

        [REPAIR_TYPE.UNMATCHED_TRANSACTION]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .MATCH_TRANSACTION,

                severity:
                    'MEDIUM',

                defaultRisk:
                    'MEDIUM',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER
                ],

                approval:
                    APPROVAL_LEVEL
                        .OPERATOR,

                automationAllowed:
                    true
            }),

        [REPAIR_TYPE.INCORRECT_ACCOUNT_MAPPING]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .CORRECT_ACCOUNT_MAPPING,

                severity:
                    'HIGH',

                defaultRisk:
                    'HIGH',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER,
                    EVIDENCE_REQUIREMENT
                        .ACCOUNT
                ],

                approval:
                    APPROVAL_LEVEL
                        .FINANCE_REVIEW,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.INCORRECT_TRANSACTION_DATE]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .CORRECT_TRANSACTION_DATE,

                severity:
                    'MEDIUM',

                defaultRisk:
                    'MEDIUM',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER
                ],

                approval:
                    APPROVAL_LEVEL
                        .OPERATOR,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.INCORRECT_TRANSACTION_REFERENCE]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .CORRECT_TRANSACTION_REFERENCE,

                severity:
                    'LOW',

                defaultRisk:
                    'LOW',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .TRANSACTION_REFERENCE
                ],

                approval:
                    APPROVAL_LEVEL
                        .OPERATOR,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.CURRENCY_MISMATCH]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .INVESTIGATE_CURRENCY_MISMATCH,

                severity:
                    'CRITICAL',

                defaultRisk:
                    'CRITICAL',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT,
                    EVIDENCE_REQUIREMENT
                        .LEDGER,
                    EVIDENCE_REQUIREMENT
                        .HISTORICAL
                ],

                approval:
                    APPROVAL_LEVEL
                        .DUAL_CONTROL,

                automationAllowed:
                    false
            }),

        [REPAIR_TYPE.UNKNOWN_REPAIR]:
            Object.freeze({

                recommendationType:
                    RECOMMENDATION_TYPE
                        .MANUAL_INVESTIGATION,

                severity:
                    'HIGH',

                defaultRisk:
                    'HIGH',

                requiredEvidence: [
                    EVIDENCE_REQUIREMENT
                        .STATEMENT
                ],

                approval:
                    APPROVAL_LEVEL
                        .FINANCE_REVIEW,

                automationAllowed:
                    false
            })
    });

/**
 * ============================================================================
 * Evidence Assessment
 * ============================================================================
 */

function normalizeEvidence(
    input = {}
) {

    const evidence =
        Array.isArray(
            input.evidence
        )
            ? input.evidence
            : [];

    return evidence.map(
        item => ({

            type:
                normalizeString(
                    item?.type
                ),

            score:
                normalizeScore(
                    item?.score ??
                    item?.confidence ??
                    item?.strength
                ),

            source:
                item?.source ??
                null,

            reference:
                item?.reference ??
                item?.referenceId ??
                null,

            description:
                item?.description ??
                null
        })
    );
}

function assessEvidence(
    input,
    profile
) {

    const evidence =
        normalizeEvidence(
            input
        );

    const availableTypes =
        new Set(
            evidence.map(
                item =>
                    item.type
            )
        );

    const missing =
        profile.requiredEvidence
            .filter(
                requirement =>
                    !availableTypes.has(
                        requirement
                    )
            );

    const directEvidence =
        evidence.length
            ? evidence.reduce(
                (
                    total,
                    item
                ) =>
                    total +
                    item.score,
                0
            ) /
            evidence.length
            : 0;

    const completeness =
        profile.requiredEvidence.length === 0
            ? 1
            : (
                profile.requiredEvidence.length -
                missing.length
            ) /
            profile.requiredEvidence.length;

    const quality =
        clamp(
            (
                directEvidence *
                0.60
            ) +
            (
                completeness *
                0.40
            )
        );

    return {

        available:
            evidence.length,

        required:
            profile.requiredEvidence.length,

        missing,

        complete:
            missing.length === 0,

        completeness:
            round(
                completeness
            ),

        quality:
            round(
                quality
            ),

        evidence
    };
}

/**
 * ============================================================================
 * Financial Impact Assessment
 * ============================================================================
 */

function assessFinancialImpact(
    input,
    config
) {

    const amount =
        Math.abs(
            toNumber(
                input.amount ??
                input.statementAmount ??
                input.transactionAmount ??
                input.varianceAmount
            )
        );

    const currency =
        input.currency ??
        input.statementCurrency ??
        config.defaultCurrency;

    const absoluteThresholds =
        config.financialImpactThresholds;

    let level =
        'LOW';

    if (
        amount >=
        absoluteThresholds.critical
    ) {

        level =
            'CRITICAL';

    } else if (
        amount >=
        absoluteThresholds.high
    ) {

        level =
            'HIGH';

    } else if (
        amount >=
        absoluteThresholds.medium
    ) {

        level =
            'MEDIUM';
    }

    const maximumThreshold =
        Math.max(
            absoluteThresholds.critical,
            1
        );

    const score =
        clamp(
            amount /
            maximumThreshold
        );

    return {

        amount:
            round(
                amount,
                2
            ),

        currency,

        level,

        score:
            round(
                score
            ),

        material:
            level === 'HIGH' ||
            level === 'CRITICAL'
    };
}

/**
 * ============================================================================
 * Risk Assessment
 * ============================================================================
 */

function assessRisk(
    input,
    classification,
    financialImpact,
    evidence,
    config
) {

    const factors =
        [];

    let score =
        0;

    const classificationRisk =
        normalizeScore(
            classification
                ?.automationRisk
        );

    if (
        classificationRisk > 0
    ) {

        score +=
            classificationRisk *
            0.25;

        factors.push({

            factor:
                'classification_automation_risk',

            score:
                classificationRisk
        });
    }

    const severity =
        severityScore(
            classification?.severity
        );

    score +=
        severity *
        0.20;

    factors.push({

        factor:
            'repair_severity',

        score:
            severity
    });

    score +=
        financialImpact.score *
        0.25;

    factors.push({

        factor:
            'financial_impact',

        score:
            financialImpact.score
    });

    const evidenceRisk =
        1 -
        evidence.quality;

    score +=
        evidenceRisk *
        0.20;

    factors.push({

        factor:
            'evidence_gap',

        score:
            evidenceRisk
    });

    const recurrence =
        normalizeScore(
            input.recurrenceRisk ??
            input.recurrence
        );

    if (
        recurrence > 0
    ) {

        score +=
            recurrence *
            0.10;

        factors.push({

            factor:
                'recurrence',

            score:
                recurrence
        });
    }

    score =
        clamp(
            score
        );

    let level =
        RISK_LEVEL.LOW;

    if (
        score >=
        config.criticalRiskThreshold
    ) {

        level =
            RISK_LEVEL.CRITICAL;

    } else if (
        score >=
        config.highRiskThreshold
    ) {

        level =
            RISK_LEVEL.HIGH;

    } else if (
        score >=
        0.30
    ) {

        level =
            RISK_LEVEL.MEDIUM;
    }

    return {

        score:
            round(
                score
            ),

        level,

        factors
    };
}

/**
 * ============================================================================
 * Regulatory / Period-Close Risk
 * ============================================================================
 */

function assessControlRisk(
    input
) {

    const risks =
        [];

    if (
        input.periodClosed === true
    ) {

        risks.push({

            type:
                'CLOSED_PERIOD',

            severity:
                RISK_LEVEL.CRITICAL
        });
    }

    if (
        input.periodClosing === true
    ) {

        risks.push({

            type:
                'PERIOD_CLOSING',

            severity:
                RISK_LEVEL.HIGH
        });
    }

    if (
        input.regulatoryReportAffected === true
    ) {

        risks.push({

            type:
                'REGULATORY_REPORT_IMPACT',

            severity:
                RISK_LEVEL.CRITICAL
        });
    }

    if (
        input.auditLocked === true
    ) {

        risks.push({

            type:
                'AUDIT_LOCKED_RECORD',

            severity:
                RISK_LEVEL.CRITICAL
        });
    }

    if (
        input.requiresDualControl === true
    ) {

        risks.push({

            type:
                'DUAL_CONTROL_REQUIRED',

            severity:
                RISK_LEVEL.HIGH
        });
    }

    const critical =
        risks.some(
            risk =>
                risk.severity ===
                RISK_LEVEL.CRITICAL
        );

    const high =
        risks.some(
            risk =>
                risk.severity ===
                RISK_LEVEL.HIGH
        );

    return {

        risks,

        blocked:
            critical,

        level:
            critical
                ? RISK_LEVEL.CRITICAL
                : high
                    ? RISK_LEVEL.HIGH
                    : RISK_LEVEL.LOW
    };
}

/**
 * ============================================================================
 * Priority Calculation
 * ============================================================================
 */

function calculatePriority(
    input,
    classification,
    confidence,
    financialImpact,
    risk,
    config
) {

    const weights =
        config.priorityWeights;

    const severity =
        severityScore(
            classification?.severity
        );

    const confidenceScore =
        normalizeScore(
            confidence?.score ??
            classification?.score
        );

    const financialScore =
        financialImpact.score;

    const agingDays =
        daysSince(
            input.detectedAt ??
            input.createdAt ??
            input.statementDate
        );

    let agingScore =
        0;

    if (
        agingDays >=
        config.agingThresholds.p0
    ) {

        agingScore =
            1;

    } else if (
        agingDays >=
        config.agingThresholds.p1
    ) {

        agingScore =
            0.80;

    } else if (
        agingDays >=
        config.agingThresholds.p2
    ) {

        agingScore =
            0.60;

    } else if (
        agingDays >=
        config.agingThresholds.p3
    ) {

        agingScore =
            0.40;

    } else {

        agingScore =
            0.20;
    }

    const recurrence =
        normalizeScore(
            input.recurrenceRisk ??
            input.recurrence
        );

    const operationalRisk =
        risk.score;

    const regulatoryRisk =
        input.regulatoryReportAffected ||
        input.auditLocked
            ? 1
            : 0;

    const score =

        (
            severity *
            weights.severity
        ) +

        (
            confidenceScore *
            weights.confidence
        ) +

        (
            financialScore *
            weights.financialImpact
        ) +

        (
            agingScore *
            weights.aging
        ) +

        (
            recurrence *
            weights.recurrence
        ) +

        (
            operationalRisk *
            weights.operationalRisk
        ) +

        (
            regulatoryRisk *
            weights.regulatoryRisk
        );

    let priority =
        PRIORITY.P4;

    if (
        risk.level ===
        RISK_LEVEL.CRITICAL ||
        regulatoryRisk === 1 ||
        score >= 0.85
    ) {

        priority =
            PRIORITY.P0;

    } else if (
        score >= 0.70
    ) {

        priority =
            PRIORITY.P1;

    } else if (
        score >= 0.50
    ) {

        priority =
            PRIORITY.P2;

    } else if (
        score >= 0.30
    ) {

        priority =
            PRIORITY.P3;
    }

    return {

        score:
            round(
                score
            ),

        priority,

        agingDays:
            round(
                agingDays,
                2
            )
    };
}

/**
 * ============================================================================
 * Approval Determination
 * ============================================================================
 */

function determineApprovalLevel(
    profile,
    risk,
    financialImpact,
    controlRisk,
    input
) {

    if (
        controlRisk.blocked
    ) {

        return APPROVAL_LEVEL
            .DUAL_CONTROL;
    }

    if (
        input.requiresDualControl === true
    ) {

        return APPROVAL_LEVEL
            .DUAL_CONTROL;
    }

    if (
        risk.level ===
        RISK_LEVEL.CRITICAL
    ) {

        return APPROVAL_LEVEL
            .DUAL_CONTROL;
    }

    if (
        financialImpact.level ===
        'CRITICAL'
    ) {

        return APPROVAL_LEVEL
            .DUAL_CONTROL;
    }

    if (
        financialImpact.level ===
        'HIGH'
    ) {

        return APPROVAL_LEVEL
            .SENIOR_FINANCE;
    }

    return profile.approval;
}

/**
 * ============================================================================
 * Execution Mode
 * ============================================================================
 */

function determineExecutionMode(
    profile,
    confidence,
    risk,
    evidence,
    controlRisk,
    input,
    config
) {

    if (
        controlRisk.blocked
    ) {

        return EXECUTION_MODE
            .BLOCKED;
    }

    if (
        risk.level ===
        RISK_LEVEL.CRITICAL
    ) {

        return EXECUTION_MODE
            .BLOCKED;
    }

    if (
        !evidence.complete
    ) {

        return EXECUTION_MODE
            .MANUAL;
    }

    const confidenceScore =
        normalizeScore(
            confidence?.score
        );

    if (
        profile.automationAllowed &&
        confidenceScore >=
        config.automaticExecutionConfidence &&
        risk.level ===
        RISK_LEVEL.LOW &&
        input.allowAutomaticExecution !== false
    ) {

        return EXECUTION_MODE
            .AUTOMATIC;
    }

    if (
        confidenceScore >=
        config.supervisedExecutionConfidence
    ) {

        return EXECUTION_MODE
            .SUPERVISED;
    }

    return EXECUTION_MODE
        .ADVISORY;
}

/**
 * ============================================================================
 * Recommendation Status
 * ============================================================================
 */

function determineRecommendationStatus(
    confidence,
    evidence,
    risk,
    controlRisk,
    executionMode,
    config
) {

    if (
        controlRisk.blocked ||
        executionMode ===
        EXECUTION_MODE.BLOCKED
    ) {

        return RECOMMENDATION_STATUS
            .BLOCKED;
    }

    if (
        !evidence.complete
    ) {

        return RECOMMENDATION_STATUS
            .INSUFFICIENT_EVIDENCE;
    }

    if (
        normalizeScore(
            confidence?.score
        ) <
        config.minimumRecommendationConfidence
    ) {

        return RECOMMENDATION_STATUS
            .NOT_RECOMMENDED;
    }

    if (
        executionMode ===
        EXECUTION_MODE.SUPERVISED ||
        executionMode ===
        EXECUTION_MODE.MANUAL
    ) {

        return RECOMMENDATION_STATUS
            .REVIEW_REQUIRED;
    }

    return RECOMMENDATION_STATUS
        .RECOMMENDED;
}

/**
 * ============================================================================
 * Confidence Adapter
 * ============================================================================
 */

function calculateConfidence(
    input,
    classification,
    evidence,
    risk
) {

    const existingConfidence =
        input.confidence ??
        input.classification?.confidence ??
        input.confidenceScore;

    if (
        existingConfidence !==
        undefined
    ) {

        return {

            score:
                normalizeScore(
                    existingConfidence
                ),

            source:
                'UPSTREAM_CLASSIFIER',

            confidenceLevel:
                normalizeScore(
                    existingConfidence
                ) >= 0.90
                    ? 'VERY_HIGH'
                    : normalizeScore(
                        existingConfidence
                    ) >= 0.75
                        ? 'HIGH'
                        : normalizeScore(
                            existingConfidence
                        ) >= 0.60
                            ? 'MEDIUM'
                            : 'LOW'
        };
    }

    if (
        AIConfidenceScorer &&
        typeof AIConfidenceScorer
            .calculateConfidence ===
        'function'
    ) {

        const result =
            AIConfidenceScorer
                .calculateConfidence(
                    {

                        observations:
                            evidence.available,

                        completeness:
                            evidence.completeness,

                        validity:
                            input.validity,

                        consistency:
                            input.consistency,

                        accuracy:
                            classification.score,

                        directEvidence:
                            evidence.quality,

                        corroboration:
                            input.corroboration,

                        historicalAccuracy:
                            input.historicalAccuracy,

                        explainability:
                            evidence.complete
                                ? 0.90
                                : 0.50,

                        riskLevel:
                            risk.level,

                        criticalIssue:
                            risk.level ===
                            RISK_LEVEL.CRITICAL
                    }
                );

        if (
            result
        ) {

            return result;
        }
    }

    /*
     * Deterministic fallback.
     */
    const score =
        clamp(
            (
                classification.score *
                0.45
            ) +
            (
                evidence.quality *
                0.35
            ) +
            (
                (
                    1 -
                    risk.score
                ) *
                0.20
            )
        );

    return {

        score:
            round(
                score
            ),

        source:
            'DETERMINISTIC_FALLBACK',

        confidenceLevel:
            score >= 0.90
                ? 'VERY_HIGH'
                : score >= 0.75
                    ? 'HIGH'
                    : score >= 0.60
                        ? 'MEDIUM'
                        : 'LOW'
    };
}

/**
 * ============================================================================
 * Action Plan
 * ============================================================================
 */

function buildActionPlan(
    recommendationType,
    input,
    classification
) {

    switch (
        recommendationType
    ) {

        case RECOMMENDATION_TYPE
            .CREATE_LEDGER_ENTRY:

            return {

                phase:
                    'LEDGER_REPAIR',

                steps: [

                    'Validate source statement transaction.',

                    'Verify transaction is absent from the ledger.',

                    'Resolve the correct ledger account mapping.',

                    'Verify debit/credit treatment.',

                    'Verify amount and currency.',

                    'Require configured financial approval.',

                    'Execute repair through StatementRepairService.',

                    'Verify resulting ledger integrity.',

                    'Persist audit trail.'
                ]
            };

        case RECOMMENDATION_TYPE
            .REVERSE_DUPLICATE:

            return {

                phase:
                    'DUPLICATE_REPAIR',

                steps: [

                    'Identify all candidate duplicate entries.',

                    'Confirm duplicate relationship.',

                    'Preserve original transaction evidence.',

                    'Require dual-control approval.',

                    'Execute reversal through transactional repair workflow.',

                    'Verify ledger remains balanced.',

                    'Persist reversal audit trail.'
                ]
            };

        case RECOMMENDATION_TYPE
            .INVESTIGATE_AMOUNT_VARIANCE:

            return {

                phase:
                    'VARIANCE_INVESTIGATION',

                steps: [

                    'Compare statement amount with ledger amount.',

                    'Calculate absolute and relative variance.',

                    'Check fees, charges, FX and settlement adjustments.',

                    'Inspect historical transaction pattern.',

                    'Determine source of variance.',

                    'Route material variance for finance review.'
                ]
            };

        case RECOMMENDATION_TYPE
            .REVIEW_LOAN_REPAYMENT:

            return {

                phase:
                    'LOAN_RECONCILIATION',

                steps: [

                    'Verify loan account.',

                    'Verify repayment schedule.',

                    'Compare expected repayment with received amount.',

                    'Check interest and penalty components.',

                    'Verify ledger posting.',

                    'Require finance review before adjustment.'
                ]
            };

        case RECOMMENDATION_TYPE
            .RETRY_SETTLEMENT_POSTING:

            return {

                phase:
                    'SETTLEMENT_REPAIR',

                steps: [

                    'Verify settlement reference.',

                    'Verify provider transaction state.',

                    'Check idempotency state.',

                    'Confirm settlement has not already posted.',

                    'Retry through settlement workflow.',

                    'Reconcile provider and ledger state.',

                    'Record provider and settlement audit events.'
                ]
            };

        case RECOMMENDATION_TYPE
            .MATCH_TRANSACTION:

            return {

                phase:
                    'RECONCILIATION',

                steps: [

                    'Search candidate ledger transactions.',

                    'Compare amount, date and reference.',

                    'Evaluate account and counterparty compatibility.',

                    'Apply matching confidence threshold.',

                    'Require review when confidence is insufficient.',

                    'Persist reconciliation decision.'
                ]
            };

        case RECOMMENDATION_TYPE
            .CORRECT_ACCOUNT_MAPPING:

            return {

                phase:
                    'ACCOUNT_MAPPING_REVIEW',

                steps: [

                    'Validate statement transaction.',

                    'Identify current ledger account.',

                    'Determine expected account.',

                    'Validate chart-of-accounts compatibility.',

                    'Require finance approval.',

                    'Apply correction through controlled repair workflow.',

                    'Verify downstream statement impact.'
                ]
            };

        case RECOMMENDATION_TYPE
            .CORRECT_TRANSACTION_DATE:

            return {

                phase:
                    'DATA_QUALITY_REPAIR',

                steps: [

                    'Compare transaction dates.',

                    'Validate value date and posting date.',

                    'Check financial period status.',

                    'Prevent modification of closed periods.',

                    'Require approval when historical posting is affected.',

                    'Apply correction through controlled workflow.'
                ]
            };

        case RECOMMENDATION_TYPE
            .CORRECT_TRANSACTION_REFERENCE:

            return {

                phase:
                    'REFERENCE_REPAIR',

                steps: [

                    'Validate source reference.',

                    'Compare provider and ledger references.',

                    'Confirm replacement reference.',

                    'Preserve original value in audit history.',

                    'Apply correction through repair workflow.'
                ]
            };

        case RECOMMENDATION_TYPE
            .INVESTIGATE_CURRENCY_MISMATCH:

            return {

                phase:
                    'CURRENCY_INVESTIGATION',

                steps: [

                    'Verify statement currency.',

                    'Verify ledger currency.',

                    'Inspect FX conversion information.',

                    'Validate applicable exchange rate.',

                    'Check settlement currency.',

                    'Require finance review.',

                    'Block automated monetary adjustment until resolved.'
                ]
            };

        default:

            return {

                phase:
                    'MANUAL_INVESTIGATION',

                steps: [

                    'Review source transaction.',

                    'Collect additional financial evidence.',

                    'Determine appropriate repair classification.',

                    'Require authorized finance review.',

                    'Do not execute automated repair.'
                ]
            };
    }
}

/**
 * ============================================================================
 * Explanation
 * ============================================================================
 */

function buildExplanation(
    result
) {

    const reasons =
        [];

    const classification =
        result.classification;

    if (
        classification?.type
    ) {

        reasons.push(
            `The transaction was classified as ${classification.type}.`
        );
    }

    if (
        result.recommendationType
    ) {

        reasons.push(
            `The recommended action is ${result.recommendationType}.`
        );
    }

    if (
        result.confidence?.score !==
        undefined
    ) {

        reasons.push(
            `Recommendation confidence is ${round(result.confidence.score * 100, 2)}%.`
        );
    }

    if (
        result.evidence?.missing?.length
    ) {

        reasons.push(
            `Additional evidence is required: ${result.evidence.missing.join(', ')}.`
        );
    }

    if (
        result.risk?.level
    ) {

        reasons.push(
            `Assessed operational risk is ${result.risk.level}.`
        );
    }

    if (
        result.financialImpact?.material
    ) {

        reasons.push(
            'The financial impact is considered material and requires controlled review.'
        );
    }

    if (
        result.controlRisk?.risks?.length
    ) {

        reasons.push(
            'Financial-control restrictions affect the recommendation.'
        );
    }

    if (
        result.executionMode
    ) {

        reasons.push(
            `Recommended execution mode is ${result.executionMode}.`
        );
    }

    return {

        summary:
            reasons.join(' '),

        reasons
    };
}

/**
 * ============================================================================
 * Main Recommendation API
 * ============================================================================
 */

function recommend(
    input = {},
    options = {}
) {

    if (
        !input ||
        typeof input !== 'object'
    ) {

        throw new AIRepairRecommendationEngineError(
            'Recommendation input must be an object.',
            'INVALID_INPUT'
        );
    }

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options || {}),

            priorityWeights: {

                ...DEFAULT_CONFIG
                    .priorityWeights,

                ...(options.priorityWeights || {})
            },

            financialImpactThresholds: {

                ...DEFAULT_CONFIG
                    .financialImpactThresholds,

                ...(options.financialImpactThresholds || {})
            },

            agingThresholds: {

                ...DEFAULT_CONFIG
                    .agingThresholds,

                ...(options.agingThresholds || {})
            }
        };

    /*
     * ------------------------------------------------------------------------
     * Classification
     * ------------------------------------------------------------------------
     */

    let classificationResult =
        input.classificationResult ??
        input.classification ??
        null;

    if (
        !classificationResult &&
        AIRepairClassifier &&
        typeof AIRepairClassifier
            .classify ===
        'function'
    ) {

        classificationResult =
            AIRepairClassifier.classify(
                input
            );
    }

    if (
        !classificationResult
    ) {

        throw new AIRepairRecommendationEngineError(
            'A repair classification is required.',
            'CLASSIFICATION_REQUIRED'
        );
    }

    const classification =
        classificationResult
            .classification ??
        classificationResult;

    const repairType =
        normalizeString(
            classification?.type ??
            input.repairType
        ) ||
        REPAIR_TYPE
            .UNKNOWN_REPAIR;

    const profile =
        RECOMMENDATION_PROFILES[
            repairType
        ] ||
        RECOMMENDATION_PROFILES[
            REPAIR_TYPE.UNKNOWN_REPAIR
        ];

    /*
     * ------------------------------------------------------------------------
     * Evidence
     * ------------------------------------------------------------------------
     */

    const evidence =
        assessEvidence(
            input,
            profile
        );

    /*
     * ------------------------------------------------------------------------
     * Financial impact
     * ------------------------------------------------------------------------
     */

    const financialImpact =
        assessFinancialImpact(
            input,
            config
        );

    /*
     * ------------------------------------------------------------------------
     * Confidence
     * ------------------------------------------------------------------------
     */

    const confidence =
        calculateConfidence(
            input,
            classification,
            evidence,
            {
                score:
                    normalizeScore(
                        classification
                            ?.riskScore ??
                        classification
                            ?.automationRisk
                    ),

                level:
                    classification
                        ?.riskLevel
            }
        );

    /*
     * ------------------------------------------------------------------------
     * Risk
     * ------------------------------------------------------------------------
     */

    const risk =
        assessRisk(
            input,
            classification,
            financialImpact,
            evidence,
            config
        );

    /*
     * ------------------------------------------------------------------------
     * Control risk
     * ------------------------------------------------------------------------
     */

    const controlRisk =
        assessControlRisk(
            input
        );

    /*
     * ------------------------------------------------------------------------
     * Priority
     * ------------------------------------------------------------------------
     */

    const priority =
        calculatePriority(
            input,
            classification,
            confidence,
            financialImpact,
            risk,
            config
        );

    /*
     * ------------------------------------------------------------------------
     * Approval
     * ------------------------------------------------------------------------
     */

    const approvalLevel =
        determineApprovalLevel(
            profile,
            risk,
            financialImpact,
            controlRisk,
            input
        );

    /*
     * ------------------------------------------------------------------------
     * Execution
     * ------------------------------------------------------------------------
     */

    const executionMode =
        determineExecutionMode(
            profile,
            confidence,
            risk,
            evidence,
            controlRisk,
            input,
            config
        );

    /*
     * ------------------------------------------------------------------------
     * Status
     * ------------------------------------------------------------------------
     */

    const status =
        determineRecommendationStatus(
            confidence,
            evidence,
            risk,
            controlRisk,
            executionMode,
            config
        );

    /*
     * ------------------------------------------------------------------------
     * Recommendation
     * ------------------------------------------------------------------------
     */

    const recommendationType =
        profile.recommendationType;

    const recommendationId =
        generateRecommendationId(
            input,
            recommendationType
        );

    const actionPlan =
        buildActionPlan(
            recommendationType,
            input,
            classification
        );

    const result = {

        success:
            true,

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        recommendationVersion:
            config.recommendationVersion,

        timestamp:
            new Date()
                .toISOString(),

        recommendationId,

        tenantId:
            input.tenantId ??
            null,

        statementId:
            input.statementId ??
            null,

        transactionId:
            input.transactionId ??
            null,

        transactionReference:
            input.transactionReference ??
            input.reference ??
            null,

        classification: {

            type:
                repairType,

            category:
                classification.category ??
                null,

            severity:
                classification.severity ??
                profile.severity,

            score:
                normalizeScore(
                    classification.score
                )
        },

        recommendationType,

        status,

        priority,

        confidence,

        risk,

        financialImpact,

        controlRisk,

        evidence,

        approval: {

            required:
                approvalLevel !==
                APPROVAL_LEVEL.NONE,

            level:
                approvalLevel
        },

        executionMode,

        automation: {

            allowed:
                profile.automationAllowed,

            eligible:
                executionMode ===
                EXECUTION_MODE.AUTOMATIC,

            reason:
                executionMode ===
                EXECUTION_MODE.AUTOMATIC
                    ? 'Confidence, evidence and risk thresholds permit automatic workflow processing.'
                    : 'Automatic execution thresholds were not satisfied.'
        },

        actionPlan,

        audit: {

            classificationSource:
                classificationResult
                    .module ??
                'AIRepairClassifier',

            recommendationEngine:
                MODULE_NAME,

            recommendationVersion:
                config.recommendationVersion
        },

        explainability:
            null
    };

    result.explainability =
        buildExplanation(
            result
        );

    return result;
}

/**
 * ============================================================================
 * Batch Recommendations
 * ============================================================================
 */

function recommendBatch(
    inputs,
    options = {}
) {

    if (
        !Array.isArray(
            inputs
        )
    ) {

        throw new AIRepairRecommendationEngineError(
            'Batch recommendation input must be an array.',
            'INVALID_BATCH_INPUT'
        );
    }

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options || {})
        };

    if (
        inputs.length >
        config.maximumBatchSize
    ) {

        throw new AIRepairRecommendationEngineError(
            `Batch size ${inputs.length} exceeds maximum ${config.maximumBatchSize}.`,
            'BATCH_SIZE_EXCEEDED',
            {

                size:
                    inputs.length,

                maximum:
                    config.maximumBatchSize
            }
        );
    }

    return inputs.map(
        (
            input,
            index
        ) => {

            try {

                return {

                    index,

                    success:
                        true,

                    result:
                        recommend(
                            input,
                            options
                        )
                };

            } catch (
                error
            ) {

                return {

                    index,

                    success:
                        false,

                    error: {

                        name:
                            error.name,

                        code:
                            error.code ||
                            'RECOMMENDATION_ERROR',

                        message:
                            error.message,

                        metadata:
                            error.metadata || {}
                    }
                };
            }
        }
    );
}

/**
 * ============================================================================
 * Recommendation Ranking
 * ============================================================================
 */

function rankRecommendations(
    recommendations = []
) {

    if (
        !Array.isArray(
            recommendations
        )
    ) {

        throw new AIRepairRecommendationEngineError(
            'Recommendations must be an array.',
            'INVALID_RECOMMENDATIONS'
        );
    }

    return [
        ...recommendations
    ]
        .filter(
            item =>
                item &&
                typeof item ===
                'object'
        )
        .sort(
            (
                first,
                second
            ) => {

                const priorityRank =
                    {

                        P0: 0,
                        P1: 1,
                        P2: 2,
                        P3: 3,
                        P4: 4
                    };

                const firstPriority =
                    priorityRank[
                        first.priority
                    ] ??
                    99;

                const secondPriority =
                    priorityRank[
                        second.priority
                    ] ??
                    99;

                if (
                    firstPriority !==
                    secondPriority
                ) {

                    return (
                        firstPriority -
                        secondPriority
                    );
                }

                return (
                    toNumber(
                        second.confidence?.score
                    ) -
                    toNumber(
                        first.confidence?.score
                    )
                );
            }
        );
}

/**
 * ============================================================================
 * Recommendation Validation
 * ============================================================================
 */

function validateRecommendation(
    recommendation
) {

    const errors =
        [];

    if (
        !recommendation?.recommendationId
    ) {

        errors.push(
            'recommendationId is required.'
        );
    }

    if (
        !recommendation?.classification?.type
    ) {

        errors.push(
            'classification.type is required.'
        );
    }

    if (
        !recommendation?.recommendationType
    ) {

        errors.push(
            'recommendationType is required.'
        );
    }

    if (
        recommendation?.executionMode ===
        EXECUTION_MODE.AUTOMATIC &&
        recommendation?.approval?.required
    ) {

        errors.push(
            'Automatic execution cannot bypass required approval.'
        );
    }

    if (
        recommendation?.executionMode ===
        EXECUTION_MODE.AUTOMATIC &&
        recommendation?.risk?.level ===
        RISK_LEVEL.CRITICAL
    ) {

        errors.push(
            'Critical-risk recommendation cannot be automatically executed.'
        );
    }

    if (
        recommendation?.status ===
        RECOMMENDATION_STATUS.BLOCKED &&
        recommendation?.executionMode !==
        EXECUTION_MODE.BLOCKED
    ) {

        errors.push(
            'Blocked recommendation must use BLOCKED execution mode.'
        );
    }

    return {

        valid:
            errors.length === 0,

        errors
    };
}

/**
 * ============================================================================
 * Explain Recommendation
 * ============================================================================
 */

function explain(
    recommendation
) {

    if (
        !recommendation
    ) {

        return {

            summary:
                'No recommendation supplied.',

            reasons: []
        };
    }

    return buildExplanation(
        recommendation
    );
}

/**
 * ============================================================================
 * Recommendation Profile API
 * ============================================================================
 */

function getRecommendationProfile(
    repairType
) {

    const type =
        normalizeString(
            repairType
        );

    return (
        RECOMMENDATION_PROFILES[
            type
        ] ||
        null
    );
}

function getSupportedRepairTypes() {

    return Object.keys(
        RECOMMENDATION_PROFILES
    );
}

function getSupportedRecommendationTypes() {

    return Object.values(
        RECOMMENDATION_TYPE
    );
}

/**
 * ============================================================================
 * Metadata
 * ============================================================================
 */

function getMetadata() {

    return {

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        type:
            MODULE_TYPE,

        deterministic:
            true,

        analyticalOnly:
            true,

        transactionMutation:
            false,

        repairExecution:
            false,

        supportedRepairTypes:
            getSupportedRepairTypes(),

        supportedRecommendationTypes:
            getSupportedRecommendationTypes(),

        executionModes:
            Object.values(
                EXECUTION_MODE
            ),

        approvalLevels:
            Object.values(
                APPROVAL_LEVEL
            ),

        riskLevels:
            Object.values(
                RISK_LEVEL
            ),

        statuses:
            Object.values(
                RECOMMENDATION_STATUS
            )
    };
}

/**
 * ============================================================================
 * Health Check
 * ============================================================================
 */

function healthCheck() {

    return {

        healthy:
            true,

        ready:
            true,

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        classifierAvailable:
            Boolean(
                AIRepairClassifier
            ),

        confidenceScorerAvailable:
            Boolean(
                AIConfidenceScorer
            ),

        timestamp:
            new Date()
                .toISOString()
    };
}

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createAIRepairRecommendationEngine(
    options = {}
) {

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options.config || {}),

            priorityWeights: {

                ...DEFAULT_CONFIG
                    .priorityWeights,

                ...(options.config?.priorityWeights || {})
            },

            financialImpactThresholds: {

                ...DEFAULT_CONFIG
                    .financialImpactThresholds,

                ...(options.config?.financialImpactThresholds || {})
            },

            agingThresholds: {

                ...DEFAULT_CONFIG
                    .agingThresholds,

                ...(options.config?.agingThresholds || {})
            }
        };

    return {

        ...AIRepairRecommendationEngine,

        config,

        recommend:
            (
                input = {},
                callOptions = {}
            ) =>
                recommend(
                    input,
                    {
                        ...config,
                        ...callOptions,

                        priorityWeights: {

                            ...config.priorityWeights,

                            ...(callOptions.priorityWeights || {})
                        },

                        financialImpactThresholds: {

                            ...config
                                .financialImpactThresholds,

                            ...(callOptions
                                .financialImpactThresholds || {})
                        },

                        agingThresholds: {

                            ...config.agingThresholds,

                            ...(callOptions
                                .agingThresholds || {})
                        }
                    }
                ),

        recommendBatch:
            (
                inputs,
                callOptions = {}
            ) =>
                recommendBatch(
                    inputs,
                    {
                        ...config,
                        ...callOptions
                    }
                )
    };
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

const AIRepairRecommendationEngine = {

    MODULE_NAME,

    MODULE_VERSION,

    MODULE_TYPE,

    DEFAULT_CONFIG,

    REPAIR_TYPE,

    RECOMMENDATION_TYPE,

    RECOMMENDATION_STATUS,

    EXECUTION_MODE,

    APPROVAL_LEVEL,

    RISK_LEVEL,

    PRIORITY,

    EVIDENCE_REQUIREMENT,

    AIRepairRecommendationEngineError,

    /*
     * Utilities
     */
    toNumber,

    clamp,

    round,

    normalizeScore,

    normalizeString,

    hasValue,

    parseDate,

    daysSince,

    stableSerialize,

    hash,

    generateRecommendationId,

    /*
     * Assessment
     */
    normalizeEvidence,

    assessEvidence,

    assessFinancialImpact,

    assessRisk,

    assessControlRisk,

    calculatePriority,

    /*
     * Decisioning
     */
    determineApprovalLevel,

    determineExecutionMode,

    determineRecommendationStatus,

    calculateConfidence,

    /*
     * Recommendation
     */
    buildActionPlan,

    recommend,

    recommendBatch,

    rankRecommendations,

    validateRecommendation,

    /*
     * Explainability
     */
    explain,

    /*
     * Profiles
     */
    getRecommendationProfile,

    getSupportedRepairTypes,

    getSupportedRecommendationTypes,

    /*
     * Operations
     */
    getMetadata,

    healthCheck
};

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    AIRepairRecommendationEngine;

module.exports.AIRepairRecommendationEngine =
    AIRepairRecommendationEngine;

module.exports.AIRepairRecommendationEngineError =
    AIRepairRecommendationEngineError;

module.exports.createAIRepairRecommendationEngine =
    createAIRepairRecommendationEngine;