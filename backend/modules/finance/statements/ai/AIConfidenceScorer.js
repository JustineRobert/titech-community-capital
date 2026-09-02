'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * AIConfidenceScorer
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/ai/AIConfidenceScorer.js
 *
 * Purpose:
 *   Enterprise-grade confidence scoring layer for statement intelligence,
 *   financial anomaly detection, repair recommendations, reconciliation
 *   decisions, forecasting outputs, and AI-assisted operational decisions.
 *
 * Design goals:
 *
 *   - Deterministic scoring
 *   - Explainable confidence decisions
 *   - Multi-factor evidence aggregation
 *   - Data-quality awareness
 *   - Model-quality awareness
 *   - Historical consistency awareness
 *   - Agreement / disagreement detection
 *   - Risk-aware confidence degradation
 *   - Explicit insufficient-data handling
 *   - No database dependency
 *   - No Mongoose dependency
 *   - No queue dependency
 *   - No external AI provider dependency
 *   - No mutation of financial records
 *   - No autonomous transaction execution
 *
 * Typical consumers:
 *
 *   backend/modules/finance/statements/ai/
 *       AIRepairRecommendationEngine.js
 *       AIAnomalyDetectionEngine.js
 *       AIReconciliationEngine.js
 *       AIStatementInsightEngine.js
 *
 *   backend/modules/finance/statements/forecasting/
 *       RepairForecastEngine.js
 *       SettlementReliabilityEngine.js
 *       PredictiveRepairScheduler.js
 *       ForecastModels.js
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Module Metadata
 * ============================================================================
 */

const MODULE_NAME =
    'AIConfidenceScorer';

const MODULE_VERSION =
    '1.0.0';

const MODULE_TYPE =
    'DECISION_SUPPORT';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({

    /*
     * Confidence boundaries.
     */
    thresholds: Object.freeze({

        veryHigh: 0.90,

        high: 0.80,

        medium: 0.60,

        low: 0.40,

        veryLow: 0.20
    }),

    /*
     * Evidence weights.
     *
     * These weights intentionally sum to 1.0.
     */
    weights: Object.freeze({

        dataQuality: 0.18,

        modelQuality: 0.18,

        evidenceStrength: 0.16,

        historicalConsistency: 0.12,

        agreement: 0.12,

        completeness: 0.08,

        stability: 0.06,

        explainability: 0.05,

        freshness: 0.05
    }),

    /*
     * Risk penalties.
     */
    riskPenalties: Object.freeze({

        critical:
            0.30,

        high:
            0.18,

        medium:
            0.08,

        low:
            0.03
    }),

    /*
     * Minimum observations before a confidence score can be considered
     * production-grade.
     */
    minimumObservations:
        3,

    preferredObservations:
        30,

    strongEvidenceThreshold:
        0.75,

    weakEvidenceThreshold:
        0.40,

    /*
     * Maximum confidence permitted when evidence is insufficient.
     */
    insufficientDataMaximumConfidence:
        0.35,

    /*
     * Maximum confidence permitted when a critical validation issue exists.
     */
    criticalIssueMaximumConfidence:
        0.20,

    /*
     * Numerical epsilon.
     */
    epsilon:
        1e-12
});

/**
 * ============================================================================
 * Enumerations
 * ============================================================================
 */

const CONFIDENCE_LEVEL =
    Object.freeze({

        VERY_HIGH:
            'VERY_HIGH',

        HIGH:
            'HIGH',

        MEDIUM:
            'MEDIUM',

        LOW:
            'LOW',

        VERY_LOW:
            'VERY_LOW',

        INSUFFICIENT_DATA:
            'INSUFFICIENT_DATA',

        BLOCKED:
            'BLOCKED'
    });

const CONFIDENCE_STATUS =
    Object.freeze({

        APPROVED_FOR_AUTOMATION:
            'APPROVED_FOR_AUTOMATION',

        REQUIRES_REVIEW:
            'REQUIRES_REVIEW',

        ADVISORY_ONLY:
            'ADVISORY_ONLY',

        INSUFFICIENT_EVIDENCE:
            'INSUFFICIENT_EVIDENCE',

        BLOCKED:
            'BLOCKED'
    });

const RISK_LEVEL =
    Object.freeze({

        NONE:
            'NONE',

        LOW:
            'LOW',

        MEDIUM:
            'MEDIUM',

        HIGH:
            'HIGH',

        CRITICAL:
            'CRITICAL'
    });

const EVIDENCE_LEVEL =
    Object.freeze({

        VERY_STRONG:
            'VERY_STRONG',

        STRONG:
            'STRONG',

        MODERATE:
            'MODERATE',

        WEAK:
            'WEAK',

        VERY_WEAK:
            'VERY_WEAK',

        NONE:
            'NONE'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class AIConfidenceScorerError
    extends Error {

    constructor(
        message,
        code = 'AI_CONFIDENCE_SCORER_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'AIConfidenceScorerError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            AIConfidenceScorerError
        );
    }
}

/**
 * ============================================================================
 * Numeric Utilities
 * ============================================================================
 */

function toFiniteNumber(
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
            toFiniteNumber(
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

    const number =
        toFiniteNumber(
            value
        );

    const factor =
        Math.pow(
            10,
            decimals
        );

    return Math.round(
        (
            number +
            Number.EPSILON
        ) * factor
    ) / factor;
}

function sum(
    values
) {

    if (
        !Array.isArray(values)
    ) {

        return 0;
    }

    return values.reduce(
        (
            total,
            value
        ) =>
            total +
            toFiniteNumber(
                value
            ),
        0
    );
}

function mean(
    values
) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {

        return 0;
    }

    return (
        sum(values) /
        values.length
    );
}

/**
 * ============================================================================
 * Boolean / Value Normalization
 * ============================================================================
 */

function normalizeBooleanScore(
    value,
    fallback = 0
) {

    if (
        typeof value ===
        'boolean'
    ) {

        return value
            ? 1
            : 0;
    }

    if (
        value ===
        null ||
        value ===
        undefined
    ) {

        return clamp(
            fallback
        );
    }

    return clamp(
        Number(value),
        0,
        1
    );
}

function normalizePercentage(
    value
) {

    const numeric =
        toFiniteNumber(
            value
        );

    if (
        Math.abs(numeric) >
        1
    ) {

        return clamp(
            numeric / 100
        );
    }

    return clamp(
        numeric
    );
}

/**
 * ============================================================================
 * Observation Quality
 * ============================================================================
 */

function calculateObservationScore(
    observations,
    options = {}
) {

    const count =
        Math.max(
            0,
            Math.floor(
                toFiniteNumber(
                    observations
                )
            )
        );

    const preferred =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    options.preferredObservations,
                    DEFAULT_CONFIG
                        .preferredObservations
                )
            )
        );

    return clamp(
        count /
        preferred
    );
}

function calculateSampleSufficiency(
    observations,
    options = {}
) {

    const count =
        Math.max(
            0,
            Math.floor(
                toFiniteNumber(
                    observations
                )
            )
        );

    const minimum =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    options.minimumObservations,
                    DEFAULT_CONFIG
                        .minimumObservations
                )
            )
        );

    const preferred =
        Math.max(
            minimum,
            Math.floor(
                toFiniteNumber(
                    options.preferredObservations,
                    DEFAULT_CONFIG
                        .preferredObservations
                )
            )
        );

    if (
        count < minimum
    ) {

        return {

            score: 0,

            sufficient: false,

            observations:
                count,

            minimum,

            preferred
        };
    }

    return {

        score:
            clamp(
                count /
                preferred
            ),

        sufficient: true,

        observations:
            count,

        minimum,

        preferred
    };
}

/**
 * ============================================================================
 * Data Quality
 * ============================================================================
 */

function calculateDataQuality(
    input = {}
) {

    const completeness =
        normalizePercentage(
            input.completeness ??
            input.completenessScore
        );

    const validity =
        normalizePercentage(
            input.validity ??
            input.validityScore
        );

    const consistency =
        normalizePercentage(
            input.consistency ??
            input.consistencyScore
        );

    const freshness =
        normalizePercentage(
            input.freshness ??
            input.freshnessScore
        );

    const observations =
        calculateObservationScore(
            input.observations
        );

    const explicitQuality =
        input.quality ??
        input.dataQuality;

    const baseScore =
        (
            completeness *
            0.30
        ) +
        (
            validity *
            0.30
        ) +
        (
            consistency *
            0.20
        ) +
        (
            freshness *
            0.10
        ) +
        (
            observations *
            0.10
        );

    const score =
        explicitQuality !==
        undefined
            ? (
                (
                    baseScore *
                    0.70
                ) +
                (
                    normalizePercentage(
                        explicitQuality
                    ) *
                    0.30
                )
            )
            : baseScore;

    return {

        score:
            round(
                clamp(
                    score
                )
            ),

        completeness:
            round(
                completeness
            ),

        validity:
            round(
                validity
            ),

        consistency:
            round(
                consistency
            ),

        freshness:
            round(
                freshness
            ),

        observationScore:
            round(
                observations
            )
    };
}

/**
 * ============================================================================
 * Model Quality
 * ============================================================================
 */

function calculateModelQuality(
    input = {}
) {

    const accuracy =
        normalizePercentage(
            input.accuracy ??
            input.accuracyScore
        );

    const precision =
        normalizePercentage(
            input.precision ??
            input.precisionScore
        );

    const recall =
        normalizePercentage(
            input.recall ??
            input.recallScore
        );

    const validation =
        normalizePercentage(
            input.validation ??
            input.validationScore
        );

    const backtest =
        normalizePercentage(
            input.backtest ??
            input.backtestScore
        );

    const calibration =
        normalizePercentage(
            input.calibration ??
            input.calibrationScore
        );

    const values = [
        accuracy,
        precision,
        recall,
        validation,
        backtest,
        calibration
    ].filter(
        value =>
            value > 0
    );

    const score =
        values.length
            ? mean(values)
            : 0;

    return {

        score:
            round(
                clamp(
                    score
                )
            ),

        accuracy:
            round(
                accuracy
            ),

        precision:
            round(
                precision
            ),

        recall:
            round(
                recall
            ),

        validation:
            round(
                validation
            ),

        backtest:
            round(
                backtest
            ),

        calibration:
            round(
                calibration
            ),

        evidenceCount:
            values.length
    };
}

/**
 * ============================================================================
 * Evidence Strength
 * ============================================================================
 */

function calculateEvidenceStrength(
    input = {}
) {

    const directEvidence =
        normalizePercentage(
            input.directEvidence ??
            input.directEvidenceScore
        );

    const corroboration =
        normalizePercentage(
            input.corroboration ??
            input.corroborationScore
        );

    const historicalEvidence =
        normalizePercentage(
            input.historicalEvidence ??
            input.historicalEvidenceScore
        );

    const ruleMatch =
        normalizePercentage(
            input.ruleMatch ??
            input.ruleMatchScore
        );

    const supportingSignals =
        normalizePercentage(
            input.supportingSignals ??
            input.supportingSignalScore
        );

    const score =
        (
            directEvidence *
            0.30
        ) +
        (
            corroboration *
            0.25
        ) +
        (
            historicalEvidence *
            0.20
        ) +
        (
            ruleMatch *
            0.15
        ) +
        (
            supportingSignals *
            0.10
        );

    return {

        score:
            round(
                clamp(
                    score
                )
            ),

        directEvidence:
            round(
                directEvidence
            ),

        corroboration:
            round(
                corroboration
            ),

        historicalEvidence:
            round(
                historicalEvidence
            ),

        ruleMatch:
            round(
                ruleMatch
            ),

        supportingSignals:
            round(
                supportingSignals
            )
    };
}

/**
 * ============================================================================
 * Historical Consistency
 * ============================================================================
 */

function calculateHistoricalConsistency(
    input = {}
) {

    const historicalAccuracy =
        normalizePercentage(
            input.historicalAccuracy ??
            input.historicalAccuracyScore
        );

    const recurrence =
        normalizePercentage(
            input.recurrence ??
            input.recurrenceScore
        );

    const stability =
        normalizePercentage(
            input.stability ??
            input.stabilityScore
        );

    const drift =
        normalizePercentage(
            input.drift ??
            input.driftScore
        );

    /*
     * Drift is treated as an inverse quality factor when supplied as a
     * deterioration measurement.
     */
    const driftQuality =
        input.driftIsRisk === false
            ? drift
            : 1 - drift;

    const score =
        (
            historicalAccuracy *
            0.40
        ) +
        (
            recurrence *
            0.25
        ) +
        (
            stability *
            0.20
        ) +
        (
            driftQuality *
            0.15
        );

    return {

        score:
            round(
                clamp(
                    score
                )
            ),

        historicalAccuracy:
            round(
                historicalAccuracy
            ),

        recurrence:
            round(
                recurrence
            ),

        stability:
            round(
                stability
            ),

        drift:
            round(
                drift
            ),

        driftQuality:
            round(
                driftQuality
            )
    };
}

/**
 * ============================================================================
 * Agreement Score
 * ============================================================================
 *
 * Accepts confidence values from independent models / detectors.
 *
 * Example:
 *
 *   calculateAgreement({
 *       scores: [0.91, 0.88, 0.94]
 *   })
 */

function calculateAgreement(
    input = {}
) {

    const scores =
        Array.isArray(
            input.scores
        )
            ? input.scores
                .map(
                    value =>
                        normalizePercentage(
                            value
                        )
                )
                .filter(
                    Number.isFinite
                )
            : [];

    if (
        scores.length === 0
    ) {

        return {

            score: 0,

            agreement:
                0,

            dispersion:
                1,

            observations: 0,

            sufficientData: false
        };
    }

    if (
        scores.length === 1
    ) {

        return {

            score: 1,

            agreement:
                1,

            dispersion:
                0,

            observations: 1,

            sufficientData: true
        };
    }

    const average =
        mean(scores);

    const deviations =
        scores.map(
            value =>
                Math.abs(
                    value -
                    average
                )
        );

    const averageDeviation =
        mean(
            deviations
        );

    const dispersion =
        clamp(
            averageDeviation
        );

    const agreement =
        clamp(
            1 -
            (
                dispersion *
                2
            )
        );

    return {

        score:
            round(
                agreement
            ),

        agreement:
            round(
                agreement
            ),

        mean:
            round(
                average
            ),

        dispersion:
            round(
                dispersion
            ),

        observations:
            scores.length,

        sufficientData: true
    };
}

/**
 * ============================================================================
 * Stability Score
 * ============================================================================
 */

function calculateStability(
    input = {}
) {

    const volatility =
        normalizePercentage(
            input.volatility ??
            input.volatilityScore
        );

    const variance =
        normalizePercentage(
            input.variance ??
            input.varianceScore
        );

    const drift =
        normalizePercentage(
            input.drift ??
            input.driftScore
        );

    const consistency =
        normalizePercentage(
            input.consistency ??
            input.consistencyScore
        );

    const volatilityQuality =
        input.volatilityIsRisk === false
            ? volatility
            : 1 - volatility;

    const varianceQuality =
        input.varianceIsRisk === false
            ? variance
            : 1 - variance;

    const driftQuality =
        input.driftIsRisk === false
            ? drift
            : 1 - drift;

    const score =
        (
            volatilityQuality *
            0.30
        ) +
        (
            varianceQuality *
            0.25
        ) +
        (
            driftQuality *
            0.20
        ) +
        (
            consistency *
            0.25
        );

    return {

        score:
            round(
                clamp(
                    score
                )
            ),

        volatilityQuality:
            round(
                volatilityQuality
            ),

        varianceQuality:
            round(
                varianceQuality
            ),

        driftQuality:
            round(
                driftQuality
            ),

        consistency:
            round(
                consistency
            )
    };
}

/**
 * ============================================================================
 * Explainability Score
 * ============================================================================
 */

function calculateExplainability(
    input = {}
) {

    const reasonCoverage =
        normalizePercentage(
            input.reasonCoverage ??
            input.reasonCoverageScore
        );

    const featureTraceability =
        normalizePercentage(
            input.featureTraceability ??
            input.featureTraceabilityScore
        );

    const ruleTraceability =
        normalizePercentage(
            input.ruleTraceability ??
            input.ruleTraceabilityScore
        );

    const evidenceTraceability =
        normalizePercentage(
            input.evidenceTraceability ??
            input.evidenceTraceabilityScore
        );

    const score =
        (
            reasonCoverage *
            0.30
        ) +
        (
            featureTraceability *
            0.25
        ) +
        (
            ruleTraceability *
            0.20
        ) +
        (
            evidenceTraceability *
            0.25
        );

    return {

        score:
            round(
                clamp(
                    score
                )
            ),

        reasonCoverage:
            round(
                reasonCoverage
            ),

        featureTraceability:
            round(
                featureTraceability
            ),

        ruleTraceability:
            round(
                ruleTraceability
            ),

        evidenceTraceability:
            round(
                evidenceTraceability
            )
    };
}

/**
 * ============================================================================
 * Risk Normalization
 * ============================================================================
 */

function normalizeRiskLevel(
    risk
) {

    if (
        !risk
    ) {

        return RISK_LEVEL.NONE;
    }

    const normalized =
        String(
            risk
        )
            .trim()
            .toUpperCase();

    switch (
        normalized
    ) {

        case 'CRITICAL':
            return RISK_LEVEL.CRITICAL;

        case 'HIGH':
            return RISK_LEVEL.HIGH;

        case 'MEDIUM':
        case 'MODERATE':
            return RISK_LEVEL.MEDIUM;

        case 'LOW':
            return RISK_LEVEL.LOW;

        default:
            return RISK_LEVEL.NONE;
    }
}

function calculateRiskPenalty(
    risk,
    options = {}
) {

    const riskLevel =
        normalizeRiskLevel(
            risk
        );

    const penalties = {

        ...DEFAULT_CONFIG
            .riskPenalties,

        ...(options.riskPenalties || {})
    };

    const penalty =
        penalties[
            String(
                riskLevel
            ).toLowerCase()
        ] ??
        0;

    return {

        risk:
            riskLevel,

        penalty:
            round(
                clamp(
                    penalty
                )
            )
    };
}

/**
 * ============================================================================
 * Confidence Level Classification
 * ============================================================================
 */

function classifyConfidence(
    score,
    options = {}
) {

    const thresholds = {

        ...DEFAULT_CONFIG
            .thresholds,

        ...(options.thresholds || {})
    };

    const normalizedScore =
        clamp(
            score
        );

    if (
        options.blocked === true
    ) {

        return CONFIDENCE_LEVEL
            .BLOCKED;
    }

    if (
        options.insufficientData === true
    ) {

        return CONFIDENCE_LEVEL
            .INSUFFICIENT_DATA;
    }

    if (
        normalizedScore >=
        thresholds.veryHigh
    ) {

        return CONFIDENCE_LEVEL
            .VERY_HIGH;
    }

    if (
        normalizedScore >=
        thresholds.high
    ) {

        return CONFIDENCE_LEVEL
            .HIGH;
    }

    if (
        normalizedScore >=
        thresholds.medium
    ) {

        return CONFIDENCE_LEVEL
            .MEDIUM;
    }

    if (
        normalizedScore >=
        thresholds.low
    ) {

        return CONFIDENCE_LEVEL
            .LOW;
    }

    return CONFIDENCE_LEVEL
        .VERY_LOW;
}

/**
 * ============================================================================
 * Automation Eligibility
 * ============================================================================
 */

function determineStatus(
    score,
    options = {}
) {

    const normalizedScore =
        clamp(
            score
        );

    if (
        options.blocked === true
    ) {

        return CONFIDENCE_STATUS
            .BLOCKED;
    }

    if (
        options.insufficientData === true
    ) {

        return CONFIDENCE_STATUS
            .INSUFFICIENT_EVIDENCE;
    }

    if (
        options.criticalRisk === true
    ) {

        return CONFIDENCE_STATUS
            .ADVISORY_ONLY;
    }

    const automationThreshold =
        clamp(
            toFiniteNumber(
                options.automationThreshold,
                0.90
            )
        );

    const reviewThreshold =
        clamp(
            toFiniteNumber(
                options.reviewThreshold,
                0.60
            )
        );

    if (
        normalizedScore >=
        automationThreshold
    ) {

        return CONFIDENCE_STATUS
            .APPROVED_FOR_AUTOMATION;
    }

    if (
        normalizedScore >=
        reviewThreshold
    ) {

        return CONFIDENCE_STATUS
            .REQUIRES_REVIEW;
    }

    return CONFIDENCE_STATUS
        .ADVISORY_ONLY;
}

/**
 * ============================================================================
 * Confidence Score
 * ============================================================================
 *
 * Main scoring function.
 *
 * The scorer intentionally does NOT accept "execute", "repair", "post",
 * "settle", or similar commands. It only produces analytical confidence.
 */

function calculateConfidence(
    input = {},
    options = {}
) {

    if (
        input === null ||
        typeof input !== 'object'
    ) {

        throw new AIConfidenceScorerError(
            'Confidence scorer input must be an object.',
            'INVALID_INPUT'
        );
    }

    const config = {

        ...DEFAULT_CONFIG,

        ...(options || {}),

        weights: {

            ...DEFAULT_CONFIG.weights,

            ...(options.weights || {})
        },

        riskPenalties: {

            ...DEFAULT_CONFIG.riskPenalties,

            ...(options.riskPenalties || {})
        },

        thresholds: {

            ...DEFAULT_CONFIG.thresholds,

            ...(options.thresholds || {})
        }
    };

    const sample =
        calculateSampleSufficiency(
            input.observations,
            config
        );

    const dataQuality =
        calculateDataQuality(
            input
        );

    const modelQuality =
        calculateModelQuality(
            input
        );

    const evidenceStrength =
        calculateEvidenceStrength(
            input
        );

    const historicalConsistency =
        calculateHistoricalConsistency(
            input
        );

    const agreement =
        calculateAgreement(
            input
        );

    const stability =
        calculateStability(
            input
        );

    const explainability =
        calculateExplainability(
            input
        );

    const completeness =
        normalizePercentage(
            input.completeness ??
            input.completenessScore ??
            dataQuality.completeness
        );

    const freshness =
        normalizePercentage(
            input.freshness ??
            input.freshnessScore ??
            dataQuality.freshness
        );

    const rawScore =

        (
            dataQuality.score *
            config.weights.dataQuality
        ) +

        (
            modelQuality.score *
            config.weights.modelQuality
        ) +

        (
            evidenceStrength.score *
            config.weights.evidenceStrength
        ) +

        (
            historicalConsistency.score *
            config.weights.historicalConsistency
        ) +

        (
            agreement.score *
            config.weights.agreement
        ) +

        (
            completeness *
            config.weights.completeness
        ) +

        (
            stability.score *
            config.weights.stability
        ) +

        (
            explainability.score *
            config.weights.explainability
        ) +

        (
            freshness *
            config.weights.freshness
        );

    const risk =
        calculateRiskPenalty(
            input.riskLevel ??
            input.risk,
            config
        );

    let finalScore =
        clamp(
            rawScore -
            risk.penalty
        );

    const criticalIssue =
        input.criticalIssue === true ||
        input.blocked === true;

    if (
        criticalIssue
    ) {

        finalScore =
            Math.min(
                finalScore,
                config
                    .criticalIssueMaximumConfidence
            );
    }

    if (
        !sample.sufficient
    ) {

        finalScore =
            Math.min(
                finalScore,
                config
                    .insufficientDataMaximumConfidence
            );
    }

    const confidenceLevel =
        classifyConfidence(
            finalScore,
            {
                thresholds:
                    config.thresholds,

                blocked:
                    criticalIssue,

                insufficientData:
                    !sample.sufficient
            }
        );

    const status =
        determineStatus(
            finalScore,
            {

                blocked:
                    criticalIssue,

                insufficientData:
                    !sample.sufficient,

                criticalRisk:
                    risk.risk ===
                    RISK_LEVEL.CRITICAL,

                automationThreshold:
                    input.automationThreshold,

                reviewThreshold:
                    input.reviewThreshold
            }
        );

    return {

        score:
            round(
                finalScore
            ),

        percentage:
            round(
                finalScore *
                100,
                2
            ),

        confidenceLevel,

        status,

        risk,

        sample,

        components: {

            dataQuality,

            modelQuality,

            evidenceStrength,

            historicalConsistency,

            agreement,

            completeness:
                round(
                    completeness
                ),

            stability,

            explainability,

            freshness:
                round(
                    freshness
                )
        },

        rawScore:
            round(
                rawScore
            ),

        riskAdjustedScore:
            round(
                finalScore
            ),

        automationEligible:
            status ===
            CONFIDENCE_STATUS
                .APPROVED_FOR_AUTOMATION,

        requiresHumanReview:
            status ===
            CONFIDENCE_STATUS
                .REQUIRES_REVIEW,

        advisoryOnly:
            status ===
            CONFIDENCE_STATUS
                .ADVISORY_ONLY,

        blocked:
            status ===
            CONFIDENCE_STATUS
                .BLOCKED,

        insufficientEvidence:
            status ===
            CONFIDENCE_STATUS
                .INSUFFICIENT_EVIDENCE
    };
}

/**
 * ============================================================================
 * Batch Confidence Scoring
 * ============================================================================
 */

function calculateBatchConfidence(
    inputs,
    options = {}
) {

    if (
        !Array.isArray(inputs)
    ) {

        throw new AIConfidenceScorerError(
            'Batch confidence input must be an array.',
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
                        calculateConfidence(
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
                            'CONFIDENCE_SCORING_ERROR',

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
 * Recommendation Confidence
 * ============================================================================
 *
 * Specialized wrapper for AI recommendation engines.
 */

function scoreRecommendation(
    recommendation = {},
    options = {}
) {

    const confidence =
        calculateConfidence(
            {

                observations:
                    recommendation
                        .observations ??
                    recommendation
                        .evidenceCount,

                dataQuality:
                    recommendation
                        .dataQuality,

                modelQuality:
                    recommendation
                        .modelQuality,

                accuracy:
                    recommendation
                        .accuracy,

                directEvidence:
                    recommendation
                        .directEvidence,

                corroboration:
                    recommendation
                        .corroboration,

                historicalAccuracy:
                    recommendation
                        .historicalAccuracy,

                recurrence:
                    recommendation
                        .recurrence,

                stability:
                    recommendation
                        .stability,

                scores:
                    recommendation
                        .modelScores,

                completeness:
                    recommendation
                        .completeness,

                freshness:
                    recommendation
                        .freshness,

                explainability:
                    recommendation
                        .explainability,

                riskLevel:
                    recommendation
                        .riskLevel,

                criticalIssue:
                    recommendation
                        .criticalIssue
            },
            options
        );

    return {

        ...confidence,

        recommendationType:
            recommendation.type ||
            recommendation.recommendationType ||
            null,

        recommendationId:
            recommendation.id ||
            recommendation.recommendationId ||
            null
    };
}

/**
 * ============================================================================
 * Forecast Confidence
 * ============================================================================
 *
 * Adapter for ForecastModels.js outputs.
 */

function scoreForecast(
    forecast = {},
    options = {}
) {

    const model =
        forecast.models ||
        {};

    const ensemble =
        model.ensemble ||
        {};

    const volatility =
        forecast.volatility ||
        {};

    const interval =
        forecast.interval ||
        {};

    const confidence =
        calculateConfidence(
            {

                observations:
                    forecast.observations ??
                    forecast
                        .observationCount ??
                    model
                        .linearTrend
                        ?.observations,

                dataQuality:
                    forecast.dataQuality,

                accuracy:
                    forecast.accuracy ??
                    forecast.modelAccuracy ??
                    ensemble.confidence,

                modelQuality:
                    forecast.modelQuality,

                directEvidence:
                    forecast.directEvidence,

                corroboration:
                    forecast.corroboration,

                historicalAccuracy:
                    forecast.historicalAccuracy,

                recurrence:
                    forecast.recurrence,

                volatility:
                    volatility.coefficientOfVariation,

                stability:
                    forecast.stability,

                scores:
                    forecast.modelScores,

                completeness:
                    forecast.completeness,

                freshness:
                    forecast.freshness,

                explainability:
                    forecast.explainability,

                riskLevel:
                    forecast.riskLevel
            },
            options
        );

    return {

        ...confidence,

        forecast:
            toFiniteNumber(
                forecast.pointForecast ??
                forecast.forecast
            ),

        interval: {

            lower:
                toFiniteNumber(
                    interval.lower
                ),

            upper:
                toFiniteNumber(
                    interval.upper
                )
        }
    };
}

/**
 * ============================================================================
 * Settlement Reliability Confidence
 * ============================================================================
 */

function scoreSettlementReliability(
    reliability = {},
    options = {}
) {

    const successRate =
        normalizePercentage(
            reliability.successRate
        );

    const failureRate =
        normalizePercentage(
            reliability.failureRate
        );

    const latencyScore =
        normalizePercentage(
            reliability.latencyScore ??
            reliability.latencyReliability
        );

    const stabilityScore =
        normalizePercentage(
            reliability.stability ??
            reliability.stabilityScore
        );

    const consistencyScore =
        normalizePercentage(
            reliability.consistency ??
            reliability.consistencyScore
        );

    const reliabilityComposite =
        (
            successRate *
            0.40
        ) +
        (
            latencyScore *
            0.20
        ) +
        (
            stabilityScore *
            0.15
        ) +
        (
            (
                1 -
                failureRate
            ) *
            0.15
        ) +
        (
            consistencyScore *
            0.10
        );

    const confidence =
        calculateConfidence(
            {

                observations:
                    reliability
                        .observations ??
                    reliability
                        .sampleSize,

                dataQuality:
                    reliability
                        .dataQuality,

                modelQuality:
                    reliability
                        .modelQuality,

                accuracy:
                    reliability
                        .accuracy ??
                    reliability
                        .predictionAccuracy,

                directEvidence:
                    reliability
                        .directEvidence,

                corroboration:
                    reliability
                        .corroboration,

                historicalAccuracy:
                    reliability
                        .historicalAccuracy,

                stability:
                    stabilityScore,

                consistency:
                    consistencyScore,

                scores:
                    reliability
                        .modelScores,

                completeness:
                    reliability
                        .completeness,

                freshness:
                    reliability
                        .freshness,

                explainability:
                    reliability
                        .explainability,

                riskLevel:
                    reliability
                        .riskLevel
            },
            options
        );

    return {

        ...confidence,

        reliabilityScore:
            round(
                clamp(
                    reliabilityComposite
                )
            ),

        reliabilityPercentage:
            round(
                reliabilityComposite *
                100,
                2
            ),

        metrics: {

            successRate:
                round(
                    successRate
                ),

            failureRate:
                round(
                    failureRate
                ),

            latencyScore:
                round(
                    latencyScore
                ),

            stabilityScore:
                round(
                    stabilityScore
                ),

            consistencyScore:
                round(
                    consistencyScore
                )
        }
    };
}

/**
 * ============================================================================
 * Repair Confidence
 * ============================================================================
 *
 * Specialized confidence scoring for statement repair recommendations.
 *
 * Important:
 *   This method only evaluates whether a proposed repair is sufficiently
 *   supported. It does not execute the repair.
 */

function scoreRepairRecommendation(
    repair = {},
    options = {}
) {

    const matchStrength =
        normalizePercentage(
            repair.matchStrength ??
            repair.matchConfidence
        );

    const ledgerEvidence =
        normalizePercentage(
            repair.ledgerEvidence ??
            repair.ledgerMatchConfidence
        );

    const statementEvidence =
        normalizePercentage(
            repair.statementEvidence ??
            repair.statementMatchConfidence
        );

    const amountConfidence =
        normalizePercentage(
            repair.amountConfidence
        );

    const duplicateRisk =
        normalizePercentage(
            repair.duplicateRisk
        );

    const repairInput = {

        observations:
            repair.observations ??
            repair.evidenceCount ??
            0,

        dataQuality:
            repair.dataQuality,

        modelQuality:
            repair.modelQuality,

        accuracy:
            repair.accuracy,

        directEvidence:
            (
                matchStrength +
                ledgerEvidence +
                statementEvidence
            ) / 3,

        corroboration:
            repair.corroboration ??
            repair.corroborationScore,

        historicalAccuracy:
            repair.historicalAccuracy,

        recurrence:
            repair.recurrence,

        stability:
            repair.stability,

        scores:
            repair.modelScores,

        completeness:
            repair.completeness,

        freshness:
            repair.freshness,

        explainability:
            repair.explainability,

        riskLevel:
            repair.riskLevel,

        criticalIssue:
            repair.criticalIssue
    };

    const confidence =
        calculateConfidence(
            repairInput,
            options
        );

    /*
     * Financial repair safety adjustment.
     *
     * A high duplicate risk must materially reduce confidence even when the
     * underlying model appears confident.
     */
    const duplicatePenalty =
        duplicateRisk *
        0.20;

    const adjustedScore =
        clamp(
            confidence.score -
            duplicatePenalty
        );

    const finalLevel =
        classifyConfidence(
            adjustedScore,
            {

                thresholds:
                    options.thresholds ||
                    DEFAULT_CONFIG
                        .thresholds,

                blocked:
                    confidence.blocked,

                insufficientData:
                    confidence
                        .insufficientEvidence
            }
        );

    const finalStatus =
        determineStatus(
            adjustedScore,
            {

                blocked:
                    confidence.blocked,

                insufficientData:
                    confidence
                        .insufficientEvidence,

                criticalRisk:
                    repair.riskLevel ===
                    RISK_LEVEL.CRITICAL
            }
        );

    return {

        ...confidence,

        score:
            round(
                adjustedScore
            ),

        percentage:
            round(
                adjustedScore *
                100,
                2
            ),

        confidenceLevel:
            finalLevel,

        status:
            finalStatus,

        duplicateRisk:
            round(
                duplicateRisk
            ),

        duplicateRiskPenalty:
            round(
                duplicatePenalty
            ),

        repairEvidence: {

            matchStrength:
                round(
                    matchStrength
                ),

            ledgerEvidence:
                round(
                    ledgerEvidence
                ),

            statementEvidence:
                round(
                    statementEvidence
                ),

            amountConfidence:
                round(
                    amountConfidence
                )
        },

        /*
         * Explicit guard used by transactional repair services.
         */
        repairAutomationEligible:
            finalStatus ===
            CONFIDENCE_STATUS
                .APPROVED_FOR_AUTOMATION &&
            duplicateRisk <
                0.20 &&
            amountConfidence >=
                0.80
    };
}

/**
 * ============================================================================
 * Decision Gate
 * ============================================================================
 *
 * Provides a structured gate for consuming services.
 *
 * It does NOT execute anything.
 */

function evaluateDecisionGate(
    confidence,
    options = {}
) {

    const score =
        clamp(
            confidence?.score
        );

    const minimumConfidence =
        clamp(
            toFiniteNumber(
                options.minimumConfidence,
                0.80
            )
        );

    const automationConfidence =
        clamp(
            toFiniteNumber(
                options.automationConfidence,
                0.90
            )
        );

    const criticalRisk =
        normalizeRiskLevel(
            confidence?.risk?.risk ||
            confidence?.riskLevel
        ) ===
        RISK_LEVEL.CRITICAL;

    const blocked =
        confidence?.blocked === true ||
        confidence?.status ===
            CONFIDENCE_STATUS.BLOCKED;

    const insufficientEvidence =
        confidence?.insufficientEvidence ===
        true ||
        confidence?.status ===
            CONFIDENCE_STATUS
                .INSUFFICIENT_EVIDENCE;

    if (
        blocked
    ) {

        return {

            allowed:
                false,

            mode:
                'BLOCKED',

            reason:
                'Confidence evaluation is blocked.',

            score,

            threshold:
                minimumConfidence
        };
    }

    if (
        insufficientEvidence
    ) {

        return {

            allowed:
                false,

            mode:
                'HUMAN_REVIEW',

            reason:
                'Evidence is insufficient for automated action.',

            score,

            threshold:
                minimumConfidence
        };
    }

    if (
        criticalRisk
    ) {

        return {

            allowed:
                false,

            mode:
                'HUMAN_REVIEW',

            reason:
                'Critical risk prevents automated execution.',

            score,

            threshold:
                minimumConfidence
        };
    }

    if (
        score >=
        automationConfidence
    ) {

        return {

            allowed:
                true,

            mode:
                'AUTOMATION_ELIGIBLE',

            reason:
                'Confidence meets the automation threshold.',

            score,

            threshold:
                automationConfidence
        };
    }

    if (
        score >=
        minimumConfidence
    ) {

        return {

            allowed:
                false,

            mode:
                'HUMAN_REVIEW',

            reason:
                'Confidence is adequate but below the automation threshold.',

            score,

            threshold:
                automationConfidence
        };
    }

    return {

        allowed:
            false,

        mode:
            'ADVISORY_ONLY',

        reason:
            'Confidence is below the minimum decision threshold.',

        score,

        threshold:
            minimumConfidence
    };
}

/**
 * ============================================================================
 * Confidence Explanation
 * ============================================================================
 */

function explainConfidence(
    result
) {

    if (
        !result ||
        typeof result !==
        'object'
    ) {

        return {

            summary:
                'No confidence result available.',

            factors: []
        };
    }

    const components =
        result.components ||
        {};

    const factors =
        [];

    function addFactor(
        name,
        value,
        positiveMessage,
        negativeMessage
    ) {

        const score =
            clamp(
                value
            );

        factors.push({

            name,

            score:
                round(
                    score
                ),

            interpretation:
                score >= 0.75
                    ? positiveMessage
                    : negativeMessage
        });
    }

    addFactor(
        'Data quality',
        components
            .dataQuality
            ?.score,
        'Data quality strongly supports the result.',
        'Data quality is limiting confidence.'
    );

    addFactor(
        'Model quality',
        components
            .modelQuality
            ?.score,
        'Model performance strongly supports the result.',
        'Model performance is limiting confidence.'
    );

    addFactor(
        'Evidence strength',
        components
            .evidenceStrength
            ?.score,
        'Evidence strongly supports the result.',
        'Supporting evidence is insufficient.'
    );

    addFactor(
        'Historical consistency',
        components
            .historicalConsistency
            ?.score,
        'Historical behavior supports the result.',
        'Historical behavior provides limited support.'
    );

    addFactor(
        'Model agreement',
        components
            .agreement
            ?.score,
        'Independent signals are strongly aligned.',
        'Independent signals show disagreement.'
    );

    addFactor(
        'Stability',
        components
            .stability
            ?.score,
        'Underlying behavior is stable.',
        'Underlying behavior shows instability.'
    );

    addFactor(
        'Explainability',
        components
            .explainability
            ?.score,
        'The result is well supported and traceable.',
        'Traceability or explanation quality is limited.'
    );

    const summary =
        `Confidence is ${result.percentage ?? 0}% ` +
        `(${result.confidenceLevel || 'UNKNOWN'}) ` +
        `with status ${result.status || 'UNKNOWN'}.`;

    return {

        summary,

        factors,

        score:
            result.score,

        level:
            result.confidenceLevel,

        status:
            result.status
    };
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

        supportsAutomationGate:
            true,

        supportsExplainability:
            true,

        supportedConfidenceLevels:
            Object.values(
                CONFIDENCE_LEVEL
            ),

        supportedStatuses:
            Object.values(
                CONFIDENCE_STATUS
            ),

        supportedRiskLevels:
            Object.values(
                RISK_LEVEL
            )
    };
}

/**
 * ============================================================================
 * Health / Readiness
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

        deterministic:
            true,

        timestamp:
            new Date()
                .toISOString()
    };
}

/**
 * ============================================================================
 * Public API
 * ============================================================================
 */

const AIConfidenceScorer = {

    MODULE_NAME,

    MODULE_VERSION,

    MODULE_TYPE,

    DEFAULT_CONFIG,

    CONFIDENCE_LEVEL,

    CONFIDENCE_STATUS,

    RISK_LEVEL,

    EVIDENCE_LEVEL,

    AIConfidenceScorerError,

    /*
     * Numeric helpers
     */
    toFiniteNumber,

    clamp,

    round,

    sum,

    mean,

    normalizeBooleanScore,

    normalizePercentage,

    /*
     * Observation analysis
     */
    calculateObservationScore,

    calculateSampleSufficiency,

    /*
     * Component scoring
     */
    calculateDataQuality,

    calculateModelQuality,

    calculateEvidenceStrength,

    calculateHistoricalConsistency,

    calculateAgreement,

    calculateStability,

    calculateExplainability,

    calculateRiskPenalty,

    /*
     * Classification
     */
    normalizeRiskLevel,

    classifyConfidence,

    determineStatus,

    /*
     * Main scoring API
     */
    calculateConfidence,

    calculateBatchConfidence,

    /*
     * Specialized scoring APIs
     */
    scoreRecommendation,

    scoreForecast,

    scoreSettlementReliability,

    scoreRepairRecommendation,

    /*
     * Decision support
     */
    evaluateDecisionGate,

    explainConfidence,

    /*
     * Operational
     */
    getMetadata,

    healthCheck
};

/**
 * ============================================================================
 * Factory
 * ============================================================================
 *
 * The factory allows consumers to create an isolated scorer configuration
 * without introducing mutable module-level state.
 */

function createAIConfidenceScorer(
    options = {}
) {

    const config = {

        ...DEFAULT_CONFIG,

        ...(options.config || {}),

        weights: {

            ...DEFAULT_CONFIG.weights,

            ...(options.config?.weights || {})
        },

        thresholds: {

            ...DEFAULT_CONFIG.thresholds,

            ...(options.config?.thresholds || {})
        },

        riskPenalties: {

            ...DEFAULT_CONFIG.riskPenalties,

            ...(options.config?.riskPenalties || {})
        }
    };

    return {

        ...AIConfidenceScorer,

        config,

        calculateConfidence:
            (
                input = {},
                callOptions = {}
            ) =>
                calculateConfidence(
                    input,
                    {
                        ...config,
                        ...callOptions,

                        weights: {
                            ...config.weights,
                            ...(callOptions.weights || {})
                        },

                        thresholds: {
                            ...config.thresholds,
                            ...(callOptions.thresholds || {})
                        },

                        riskPenalties: {
                            ...config.riskPenalties,
                            ...(callOptions.riskPenalties || {})
                        }
                    }
                )
    };
}

/**
 * ============================================================================
 * Module Exports
 * ============================================================================
 */

module.exports =
    AIConfidenceScorer;

module.exports.AIConfidenceScorer =
    AIConfidenceScorer;

module.exports.AIConfidenceScorerError =
    AIConfidenceScorerError;

module.exports.createAIConfidenceScorer =
    createAIConfidenceScorer;