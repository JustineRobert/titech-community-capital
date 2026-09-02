'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * AIRepairClassifier
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/ai/AIRepairClassifier.js
 *
 * Purpose:
 *   Enterprise-grade classification engine for financial statement repair
 *   candidates.
 *
 * Responsibilities:
 *
 *   - Identify the most appropriate repair type
 *   - Evaluate repair eligibility
 *   - Aggregate financial evidence
 *   - Rank candidate repair classifications
 *   - Detect ambiguity
 *   - Detect conflicting evidence
 *   - Apply financial-risk safeguards
 *   - Delegate confidence calculation to AIConfidenceScorer
 *   - Produce explainable classification results
 *   - Remain completely independent from transactional execution
 *
 * IMPORTANT:
 *
 *   This module DOES NOT:
 *
 *   - mutate statements
 *   - mutate ledger entries
 *   - create journal entries
 *   - post transactions
 *   - settle payments
 *   - execute repairs
 *   - approve financial adjustments
 *
 *   It classifies and evaluates repair candidates only.
 *
 * ============================================================================
 */

const MODULE_NAME =
    'AIRepairClassifier';

const MODULE_VERSION =
    '1.0.0';

const MODULE_TYPE =
    'STATEMENT_REPAIR_CLASSIFIER';

/**
 * ============================================================================
 * Optional Confidence Scorer Dependency
 * ============================================================================
 *
 * The scorer is intentionally loaded defensively so that this classifier
 * remains testable and does not make the intelligence module impossible to
 * load if the scorer is temporarily unavailable during deployment.
 */

let ConfidenceScorer = null;

try {

    ConfidenceScorer =
        require(
            './AIConfidenceScorer'
        );

} catch (
    error
) {

    ConfidenceScorer = null;
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
 * Repair Categories
 * ============================================================================
 */

const REPAIR_CATEGORY =
    Object.freeze({

        LEDGER:
            'LEDGER',

        SETTLEMENT:
            'SETTLEMENT',

        LOAN:
            'LOAN',

        RECONCILIATION:
            'RECONCILIATION',

        MAPPING:
            'MAPPING',

        DATA_QUALITY:
            'DATA_QUALITY',

        UNKNOWN:
            'UNKNOWN'
    });

/**
 * ============================================================================
 * Severity
 * ============================================================================
 */

const REPAIR_SEVERITY =
    Object.freeze({

        CRITICAL:
            'CRITICAL',

        HIGH:
            'HIGH',

        MEDIUM:
            'MEDIUM',

        LOW:
            'LOW',

        INFO:
            'INFO'
    });

/**
 * ============================================================================
 * Classification Status
 * ============================================================================
 */

const CLASSIFICATION_STATUS =
    Object.freeze({

        CLASSIFIED:
            'CLASSIFIED',

        REVIEW_REQUIRED:
            'REVIEW_REQUIRED',

        AMBIGUOUS:
            'AMBIGUOUS',

        INSUFFICIENT_EVIDENCE:
            'INSUFFICIENT_EVIDENCE',

        BLOCKED:
            'BLOCKED',

        UNKNOWN:
            'UNKNOWN'
    });

/**
 * ============================================================================
 * Automation Mode
 * ============================================================================
 */

const AUTOMATION_MODE =
    Object.freeze({

        AUTOMATIC:
            'AUTOMATIC',

        HUMAN_REVIEW:
            'HUMAN_REVIEW',

        ADVISORY:
            'ADVISORY',

        BLOCKED:
            'BLOCKED'
    });

/**
 * ============================================================================
 * Evidence Types
 * ============================================================================
 */

const EVIDENCE_TYPE =
    Object.freeze({

        STATEMENT:
            'STATEMENT',

        LEDGER:
            'LEDGER',

        SETTLEMENT:
            'SETTLEMENT',

        LOAN:
            'LOAN',

        ACCOUNT:
            'ACCOUNT',

        HISTORICAL:
            'HISTORICAL',

        DUPLICATE:
            'DUPLICATE',

        RECONCILIATION:
            'RECONCILIATION'
    });

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_CONFIG =
    Object.freeze({

        minimumClassificationScore:
            0.60,

        automaticClassificationScore:
            0.85,

        ambiguityMargin:
            0.10,

        minimumEvidenceCount:
            2,

        criticalRiskThreshold:
            0.80,

        highRiskThreshold:
            0.60,

        duplicateRiskThreshold:
            0.30,

        amountVarianceTolerance:
            0.01,

        dateDifferenceToleranceDays:
            1,

        weights:
            Object.freeze({

                evidence:
                    0.30,

                pattern:
                    0.20,

                reconciliation:
                    0.15,

                historical:
                    0.10,

                amount:
                    0.10,

                reference:
                    0.05,

                temporal:
                    0.05,

                account:
                    0.05
            })
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class AIRepairClassifierError
    extends Error {

    constructor(
        message,
        code = 'AI_REPAIR_CLASSIFIER_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'AIRepairClassifierError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            AIRepairClassifierError
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

    return Number.isFinite(number)
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
            toNumber(value),
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

function daysBetween(
    first,
    second
) {

    const firstDate =
        parseDate(
            first
        );

    const secondDate =
        parseDate(
            second
        );

    if (
        !firstDate ||
        !secondDate
    ) {

        return null;
    }

    return Math.abs(
        (
            firstDate.getTime() -
            secondDate.getTime()
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
 * Amount Utilities
 * ============================================================================
 */

function calculateAmountDifference(
    statementAmount,
    ledgerAmount
) {

    const statement =
        toNumber(
            statementAmount
        );

    const ledger =
        toNumber(
            ledgerAmount
        );

    return Math.abs(
        statement -
        ledger
    );
}

function calculateAmountMatchScore(
    statementAmount,
    ledgerAmount,
    tolerance =
        DEFAULT_CONFIG
            .amountVarianceTolerance
) {

    if (
        statementAmount === undefined ||
        ledgerAmount === undefined
    ) {

        return 0;
    }

    const statement =
        Math.abs(
            toNumber(
                statementAmount
            )
        );

    const ledger =
        Math.abs(
            toNumber(
                ledgerAmount
            )
        );

    const difference =
        Math.abs(
            statement -
            ledger
        );

    if (
        statement === 0 &&
        ledger === 0
    ) {

        return 1;
    }

    const denominator =
        Math.max(
            statement,
            ledger,
            1
        );

    const relativeDifference =
        difference /
        denominator;

    if (
        relativeDifference <=
        tolerance
    ) {

        return 1;
    }

    return clamp(
        1 -
        relativeDifference
    );
}

/**
 * ============================================================================
 * Text Similarity
 * ============================================================================
 */

function tokenize(
    value
) {

    return normalizeString(
        value
    )
        .replace(
            /[^A-Z0-9]+/g,
            ' '
        )
        .split(/\s+/)
        .filter(Boolean);
}

function calculateTokenSimilarity(
    first,
    second
) {

    const firstTokens =
        new Set(
            tokenize(
                first
            )
        );

    const secondTokens =
        new Set(
            tokenize(
                second
            )
        );

    if (
        firstTokens.size === 0 ||
        secondTokens.size === 0
    ) {

        return 0;
    }

    let intersection =
        0;

    for (
        const token of firstTokens
    ) {

        if (
            secondTokens.has(
                token
            )
        ) {

            intersection++;
        }
    }

    const union =
        new Set([
            ...firstTokens,
            ...secondTokens
        ]).size;

    return union === 0
        ? 0
        : intersection /
          union;
}

/**
 * ============================================================================
 * Evidence Normalization
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

    return evidence
        .filter(
            item =>
                item &&
                typeof item ===
                'object'
        )
        .map(
            item => ({

                type:
                    normalizeString(
                        item.type
                    ) ||
                    EVIDENCE_TYPE
                        .STATEMENT,

                score:
                    normalizeScore(
                        item.score ??
                        item.confidence ??
                        item.strength
                    ),

                source:
                    item.source ||
                    null,

                description:
                    item.description ||
                    null,

                reference:
                    item.reference ||
                    item.referenceId ||
                    null,

                timestamp:
                    item.timestamp ||
                    null
            })
        );
}

/**
 * ============================================================================
 * Evidence Aggregation
 * ============================================================================
 */

function aggregateEvidence(
    input = {}
) {

    const evidence =
        normalizeEvidence(
            input
        );

    if (
        evidence.length === 0
    ) {

        return {

            score:
                0,

            count:
                0,

            strongCount:
                0,

            weakCount:
                0,

            byType:
                {}
        };
    }

    const strongCount =
        evidence.filter(
            item =>
                item.score >=
                0.75
        ).length;

    const weakCount =
        evidence.filter(
            item =>
                item.score <
                0.40
        ).length;

    const byType =
        {};

    for (
        const item of evidence
    ) {

        if (
            !byType[item.type]
        ) {

            byType[item.type] = {

                count:
                    0,

                score:
                    0
            };
        }

        byType[item.type].count++;

        byType[item.type].score +=
            item.score;
    }

    for (
        const type of Object.keys(
            byType
        )
    ) {

        byType[type].score =
            round(
                byType[type].score /
                byType[type].count
            );
    }

    return {

        score:
            round(
                evidence.reduce(
                    (
                        total,
                        item
                    ) =>
                        total +
                        item.score,
                    0
                ) /
                evidence.length
            ),

        count:
            evidence.length,

        strongCount,

        weakCount,

        byType
    };
}

/**
 * ============================================================================
 * Pattern Detection
 * ============================================================================
 */

function detectPatterns(
    input = {}
) {

    const patterns =
        [];

    const unmatched =
        input.unmatched === true ||
        input.isUnmatched === true;

    const duplicate =
        input.duplicate === true ||
        input.isDuplicate === true;

    const missingLedger =
        input.missingLedger === true ||
        input.missingLedgerEntry === true;

    const failedSettlement =
        input.failedSettlement === true ||
        input.settlementFailed === true;

    const amountVariance =
        input.amountVariance !== undefined ||
        input.amountMismatch === true;

    const loanVariance =
        input.loanRepaymentVariance === true;

    const accountMismatch =
        input.accountMismatch === true ||
        input.accountMappingMismatch === true;

    const dateMismatch =
        input.dateMismatch === true;

    const referenceMismatch =
        input.referenceMismatch === true;

    const currencyMismatch =
        input.currencyMismatch === true;

    if (
        missingLedger
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .MISSING_LEDGER_ENTRY,

                score:
                    0.95,

                category:
                    REPAIR_CATEGORY
                        .LEDGER
            }
        );
    }

    if (
        duplicate
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .DUPLICATE_LEDGER_ENTRY,

                score:
                    0.95,

                category:
                    REPAIR_CATEGORY
                        .LEDGER
            }
        );
    }

    if (
        failedSettlement
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .FAILED_SETTLEMENT_POSTING,

                score:
                    0.95,

                category:
                    REPAIR_CATEGORY
                        .SETTLEMENT
            }
        );
    }

    if (
        loanVariance
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .LOAN_REPAYMENT_VARIANCE,

                score:
                    0.92,

                category:
                    REPAIR_CATEGORY
                        .LOAN
            }
        );
    }

    if (
        amountVariance
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .AMOUNT_VARIANCE,

                score:
                    0.88,

                category:
                    REPAIR_CATEGORY
                        .RECONCILIATION
            }
        );
    }

    if (
        unmatched
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .UNMATCHED_TRANSACTION,

                score:
                    0.82,

                category:
                    REPAIR_CATEGORY
                        .RECONCILIATION
            }
        );
    }

    if (
        accountMismatch
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .INCORRECT_ACCOUNT_MAPPING,

                score:
                    0.86,

                category:
                    REPAIR_CATEGORY
                        .MAPPING
            }
        );
    }

    if (
        dateMismatch
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .INCORRECT_TRANSACTION_DATE,

                score:
                    0.80,

                category:
                    REPAIR_CATEGORY
                        .DATA_QUALITY
            }
        );
    }

    if (
        referenceMismatch
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .INCORRECT_TRANSACTION_REFERENCE,

                score:
                    0.78,

                category:
                    REPAIR_CATEGORY
                        .DATA_QUALITY
            }
        );
    }

    if (
        currencyMismatch
    ) {

        patterns.push(
            {

                type:
                    REPAIR_TYPE
                        .CURRENCY_MISMATCH,

                score:
                    0.94,

                category:
                    REPAIR_CATEGORY
                        .RECONCILIATION
            }
        );
    }

    return patterns;
}

/**
 * ============================================================================
 * Candidate Definitions
 * ============================================================================
 */

const REPAIR_PROFILES =
    Object.freeze({

        [REPAIR_TYPE.MISSING_LEDGER_ENTRY]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .LEDGER,

                severity:
                    REPAIR_SEVERITY.HIGH,

                keywords: [
                    'MISSING',
                    'LEDGER',
                    'POSTING',
                    'NOT POSTED',
                    'NO LEDGER'
                ],

                automationRisk:
                    0.75
            }),

        [REPAIR_TYPE.DUPLICATE_LEDGER_ENTRY]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .LEDGER,

                severity:
                    REPAIR_SEVERITY.HIGH,

                keywords: [
                    'DUPLICATE',
                    'DOUBLE',
                    'REPEATED',
                    'DUPLICATED'
                ],

                automationRisk:
                    0.85
            }),

        [REPAIR_TYPE.AMOUNT_VARIANCE]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .RECONCILIATION,

                severity:
                    REPAIR_SEVERITY.HIGH,

                keywords: [
                    'AMOUNT',
                    'VARIANCE',
                    'DIFFERENCE',
                    'MISMATCH'
                ],

                automationRisk:
                    0.80
            }),

        [REPAIR_TYPE.LOAN_REPAYMENT_VARIANCE]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .LOAN,

                severity:
                    REPAIR_SEVERITY.HIGH,

                keywords: [
                    'LOAN',
                    'REPAYMENT',
                    'INSTALLMENT',
                    'AMORTIZATION'
                ],

                automationRisk:
                    0.85
            }),

        [REPAIR_TYPE.FAILED_SETTLEMENT_POSTING]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .SETTLEMENT,

                severity:
                    REPAIR_SEVERITY.CRITICAL,

                keywords: [
                    'SETTLEMENT',
                    'FAILED',
                    'POSTING',
                    'SETTLEMENT FAILED'
                ],

                automationRisk:
                    0.95
            }),

        [REPAIR_TYPE.UNMATCHED_TRANSACTION]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .RECONCILIATION,

                severity:
                    REPAIR_SEVERITY.MEDIUM,

                keywords: [
                    'UNMATCHED',
                    'NO MATCH',
                    'MATCH FAILED',
                    'RECONCILIATION'
                ],

                automationRisk:
                    0.65
            }),

        [REPAIR_TYPE.INCORRECT_ACCOUNT_MAPPING]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .MAPPING,

                severity:
                    REPAIR_SEVERITY.HIGH,

                keywords: [
                    'ACCOUNT',
                    'MAPPING',
                    'WRONG ACCOUNT',
                    'ACCOUNT MISMATCH'
                ],

                automationRisk:
                    0.90
            }),

        [REPAIR_TYPE.INCORRECT_TRANSACTION_DATE]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .DATA_QUALITY,

                severity:
                    REPAIR_SEVERITY.MEDIUM,

                keywords: [
                    'DATE',
                    'POSTING DATE',
                    'VALUE DATE',
                    'DATE MISMATCH'
                ],

                automationRisk:
                    0.55
            }),

        [REPAIR_TYPE.INCORRECT_TRANSACTION_REFERENCE]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .DATA_QUALITY,

                severity:
                    REPAIR_SEVERITY.LOW,

                keywords: [
                    'REFERENCE',
                    'TRANSACTION ID',
                    'REFERENCE MISMATCH'
                ],

                automationRisk:
                    0.40
            }),

        [REPAIR_TYPE.CURRENCY_MISMATCH]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .RECONCILIATION,

                severity:
                    REPAIR_SEVERITY.CRITICAL,

                keywords: [
                    'CURRENCY',
                    'FX',
                    'FOREIGN CURRENCY',
                    'CURRENCY MISMATCH'
                ],

                automationRisk:
                    0.95
            }),

        [REPAIR_TYPE.UNKNOWN_REPAIR]:
            Object.freeze({

                category:
                    REPAIR_CATEGORY
                        .UNKNOWN,

                severity:
                    REPAIR_SEVERITY.INFO,

                keywords: [],

                automationRisk:
                    1
            })
    });

/**
 * ============================================================================
 * Candidate Types
 * ============================================================================
 */

const CANDIDATE_TYPES =
    Object.freeze(
        Object.keys(
            REPAIR_PROFILES
        )
    );

/**
 * ============================================================================
 * Candidate Scoring
 * ============================================================================
 */

function calculateCandidateScore(
    type,
    input = {},
    options = {}
) {

    const profile =
        REPAIR_PROFILES[
            type
        ];

    if (
        !profile
    ) {

        return {

            type,

            score:
                0,

            category:
                REPAIR_CATEGORY
                    .UNKNOWN
        };
    }

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options || {}),

            weights: {

                ...DEFAULT_CONFIG.weights,

                ...(options.weights || {})
            }
        };

    const description =
        [
            input.description,
            input.message,
            input.reason,
            input.type,
            input.repairType,
            input.failureReason
        ]
            .filter(hasValue)
            .join(' ');

    const normalizedDescription =
        normalizeString(
            description
        );

    let keywordMatches =
        0;

    for (
        const keyword of
        profile.keywords
    ) {

        if (
            normalizedDescription
                .includes(
                    keyword
                )
        ) {

            keywordMatches++;
        }
    }

    const patternMatches =
        detectPatterns(
            input
        )
            .filter(
                pattern =>
                    pattern.type ===
                    type
            );

    const patternScore =
        patternMatches.length
            ? Math.max(
                ...patternMatches.map(
                    pattern =>
                        pattern.score
                )
            )
            : 0;

    const evidence =
        aggregateEvidence(
            input
        );

    const amountScore =
        calculateAmountMatchScore(
            input.statementAmount,
            input.ledgerAmount,
            config
                .amountVarianceTolerance
        );

    const referenceScore =
        calculateTokenSimilarity(
            input.statementReference ??
            input.statementTransactionReference,

            input.ledgerReference ??
            input.ledgerTransactionReference
        );

    const temporalDifference =
        daysBetween(
            input.statementDate,
            input.ledgerDate
        );

    const temporalScore =
        temporalDifference === null
            ? 0
            : clamp(
                1 -
                (
                    temporalDifference /
                    30
                )
            );

    const accountScore =
        calculateTokenSimilarity(
            input.statementAccount ??
            input.statementAccountCode,

            input.ledgerAccount ??
            input.ledgerAccountCode
        );

    const keywordScore =
        profile.keywords.length === 0
            ? 0
            : clamp(
                keywordMatches /
                profile.keywords.length
            );

    const reconciliationScore =
        normalizeScore(
            input.reconciliationScore ??
            input.reconciliationConfidence ??
            input.matchConfidence
        );

    const historicalScore =
        normalizeScore(
            input.historicalScore ??
            input.historicalConsistency ??
            input.historicalConfidence
        );

    const weightedScore =

        (
            evidence.score *
            config.weights.evidence
        ) +

        (
            Math.max(
                patternScore,
                keywordScore
            ) *
            config.weights.pattern
        ) +

        (
            reconciliationScore *
            config.weights.reconciliation
        ) +

        (
            historicalScore *
            config.weights.historical
        ) +

        (
            amountScore *
            config.weights.amount
        ) +

        (
            referenceScore *
            config.weights.reference
        ) +

        (
            temporalScore *
            config.weights.temporal
        ) +

        (
            accountScore *
            config.weights.account
        );

    /*
     * Explicit repair-type hints receive a controlled boost.
     */
    const explicitType =
        normalizeString(
            input.repairType ??
            input.type
        );

    const explicitBoost =
        explicitType ===
        normalizeString(type)
            ? 0.20
            : 0;

    const finalScore =
        clamp(
            weightedScore +
            explicitBoost
        );

    return {

        type,

        category:
            profile.category,

        severity:
            profile.severity,

        score:
            round(
                finalScore
            ),

        baseScore:
            round(
                weightedScore
            ),

        explicitBoost:
            round(
                explicitBoost
            ),

        automationRisk:
            profile.automationRisk,

        evidenceScore:
            round(
                evidence.score
            ),

        patternScore:
            round(
                Math.max(
                    patternScore,
                    keywordScore
                )
            ),

        reconciliationScore:
            round(
                reconciliationScore
            ),

        historicalScore:
            round(
                historicalScore
            ),

        amountScore:
            round(
                amountScore
            ),

        referenceScore:
            round(
                referenceScore
            ),

        temporalScore:
            round(
                temporalScore
            ),

        accountScore:
            round(
                accountScore
            ),

        matchedKeywords:
            keywordMatches,

        temporalDifferenceDays:
            temporalDifference
    };
}

/**
 * ============================================================================
 * Candidate Ranking
 * ============================================================================
 */

function rankCandidates(
    input = {},
    options = {}
) {

    const candidates =
        CANDIDATE_TYPES
            .filter(
                type =>
                    type !==
                    REPAIR_TYPE.UNKNOWN_REPAIR
            )
            .map(
                type =>
                    calculateCandidateScore(
                        type,
                        input,
                        options
                    )
            )
            .sort(
                (
                    first,
                    second
                ) =>
                    second.score -
                    first.score
            );

    const topCandidate =
        candidates[0] ||
        null;

    const secondCandidate =
        candidates[1] ||
        null;

    const margin =
        topCandidate &&
        secondCandidate
            ? topCandidate.score -
              secondCandidate.score
            : topCandidate
                ? topCandidate.score
                : 0;

    return {

        candidates,

        topCandidate,

        secondCandidate,

        margin:
            round(
                margin
            )
    };
}

/**
 * ============================================================================
 * Ambiguity Detection
 * ============================================================================
 */

function detectAmbiguity(
    ranking,
    options = {}
) {

    const marginThreshold =
        toNumber(
            options.ambiguityMargin,
            DEFAULT_CONFIG
                .ambiguityMargin
        );

    const top =
        ranking?.topCandidate;

    const second =
        ranking?.secondCandidate;

    if (
        !top
    ) {

        return {

            ambiguous:
                true,

            reason:
                'No repair candidate was identified.'
        };
    }

    if (
        !second
    ) {

        return {

            ambiguous:
                false,

            reason:
                null
        };
    }

    const ambiguous =
        (
            ranking.margin <
            marginThreshold
        ) &&
        (
            top.score >=
            DEFAULT_CONFIG
                .minimumClassificationScore
        );

    return {

        ambiguous,

        margin:
            ranking.margin,

        threshold:
            marginThreshold,

        reason:
            ambiguous
                ? 'Top repair candidates have insufficient score separation.'
                : null,

        competingCandidates:
            ambiguous
                ? [
                    top.type,
                    second.type
                ]
                : []
    };
}

/**
 * ============================================================================
 * Conflict Detection
 * ============================================================================
 */

function detectConflicts(
    input = {}
) {

    const conflicts =
        [];

    const explicitType =
        normalizeString(
            input.repairType ??
            input.type
        );

    const patterns =
        detectPatterns(
            input
        );

    const patternTypes =
        patterns.map(
            pattern =>
                pattern.type
        );

    if (
        patternTypes.length >
        1
    ) {

        const highConfidencePatterns =
            patterns.filter(
                pattern =>
                    pattern.score >=
                    0.90
            );

        if (
            highConfidencePatterns.length >
            1
        ) {

            conflicts.push({

                type:
                    'MULTIPLE_HIGH_CONFIDENCE_PATTERNS',

                severity:
                    REPAIR_SEVERITY.HIGH,

                details:
                    highConfidencePatterns
                        .map(
                            pattern =>
                                pattern.type
                        )
            });
        }
    }

    if (
        explicitType &&
        !CANDIDATE_TYPES.includes(
            explicitType
        )
    ) {

        conflicts.push({

            type:
                'UNKNOWN_EXPLICIT_REPAIR_TYPE',

            severity:
                REPAIR_SEVERITY.MEDIUM,

            details:
                explicitType
        });
    }

    if (
        input.statementCurrency &&
        input.ledgerCurrency &&
        normalizeString(
            input.statementCurrency
        ) !==
        normalizeString(
            input.ledgerCurrency
        )
    ) {

        conflicts.push({

            type:
                'CURRENCY_MISMATCH',

            severity:
                REPAIR_SEVERITY.CRITICAL,

            details: {

                statementCurrency:
                    input.statementCurrency,

                ledgerCurrency:
                    input.ledgerCurrency
            }
        });
    }

    if (
        input.duplicate === true &&
        input.missingLedger === true
    ) {

        conflicts.push({

            type:
                'DUPLICATE_AND_MISSING_LEDGER_CONFLICT',

            severity:
                REPAIR_SEVERITY.HIGH,

            details:
                'The same candidate cannot safely be treated as both missing and duplicate without further evidence.'
        });
    }

    return conflicts;
}

/**
 * ============================================================================
 * Risk Assessment
 * ============================================================================
 */

function assessRisk(
    candidate,
    input = {}
) {

    const riskFactors =
        [];

    let riskScore =
        0;

    if (
        candidate
            ?.automationRisk
    ) {

        riskScore +=
            candidate.automationRisk *
            0.40;

        riskFactors.push({

            factor:
                'repair_type_risk',

            score:
                candidate
                    .automationRisk
        });
    }

    const duplicateRisk =
        normalizeScore(
            input.duplicateRisk
        );

    if (
        duplicateRisk > 0
    ) {

        riskScore +=
            duplicateRisk *
            0.20;

        riskFactors.push({

            factor:
                'duplicate_risk',

            score:
                duplicateRisk
        });
    }

    const amountRisk =
        normalizeScore(
            input.amountRisk
        );

    if (
        amountRisk > 0
    ) {

        riskScore +=
            amountRisk *
            0.15;

        riskFactors.push({

            factor:
                'amount_risk',

            score:
                amountRisk
        });
    }

    const financialImpact =
        normalizeScore(
            input.financialImpactRisk
        );

    if (
        financialImpact > 0
    ) {

        riskScore +=
            financialImpact *
            0.25;

        riskFactors.push({

            factor:
                'financial_impact',

            score:
                financialImpact
        });
    }

    const conflicts =
        detectConflicts(
            input
        );

    if (
        conflicts.length > 0
    ) {

        const conflictRisk =
            conflicts.some(
                conflict =>
                    conflict.severity ===
                    REPAIR_SEVERITY.CRITICAL
            )
                ? 1
                : 0.70;

        riskScore +=
            conflictRisk *
            0.30;

        riskFactors.push({

            factor:
                'classification_conflict',

            score:
                conflictRisk
        });
    }

    riskScore =
        clamp(
            riskScore
        );

    let level =
        'LOW';

    if (
        riskScore >=
        DEFAULT_CONFIG
            .criticalRiskThreshold
    ) {

        level =
            'CRITICAL';

    } else if (
        riskScore >=
        DEFAULT_CONFIG
            .highRiskThreshold
    ) {

        level =
            'HIGH';

    } else if (
        riskScore >=
        0.30
    ) {

        level =
            'MEDIUM';
    }

    return {

        score:
            round(
                riskScore
            ),

        level,

        factors:
            riskFactors
    };
}

/**
 * ============================================================================
 * Confidence Scoring Adapter
 * ============================================================================
 */

function calculateClassificationConfidence(
    input,
    ranking,
    evidence,
    conflicts,
    risk,
    options = {}
) {

    const top =
        ranking.topCandidate;

    if (
        !ConfidenceScorer
    ) {

        return {

            score:
                top
                    ? top.score
                    : 0,

            confidenceLevel:
                top
                    ? 'MEDIUM'
                    : 'VERY_LOW',

            status:
                top
                    ? 'REQUIRES_REVIEW'
                    : 'INSUFFICIENT_EVIDENCE',

            source:
                'LOCAL_FALLBACK'
        };
    }

    const scorer =
        typeof ConfidenceScorer
            .calculateConfidence ===
        'function'
            ? ConfidenceScorer
            : ConfidenceScorer
                .AIConfidenceScorer;

    if (
        !scorer ||
        typeof scorer.calculateConfidence !==
        'function'
    ) {

        return {

            score:
                top
                    ? top.score
                    : 0,

            confidenceLevel:
                'VERY_LOW',

            status:
                'INSUFFICIENT_EVIDENCE',

            source:
                'LOCAL_FALLBACK'
        };
    }

    const modelScores =
        ranking.candidates
            .slice(
                0,
                5
            )
            .map(
                candidate =>
                    candidate.score
            );

    return scorer.calculateConfidence(
        {

            observations:
                input.observations ??
                evidence.count,

            completeness:
                input.completeness ??
                (
                    evidence.count > 0
                        ? 1
                        : 0
                ),

            validity:
                input.validity,

            consistency:
                input.consistency,

            freshness:
                input.freshness,

            accuracy:
                input.accuracy ??
                top?.score,

            modelQuality:
                input.modelQuality,

            directEvidence:
                evidence.score,

            corroboration:
                input.corroboration,

            historicalAccuracy:
                input.historicalAccuracy,

            recurrence:
                input.recurrence,

            stability:
                input.stability,

            modelScores,

            explainability:
                input.explainability ??
                (
                    conflicts.length === 0
                        ? 0.80
                        : 0.40
                ),

            riskLevel:
                risk.level,

            criticalIssue:
                conflicts.some(
                    conflict =>
                        conflict.severity ===
                        REPAIR_SEVERITY.CRITICAL
                )
        },
        options
    );
}

/**
 * ============================================================================
 * Classification Status
 * ============================================================================
 */

function determineClassificationStatus(
    ranking,
    confidence,
    evidence,
    ambiguity,
    conflicts,
    risk,
    options = {}
) {

    if (
        conflicts.some(
            conflict =>
                conflict.severity ===
                REPAIR_SEVERITY.CRITICAL
        )
    ) {

        return CLASSIFICATION_STATUS
            .BLOCKED;
    }

    if (
        evidence.count <
        toNumber(
            options.minimumEvidenceCount,
            DEFAULT_CONFIG
                .minimumEvidenceCount
        )
    ) {

        return CLASSIFICATION_STATUS
            .INSUFFICIENT_EVIDENCE;
    }

    if (
        ambiguity.ambiguous
    ) {

        return CLASSIFICATION_STATUS
            .AMBIGUOUS;
    }

    if (
        risk.level ===
        'CRITICAL'
    ) {

        return CLASSIFICATION_STATUS
            .REVIEW_REQUIRED;
    }

    if (
        confidence?.score <
        toNumber(
            options.minimumClassificationScore,
            DEFAULT_CONFIG
                .minimumClassificationScore
        )
    ) {

        return CLASSIFICATION_STATUS
            .REVIEW_REQUIRED;
    }

    if (
        ranking.topCandidate
    ) {

        return CLASSIFICATION_STATUS
            .CLASSIFIED;
    }

    return CLASSIFICATION_STATUS
        .UNKNOWN;
}

/**
 * ============================================================================
 * Automation Decision
 * ============================================================================
 */

function determineAutomationMode(
    classification,
    confidence,
    risk,
    options = {}
) {

    if (
        classification ===
        CLASSIFICATION_STATUS.BLOCKED
    ) {

        return AUTOMATION_MODE
            .BLOCKED;
    }

    if (
        classification ===
        CLASSIFICATION_STATUS
            .INSUFFICIENT_EVIDENCE ||
        classification ===
        CLASSIFICATION_STATUS
            .AMBIGUOUS
    ) {

        return AUTOMATION_MODE
            .HUMAN_REVIEW;
    }

    if (
        risk.level ===
        'CRITICAL'
    ) {

        return AUTOMATION_MODE
            .BLOCKED;
    }

    const automaticThreshold =
        toNumber(
            options.automaticClassificationScore,
            DEFAULT_CONFIG
                .automaticClassificationScore
        );

    if (
        confidence?.score >=
        automaticThreshold
    ) {

        return AUTOMATION_MODE
            .AUTOMATIC;
    }

    if (
        confidence?.score >=
        toNumber(
            options.minimumClassificationScore,
            DEFAULT_CONFIG
                .minimumClassificationScore
        )
    ) {

        return AUTOMATION_MODE
            .HUMAN_REVIEW;
    }

    return AUTOMATION_MODE
        .ADVISORY;
}

/**
 * ============================================================================
 * Explanation Builder
 * ============================================================================
 */

function buildExplanation(
    result
) {

    const candidate =
        result
            ?.classification;

    const evidence =
        result
            ?.evidence;

    const ambiguity =
        result
            ?.ambiguity;

    const conflicts =
        result
            ?.conflicts || [];

    const confidence =
        result
            ?.confidence;

    const reasons =
        [];

    if (
        candidate?.type
    ) {

        reasons.push(
            `Primary classification: ${candidate.type}.`
        );
    }

    if (
        evidence?.count
    ) {

        reasons.push(
            `${evidence.count} evidence item(s) contributed to the classification.`
        );
    }

    if (
        candidate?.score !== undefined
    ) {

        reasons.push(
            `Classification score: ${round(candidate.score * 100, 2)}%.`
        );
    }

    if (
        confidence?.score !== undefined
    ) {

        reasons.push(
            `Overall confidence: ${round(confidence.score * 100, 2)}%.`
        );
    }

    if (
        ambiguity?.ambiguous
    ) {

        reasons.push(
            'Classification remains ambiguous and requires review.'
        );
    }

    if (
        conflicts.length > 0
    ) {

        reasons.push(
            `${conflicts.length} classification conflict(s) were detected.`
        );
    }

    if (
        result?.automationMode
    ) {

        reasons.push(
            `Recommended processing mode: ${result.automationMode}.`
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
 * Main Classification API
 * ============================================================================
 */

function classify(
    input = {},
    options = {}
) {

    if (
        input === null ||
        typeof input !== 'object'
    ) {

        throw new AIRepairClassifierError(
            'Classification input must be an object.',
            'INVALID_INPUT'
        );
    }

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options || {}),

            weights: {

                ...DEFAULT_CONFIG.weights,

                ...(options.weights || {})
            }
        };

    const evidence =
        aggregateEvidence(
            input
        );

    const ranking =
        rankCandidates(
            input,
            config
        );

    const ambiguity =
        detectAmbiguity(
            ranking,
            config
        );

    const conflicts =
        detectConflicts(
            input
        );

    const risk =
        assessRisk(
            ranking.topCandidate,
            input
        );

    const confidence =
        calculateClassificationConfidence(
            input,
            ranking,
            evidence,
            conflicts,
            risk,
            config
        );

    const status =
        determineClassificationStatus(
            ranking,
            confidence,
            evidence,
            ambiguity,
            conflicts,
            risk,
            config
        );

    const automationMode =
        determineAutomationMode(
            status,
            confidence,
            risk,
            config
        );

    const primaryCandidate =
        ranking.topCandidate;

    const classification =
        primaryCandidate
            ? {

                type:
                    primaryCandidate.type,

                category:
                    primaryCandidate.category,

                severity:
                    primaryCandidate.severity,

                score:
                    primaryCandidate.score,

                automationRisk:
                    primaryCandidate
                        .automationRisk
            }
            : {

                type:
                    REPAIR_TYPE
                        .UNKNOWN_REPAIR,

                category:
                    REPAIR_CATEGORY
                        .UNKNOWN,

                severity:
                    REPAIR_SEVERITY.INFO,

                score:
                    0,

                automationRisk:
                    1
            };

    const result = {

        success:
            true,

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        timestamp:
            new Date()
                .toISOString(),

        classification,

        status,

        automationMode,

        confidence,

        evidence,

        ranking: {

            topCandidate:
                ranking.topCandidate,

            secondCandidate:
                ranking.secondCandidate,

            margin:
                ranking.margin,

            candidates:
                ranking.candidates
        },

        ambiguity,

        conflicts,

        risk,

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
 * Batch Classification
 * ============================================================================
 */

function classifyBatch(
    inputs,
    options = {}
) {

    if (
        !Array.isArray(inputs)
    ) {

        throw new AIRepairClassifierError(
            'Batch classification input must be an array.',
            'INVALID_BATCH_INPUT'
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
                        classify(
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
                            'CLASSIFICATION_ERROR',

                        message:
                            error.message
                    }
                };
            }
        }
    );
}

/**
 * ============================================================================
 * Classification From Repair Type
 * ============================================================================
 *
 * Useful when another subsystem has already determined a repair type and the
 * classifier is being used to validate / score the classification.
 */

function validateClassification(
    repairType,
    input = {},
    options = {}
) {

    const normalizedType =
        normalizeString(
            repairType
        );

    if (
        !CANDIDATE_TYPES.includes(
            normalizedType
        )
    ) {

        throw new AIRepairClassifierError(
            `Unsupported repair type: ${repairType}`,
            'UNSUPPORTED_REPAIR_TYPE',
            {
                repairType
            }
        );
    }

    const result =
        classify(
            {
                ...input,

                repairType:
                    normalizedType
            },
            options
        );

    return {

        ...result,

        requestedRepairType:
            normalizedType,

        matchesRequestedType:
            result
                .classification
                .type ===
            normalizedType
    };
}

/**
 * ============================================================================
 * Repair Type Helpers
 * ============================================================================
 */

function getRepairProfile(
    repairType
) {

    const type =
        normalizeString(
            repairType
        );

    return (
        REPAIR_PROFILES[
            type
        ] ||
        null
    );
}

function getSupportedRepairTypes() {

    return [
        ...CANDIDATE_TYPES
    ];
}

/**
 * ============================================================================
 * Explainability API
 * ============================================================================
 */

function explain(
    result
) {

    return buildExplanation(
        result
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

        transactionalMutation:
            false,

        supportedRepairTypes:
            getSupportedRepairTypes(),

        supportedCategories:
            Object.values(
                REPAIR_CATEGORY
            ),

        supportedSeverities:
            Object.values(
                REPAIR_SEVERITY
            ),

        supportedStatuses:
            Object.values(
                CLASSIFICATION_STATUS
            ),

        automationModes:
            Object.values(
                AUTOMATION_MODE
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

        confidenceScorerAvailable:
            Boolean(
                ConfidenceScorer
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

function createAIRepairClassifier(
    options = {}
) {

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options.config || {}),

            weights: {

                ...DEFAULT_CONFIG.weights,

                ...(options.config?.weights || {})
            }
        };

    return {

        ...AIRepairClassifier,

        config,

        classify:
            (
                input = {},
                callOptions = {}
            ) =>
                classify(
                    input,
                    {
                        ...config,
                        ...callOptions,

                        weights: {

                            ...config.weights,

                            ...(callOptions.weights || {})
                        }
                    }
                ),

        classifyBatch:
            (
                inputs,
                callOptions = {}
            ) =>
                classifyBatch(
                    inputs,
                    {
                        ...config,
                        ...callOptions,

                        weights: {

                            ...config.weights,

                            ...(callOptions.weights || {})
                        }
                    }
                )
    };
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

const AIRepairClassifier = {

    MODULE_NAME,

    MODULE_VERSION,

    MODULE_TYPE,

    DEFAULT_CONFIG,

    REPAIR_TYPE,

    REPAIR_CATEGORY,

    REPAIR_SEVERITY,

    CLASSIFICATION_STATUS,

    AUTOMATION_MODE,

    EVIDENCE_TYPE,

    AIRepairClassifierError,

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

    daysBetween,

    calculateAmountDifference,

    calculateAmountMatchScore,

    calculateTokenSimilarity,

    /*
     * Evidence
     */
    normalizeEvidence,

    aggregateEvidence,

    /*
     * Pattern detection
     */
    detectPatterns,

    /*
     * Classification
     */
    calculateCandidateScore,

    rankCandidates,

    detectAmbiguity,

    detectConflicts,

    assessRisk,

    classify,

    classifyBatch,

    validateClassification,

    /*
     * Profiles
     */
    getRepairProfile,

    getSupportedRepairTypes,

    /*
     * Explainability
     */
    explain,

    /*
     * Operational
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
    AIRepairClassifier;

module.exports.AIRepairClassifier =
    AIRepairClassifier;

module.exports.AIRepairClassifierError =
    AIRepairClassifierError;

module.exports.createAIRepairClassifier =
    createAIRepairClassifier;