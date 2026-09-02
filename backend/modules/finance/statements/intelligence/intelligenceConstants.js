'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Statement Intelligence Constants
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/statements/intelligence/intelligenceConstants.js
 *
 * Purpose:
 *   Single source of truth for Statement Intelligence engines.
 *
 * Used By:
 *   - priorityEngine
 *   - severityScorer
 *   - anomalyClassifier
 *   - agingMetrics
 *   - slaMonitor
 *   - repairAnalytics
 *   - recommendationEngine
 *   - riskIndexCalculator
 *   - trendDetector
 *   - executiveDashboard
 *   - forecasting engines
 *   - fraud intelligence engines
 *   - operational intelligence engines
 *   - reporting engines
 *
 * Design Principles:
 *   - Immutable
 *   - Deterministic
 *   - Configuration driven
 *   - Multi-tenant ready
 *   - Audit friendly
 *   - Backward compatible
 *   - Enterprise safe
 *   - Currency aware
 *   - Extensible
 *
 * IMPORTANT:
 *   These constants are configuration defaults, not tenant-specific runtime
 *   state. Tenant-specific configuration should be layered on top of these
 *   defaults by the appropriate configuration service.
 *
 * ============================================================================
 */

/**
 * ============================================================================
 * Intelligence Configuration Version
 * ============================================================================
 *
 * Increment when the semantic meaning of thresholds or configuration changes.
 *
 * Patch:
 *   Non-breaking correction/documentation change.
 *
 * Minor:
 *   New configuration field or category without changing existing semantics.
 *
 * Major:
 *   Existing threshold/category semantics change.
 */

const INTELLIGENCE_CONFIG_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Priority Levels
 * ============================================================================
 */

const PRIORITY = Object.freeze({

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
 * Severity Levels
 * ============================================================================
 */

const SEVERITY = Object.freeze({

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
 * Risk Levels
 * ============================================================================
 */

const RISK = Object.freeze({

    LOW:
        'LOW',

    MODERATE:
        'MODERATE',

    HIGH:
        'HIGH',

    CRITICAL:
        'CRITICAL'

});

/**
 * ============================================================================
 * Common Score Range
 * ============================================================================
 *
 * All intelligence score engines should normalize their final scores to
 * 0..100 unless a specific engine explicitly documents another scale.
 */

const SCORE_RANGE = Object.freeze({

    MIN:
        0,

    MAX:
        100

});

/**
 * ============================================================================
 * Risk Thresholds
 * ============================================================================
 *
 * Boundary convention:
 *
 *   0   - 25   => LOW
 *   >25 - 50   => MODERATE
 *   >50 - 75   => HIGH
 *   >75 - 100  => CRITICAL
 */

const RISK_THRESHOLDS = Object.freeze({

    LOW_MAX:
        25,

    MODERATE_MAX:
        50,

    HIGH_MAX:
        75,

    CRITICAL_MAX:
        100

});

/**
 * ============================================================================
 * Priority Thresholds
 * ============================================================================
 *
 * Boundary convention:
 *
 *   0   - 25   => LOW
 *   >25 - 50   => MEDIUM
 *   >50 - 75   => HIGH
 *   >75 - 100  => CRITICAL
 */

const PRIORITY_THRESHOLDS = Object.freeze({

    LOW_MAX:
        25,

    MEDIUM_MAX:
        50,

    HIGH_MAX:
        75,

    CRITICAL_MAX:
        100

});

/**
 * ============================================================================
 * Severity Thresholds
 * ============================================================================
 *
 * Boundary convention:
 *
 *   0   - 39   => LOW
 *   >39 - 64   => MEDIUM
 *   >64 - 84   => HIGH
 *   >84 - 100  => CRITICAL
 */

const SEVERITY_THRESHOLDS = Object.freeze({

    LOW_MAX:
        39,

    MEDIUM_MAX:
        64,

    HIGH_MAX:
        84,

    CRITICAL_MAX:
        100

});

/**
 * ============================================================================
 * SLA Policies
 * ============================================================================
 *
 * Values are expressed in hours.
 *
 * These are platform defaults. Tenant-specific SLA configuration should be
 * resolved by configuration/tenant policy services.
 */

const SLA_POLICIES = Object.freeze({

    CRITICAL:
        2,

    HIGH:
        8,

    MEDIUM:
        24,

    LOW:
        72

});

/**
 * ============================================================================
 * Aging Bucket Labels
 * ============================================================================
 */

const AGING_BUCKET_LABEL = Object.freeze({

    DAY_0_1:
        '0-1_DAY',

    DAY_1_3:
        '1-3_DAYS',

    DAY_3_7:
        '3-7_DAYS',

    DAY_7_30:
        '7-30_DAYS',

    DAY_30_PLUS:
        '30+_DAYS'

});

/**
 * ============================================================================
 * Aging Buckets
 * ============================================================================
 *
 * Boundary convention:
 *
 *   0 <= age <= 1
 *   1 < age <= 3
 *   3 < age <= 7
 *   7 < age <= 30
 *   age > 30
 *
 * The labels remain backward compatible with the original implementation.
 */

const AGING_BUCKETS = Object.freeze({

    DAY_0_1: Object.freeze({

        min:
            0,

        max:
            1,

        label:
            AGING_BUCKET_LABEL.DAY_0_1

    }),

    DAY_1_3: Object.freeze({

        min:
            1,

        max:
            3,

        label:
            AGING_BUCKET_LABEL.DAY_1_3

    }),

    DAY_3_7: Object.freeze({

        min:
            3,

        max:
            7,

        label:
            AGING_BUCKET_LABEL.DAY_3_7

    }),

    DAY_7_30: Object.freeze({

        min:
            7,

        max:
            30,

        label:
            AGING_BUCKET_LABEL.DAY_7_30

    }),

    DAY_30_PLUS: Object.freeze({

        min:
            30,

        max:
            Number.POSITIVE_INFINITY,

        label:
            AGING_BUCKET_LABEL.DAY_30_PLUS

    })

});

/**
 * ============================================================================
 * Trend Thresholds
 * ============================================================================
 *
 * Ratios are represented as decimals.
 *
 * Example:
 *   0.30 = 30%
 *   0.10 = 10%
 */

const TREND_THRESHOLDS = Object.freeze({

    INCREASING_RATIO:
        0.30,

    DECREASING_RATIO:
        0.10,

    MONTH_END_START_DAY:
        27,

    MONTH_END_SPIKE_RATIO:
        0.25,

    MINIMUM_SAMPLE_SIZE:
        20

});

/**
 * ============================================================================
 * Dashboard Limits
 * ============================================================================
 *
 * Hard upper bounds prevent accidental unbounded dashboard payloads.
 */

const DASHBOARD_LIMITS = Object.freeze({

    TOP_BRANCHES:
        10,

    TOP_FAILURE_REASONS:
        10,

    TOP_PROVIDERS:
        10,

    RECENT_ALERTS:
        25,

    EXECUTIVE_RECOMMENDATIONS:
        10,

    MAX_DASHBOARD_REPAIRS:
        10000,

    MAX_TREND_POINTS:
        365,

    MAX_RECOMMENDATIONS:
        100

});

/**
 * ============================================================================
 * Financial Impact Bands
 * ============================================================================
 *
 * IMPORTANT:
 *   These values are absolute monetary amounts and therefore must be
 *   interpreted in the configured reporting currency.
 *
 * They are intentionally not tied to a particular currency in this module.
 *
 * Recommended production approach:
 *
 *   tenant configuration
 *       ->
 *   currency configuration
 *       ->
 *   normalized monetary amount
 *       ->
 *   impact classification
 *
 * Default platform values are retained for backward compatibility.
 */

const FINANCIAL_IMPACT = Object.freeze({

    LOW:
        10000,

    MEDIUM:
        100000,

    HIGH:
        1000000,

    CRITICAL:
        5000000

});

/**
 * ============================================================================
 * Confidence Thresholds
 * ============================================================================
 *
 * Values represent percentages from 0..100.
 */

const CONFIDENCE = Object.freeze({

    LOW:
        40,

    MEDIUM:
        70,

    HIGH:
        90,

    VERY_HIGH:
        98

});

/**
 * ============================================================================
 * Dashboard Refresh Policies
 * ============================================================================
 */

const DASHBOARD_REFRESH = Object.freeze({

    REAL_TIME:
        'REAL_TIME',

    FIVE_MINUTES:
        '5_MINUTES',

    FIFTEEN_MINUTES:
        '15_MINUTES',

    HOURLY:
        'HOURLY',

    DAILY:
        'DAILY'

});

/**
 * ============================================================================
 * Refresh Intervals
 * ============================================================================
 *
 * Milliseconds corresponding to the named refresh policies.
 *
 * This prevents individual engines from independently defining refresh
 * durations.
 */

const DASHBOARD_REFRESH_INTERVALS_MS =
    Object.freeze({

        REAL_TIME:
            0,

        FIVE_MINUTES:
            5 * 60 * 1000,

        FIFTEEN_MINUTES:
            15 * 60 * 1000,

        HOURLY:
            60 * 60 * 1000,

        DAILY:
            24 * 60 * 60 * 1000

    });

/**
 * ============================================================================
 * Default Weight Models
 * ============================================================================
 *
 * Weight totals are intentionally normalized to 100.
 *
 * Consumers should validate tenant overrides before accepting them.
 */

const WEIGHTS = Object.freeze({

    PRIORITY: Object.freeze({

        financialExposure:
            25,

        customerImpact:
            20,

        regulatoryUrgency:
            20,

        settlementDependency:
            10,

        accountingPeriod:
            10,

        repairAge:
            5,

        severity:
            10

    }),

    SEVERITY: Object.freeze({

        amountImpact:
            30,

        regulatoryRisk:
            25,

        customerImpact:
            20,

        ledgerIntegrity:
            15,

        repairAge:
            10

    }),

    RISK: Object.freeze({

        financialExposure:
            25,

        regulatoryRisk:
            20,

        operationalRisk:
            15,

        customerImpact:
            15,

        ledgerIntegrity:
            15,

        repairAge:
            10

    })

});

/**
 * ============================================================================
 * Intelligence Engine Names
 * ============================================================================
 *
 * Centralized identifiers prevent inconsistent string literals across
 * orchestration, telemetry, audit and reporting layers.
 */

const INTELLIGENCE_ENGINE = Object.freeze({

    PRIORITY:
        'priorityEngine',

    SEVERITY:
        'severityScorer',

    ANOMALY:
        'anomalyClassifier',

    AGING:
        'agingMetrics',

    SLA:
        'slaMonitor',

    ANALYTICS:
        'repairAnalytics',

    RECOMMENDATION:
        'recommendationEngine',

    RISK:
        'riskIndexCalculator',

    TREND:
        'trendDetector',

    EXECUTIVE_DASHBOARD:
        'executiveDashboard'

});

/**
 * ============================================================================
 * Standard Repair Statuses
 * ============================================================================
 *
 * These are defaults for intelligence classification. Transactional repair
 * workflows remain the authoritative source for actual state transitions.
 */

const REPAIR_STATUS = Object.freeze({

    OPEN:
        'OPEN',

    PENDING:
        'PENDING',

    IN_PROGRESS:
        'IN_PROGRESS',

    UNDER_REVIEW:
        'UNDER_REVIEW',

    ESCALATED:
        'ESCALATED',

    RESOLVED:
        'RESOLVED',

    REPAIRED:
        'REPAIRED',

    COMPLETED:
        'COMPLETED',

    CLOSED:
        'CLOSED',

    CANCELLED:
        'CANCELLED',

    REJECTED:
        'REJECTED'

});

/**
 * ============================================================================
 * Standard Anomaly Categories
 * ============================================================================
 *
 * Kept here so intelligence engines can share the same taxonomy.
 */

const ANOMALY_CATEGORY = Object.freeze({

    SETTLEMENT:
        'SETTLEMENT',

    LEDGER:
        'LEDGER',

    MAPPING:
        'MAPPING',

    DUPLICATE:
        'DUPLICATE',

    MISSING_POSTING:
        'MISSING_POSTING',

    TIMING:
        'TIMING',

    CURRENCY:
        'CURRENCY',

    FRAUD_INDICATOR:
        'FRAUD_INDICATOR',

    SYSTEM_ERROR:
        'SYSTEM_ERROR',

    MANUAL_ERROR:
        'MANUAL_ERROR',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Trend Directions
 * ============================================================================
 */

const TREND_DIRECTION = Object.freeze({

    INCREASING:
        'INCREASING',

    DECREASING:
        'DECREASING',

    STABLE:
        'STABLE',

    UNKNOWN:
        'UNKNOWN'

});

/**
 * ============================================================================
 * Recommendation Priority
 * ============================================================================
 */

const RECOMMENDATION_PRIORITY = Object.freeze({

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
 * Financial Impact Labels
 * ============================================================================
 *
 * Classification labels are separated from threshold values.
 */

const FINANCIAL_IMPACT_LEVEL = Object.freeze({

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
 * Configuration Validation
 * ============================================================================
 *
 * This runs once when the module is loaded and prevents silently deploying
 * malformed platform constants.
 */

function assertFiniteNumber(
    value,
    name
) {

    if (
        typeof value !==
            'number' ||
        !Number.isFinite(
            value
        )
    ) {

        throw new TypeError(
            `${name} must be a finite number.`
        );

    }

}

function assertRange(
    value,
    min,
    max,
    name
) {

    assertFiniteNumber(
        value,
        name
    );

    if (
        value < min ||
        value > max
    ) {

        throw new RangeError(
            `${name} must be between ${min} and ${max}.`
        );

    }

}

function assertWeightModel(
    model,
    name
) {

    const values =
        Object.values(
            model
        );

    for (
        const value of
        values
    ) {

        assertRange(
            value,
            0,
            100,
            `${name} weight`
        );

    }

    const total =
        values.reduce(
            (
                sum,
                value
            ) =>
                sum +
                value,
            0
        );

    if (
        total !==
        100
    ) {

        throw new Error(
            `${name} weights must total 100.`
        );

    }

}

function validateConfiguration() {

    assertRange(
        RISK_THRESHOLDS.LOW_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'RISK_THRESHOLDS.LOW_MAX'
    );

    assertRange(
        RISK_THRESHOLDS.MODERATE_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'RISK_THRESHOLDS.MODERATE_MAX'
    );

    assertRange(
        RISK_THRESHOLDS.HIGH_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'RISK_THRESHOLDS.HIGH_MAX'
    );

    assertRange(
        RISK_THRESHOLDS.CRITICAL_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'RISK_THRESHOLDS.CRITICAL_MAX'
    );

    assertRange(
        PRIORITY_THRESHOLDS.LOW_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'PRIORITY_THRESHOLDS.LOW_MAX'
    );

    assertRange(
        PRIORITY_THRESHOLDS.MEDIUM_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'PRIORITY_THRESHOLDS.MEDIUM_MAX'
    );

    assertRange(
        PRIORITY_THRESHOLDS.HIGH_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'PRIORITY_THRESHOLDS.HIGH_MAX'
    );

    assertRange(
        PRIORITY_THRESHOLDS.CRITICAL_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'PRIORITY_THRESHOLDS.CRITICAL_MAX'
    );

    assertRange(
        SEVERITY_THRESHOLDS.LOW_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'SEVERITY_THRESHOLDS.LOW_MAX'
    );

    assertRange(
        SEVERITY_THRESHOLDS.MEDIUM_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'SEVERITY_THRESHOLDS.MEDIUM_MAX'
    );

    assertRange(
        SEVERITY_THRESHOLDS.HIGH_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'SEVERITY_THRESHOLDS.HIGH_MAX'
    );

    assertRange(
        SEVERITY_THRESHOLDS.CRITICAL_MAX,
        SCORE_RANGE.MIN,
        SCORE_RANGE.MAX,
        'SEVERITY_THRESHOLDS.CRITICAL_MAX'
    );

    if (
        RISK_THRESHOLDS.LOW_MAX >
            RISK_THRESHOLDS.MODERATE_MAX ||
        RISK_THRESHOLDS.MODERATE_MAX >
            RISK_THRESHOLDS.HIGH_MAX ||
        RISK_THRESHOLDS.HIGH_MAX >
            RISK_THRESHOLDS.CRITICAL_MAX
    ) {

        throw new Error(
            'Risk thresholds must be monotonically increasing.'
        );

    }

    if (
        PRIORITY_THRESHOLDS.LOW_MAX >
            PRIORITY_THRESHOLDS.MEDIUM_MAX ||
        PRIORITY_THRESHOLDS.MEDIUM_MAX >
            PRIORITY_THRESHOLDS.HIGH_MAX ||
        PRIORITY_THRESHOLDS.HIGH_MAX >
            PRIORITY_THRESHOLDS.CRITICAL_MAX
    ) {

        throw new Error(
            'Priority thresholds must be monotonically increasing.'
        );

    }

    if (
        SEVERITY_THRESHOLDS.LOW_MAX >
            SEVERITY_THRESHOLDS.MEDIUM_MAX ||
        SEVERITY_THRESHOLDS.MEDIUM_MAX >
            SEVERITY_THRESHOLDS.HIGH_MAX ||
        SEVERITY_THRESHOLDS.HIGH_MAX >
            SEVERITY_THRESHOLDS.CRITICAL_MAX
    ) {

        throw new Error(
            'Severity thresholds must be monotonically increasing.'
        );

    }

    assertWeightModel(
        WEIGHTS.PRIORITY,
        'PRIORITY'
    );

    assertWeightModel(
        WEIGHTS.SEVERITY,
        'SEVERITY'
    );

    assertWeightModel(
        WEIGHTS.RISK,
        'RISK'
    );

    for (
        const [severity, hours]
        of Object.entries(
            SLA_POLICIES
        )
    ) {

        if (
            typeof hours !==
                'number' ||
            !Number.isFinite(
                hours
            ) ||
            hours <= 0
        ) {

            throw new Error(
                `Invalid SLA policy for ${severity}.`
            );

        }

    }

    if (
        TREND_THRESHOLDS.MINIMUM_SAMPLE_SIZE <
        1
    ) {

        throw new Error(
            'TREND_THRESHOLDS.MINIMUM_SAMPLE_SIZE must be >= 1.'
        );

    }

    if (
        TREND_THRESHOLDS.MONTH_END_START_DAY <
            1 ||
        TREND_THRESHOLDS.MONTH_END_START_DAY >
            31
    ) {

        throw new Error(
            'TREND_THRESHOLDS.MONTH_END_START_DAY must be between 1 and 31.'
        );

    }

}

/**
 * ============================================================================
 * Validate Configuration At Module Load
 * ============================================================================
 */

validateConfiguration();

/**
 * ============================================================================
 * Public Module Export
 * ============================================================================
 *
 * The outer Object.freeze prevents consumers from replacing exported
 * properties.
 *
 * Nested configuration objects are already individually frozen.
 */

module.exports = Object.freeze({

    INTELLIGENCE_CONFIG_VERSION,

    PRIORITY,

    SEVERITY,

    RISK,

    SCORE_RANGE,

    RISK_THRESHOLDS,

    PRIORITY_THRESHOLDS,

    SEVERITY_THRESHOLDS,

    SLA_POLICIES,

    AGING_BUCKET_LABEL,

    AGING_BUCKETS,

    TREND_THRESHOLDS,

    DASHBOARD_LIMITS,

    FINANCIAL_IMPACT,

    FINANCIAL_IMPACT_LEVEL,

    CONFIDENCE,

    DASHBOARD_REFRESH,

    DASHBOARD_REFRESH_INTERVALS_MS,

    WEIGHTS,

    INTELLIGENCE_ENGINE,

    REPAIR_STATUS,

    ANOMALY_CATEGORY,

    TREND_DIRECTION,

    RECOMMENDATION_PRIORITY

});