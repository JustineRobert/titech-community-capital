'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ForecastModels
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/forecasting/ForecastModels.js
 *
 * Purpose:
 *   Shared, deterministic forecasting models and statistical primitives used
 *   by statement intelligence and financial forecasting engines.
 *
 * Intended consumers:
 *
 *   - RepairForecastEngine
 *   - SettlementReliabilityEngine
 *   - PredictiveRepairScheduler
 *   - Future forecasting / intelligence engines
 *
 * Design principles:
 *
 *   - Pure analytical functions wherever possible
 *   - No database dependency
 *   - No Mongoose dependency
 *   - No queue dependency
 *   - No mutation of financial records
 *   - Deterministic calculations
 *   - Explicit handling of insufficient data
 *   - Defensive numeric normalization
 *   - Explainable model outputs
 *   - Configurable thresholds
 *   - Production-safe edge-case handling
 *
 * Supported models:
 *
 *   - Simple Moving Average
 *   - Weighted Moving Average
 *   - Exponential Weighted Moving Average
 *   - Linear Trend
 *   - Seasonal Baseline
 *   - Trend-Adjusted Forecast
 *   - Forecast Interval Estimation
 *   - Demand Forecast
 *   - Rate Forecast
 *   - Rolling Volatility
 *   - Standard Deviation
 *   - Mean Absolute Deviation
 *   - Coefficient of Variation
 *   - Exponential Smoothing
 *   - Weighted Ensemble Forecast
 *   - Forecast Confidence
 *   - Anomaly Score
 *   - Reliability Score
 *   - Capacity Forecast
 *
 * Financial safety:
 *
 *   This module produces analytical values only.
 *   It MUST NOT directly:
 *
 *      - post ledger entries
 *      - alter transactions
 *      - repair statements
 *      - settle payments
 *      - close accounting periods
 *      - approve financial adjustments
 *
 * ============================================================================
 */

const MODULE_NAME =
    'ForecastModels';

const MODULE_VERSION =
    '1.0.0';

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({

    movingAverageWindow: 14,

    ewmaAlpha: 0.35,

    trendMinimumObservations: 3,

    minimumObservations: 3,

    confidenceMinimumObservations: 10,

    confidenceThresholds: Object.freeze({

        high: 0.80,

        medium: 0.55,

        low: 0.30
    }),

    anomalyThresholds: Object.freeze({

        low: 1.0,

        medium: 2.0,

        high: 3.0
    }),

    reliabilityWeights: Object.freeze({

        successRate: 0.40,

        latency: 0.20,

        volatility: 0.15,

        failureRate: 0.15,

        consistency: 0.10
    }),

    defaultConfidence: 0,

    defaultForecast: 0,

    defaultVolatility: 0,

    epsilon: 1e-12
});

/**
 * ============================================================================
 * Enumerations
 * ============================================================================
 */

const FORECAST_CONFIDENCE =
    Object.freeze({

        HIGH: 'HIGH',

        MEDIUM: 'MEDIUM',

        LOW: 'LOW',

        INSUFFICIENT_DATA:
            'INSUFFICIENT_DATA'
    });

const TREND_DIRECTION =
    Object.freeze({

        INCREASING: 'INCREASING',

        DECREASING: 'DECREASING',

        STABLE: 'STABLE',

        INSUFFICIENT_DATA:
            'INSUFFICIENT_DATA'
    });

const ANOMALY_LEVEL =
    Object.freeze({

        NORMAL: 'NORMAL',

        LOW: 'LOW',

        MEDIUM: 'MEDIUM',

        HIGH: 'HIGH'
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class ForecastModelsError
    extends Error {

    constructor(
        message,
        code = 'FORECAST_MODEL_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'ForecastModelsError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            ForecastModelsError
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

function isFiniteNumber(
    value
) {

    return Number.isFinite(
        Number(value)
    );
}

function clamp(
    value,
    min,
    max
) {

    return Math.min(
        Math.max(
            value,
            min
        ),
        max
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

function variance(
    values,
    sample = true
) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {

        return 0;
    }

    const average =
        mean(values);

    const squaredDifferences =
        values.map(
            value =>
                Math.pow(
                    toFiniteNumber(
                        value
                    ) -
                    average,
                    2
                )
        );

    const denominator =
        sample
            ? Math.max(
                values.length - 1,
                1
            )
            : values.length;

    return (
        sum(
            squaredDifferences
        ) /
        denominator
    );
}

function standardDeviation(
    values,
    sample = true
) {

    return Math.sqrt(
        Math.max(
            variance(
                values,
                sample
            ),
            0
        )
    );
}

function median(
    values
) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {

        return 0;
    }

    const sorted =
        values
            .map(
                value =>
                    toFiniteNumber(
                        value
                    )
            )
            .sort(
                (
                    a,
                    b
                ) =>
                    a - b
            );

    const middle =
        Math.floor(
            sorted.length / 2
        );

    if (
        sorted.length % 2 === 0
    ) {

        return mean([
            sorted[middle - 1],
            sorted[middle]
        ]);
    }

    return sorted[middle];
}

function absoluteDeviation(
    values
) {

    if (
        !Array.isArray(values) ||
        values.length === 0
    ) {

        return 0;
    }

    const center =
        median(values);

    return mean(
        values.map(
            value =>
                Math.abs(
                    toFiniteNumber(
                        value
                    ) -
                    center
                )
        )
    );
}

function coefficientOfVariation(
    values,
    epsilon = DEFAULT_CONFIG.epsilon
) {

    const average =
        mean(values);

    if (
        Math.abs(average) <=
        epsilon
    ) {

        return 0;
    }

    return (
        standardDeviation(
            values
        ) /
        Math.abs(
            average
        )
    );
}

/**
 * ============================================================================
 * Data Normalization
 * ============================================================================
 */

function normalizeSeries(
    values,
    options = {}
) {

    const config = {

        removeInvalid:
            options.removeInvalid !==
            false,

        sort:
            options.sort !==
            false,

        preserveZero:
            options.preserveZero !==
            false
    };

    if (
        !Array.isArray(values)
    ) {

        return [];
    }

    let normalized =
        values.map(
            value =>
                toFiniteNumber(
                    value,
                    NaN
                )
        );

    if (
        config.removeInvalid
    ) {

        normalized =
            normalized.filter(
                value =>
                    Number.isFinite(
                        value
                    )
            );
    }

    if (
        config.sort
    ) {

        normalized.sort(
            (
                a,
                b
            ) =>
                a - b
        );
    }

    if (
        !config.preserveZero
    ) {

        normalized =
            normalized.map(
                value =>
                    Math.abs(value) <
                    DEFAULT_CONFIG.epsilon
                        ? 0
                        : value
            );
    }

    return normalized;
}

/**
 * ============================================================================
 * Simple Moving Average
 * ============================================================================
 */

function simpleMovingAverage(
    values,
    window = DEFAULT_CONFIG.movingAverageWindow
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        !series.length
    ) {

        return {

            value: 0,

            window: 0,

            observations: 0,

            sufficientData: false
        };
    }

    const normalizedWindow =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    window,
                    1
                )
            )
        );

    const recent =
        series.slice(
            -normalizedWindow
        );

    return {

        value:
            round(
                mean(recent)
            ),

        window:
            recent.length,

        observations:
            series.length,

        sufficientData:
            recent.length >=
            Math.min(
                normalizedWindow,
                DEFAULT_CONFIG
                    .minimumObservations
            )
    };
}

/**
 * ============================================================================
 * Weighted Moving Average
 * ============================================================================
 */

function weightedMovingAverage(
    values,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        !series.length
    ) {

        return {

            value: 0,

            weights: [],

            observations: 0,

            sufficientData: false
        };
    }

    const window =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    options.window,
                    DEFAULT_CONFIG
                        .movingAverageWindow
                )
            )
        );

    const recent =
        series.slice(
            -window
        );

    const weights =
        Array.from(
            {
                length:
                    recent.length
            },
            (
                _,
                index
            ) =>
                index + 1
        );

    const denominator =
        sum(weights);

    const numerator =
        recent.reduce(
            (
                total,
                value,
                index
            ) =>
                total +
                value *
                weights[index],
            0
        );

    return {

        value:
            denominator
                ? round(
                    numerator /
                    denominator
                )
                : 0,

        weights,

        observations:
            series.length,

        window:
            recent.length,

        sufficientData:
            recent.length >=
            Math.min(
                window,
                DEFAULT_CONFIG
                    .minimumObservations
            )
    };
}

/**
 * ============================================================================
 * Exponentially Weighted Moving Average
 * ============================================================================
 */

function exponentialMovingAverage(
    values,
    alpha = DEFAULT_CONFIG.ewmaAlpha
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        !series.length
    ) {

        return {

            value: 0,

            alpha,

            observations: 0,

            sufficientData: false
        };
    }

    const normalizedAlpha =
        clamp(
            toFiniteNumber(
                alpha,
                DEFAULT_CONFIG
                    .ewmaAlpha
            ),
            0.000001,
            1
        );

    let result =
        series[0];

    for (
        let index = 1;
        index < series.length;
        index += 1
    ) {

        result =
            (
                normalizedAlpha *
                series[index]
            ) +
            (
                (
                    1 -
                    normalizedAlpha
                ) *
                result
            );
    }

    return {

        value:
            round(result),

        alpha:
            normalizedAlpha,

        observations:
            series.length,

        sufficientData:
            series.length >=
            DEFAULT_CONFIG
                .minimumObservations
    };
}

/**
 * ============================================================================
 * Linear Trend
 * ============================================================================
 *
 * Ordinary least-squares regression:
 *
 *     y = intercept + slope * x
 *
 * x is the observation index.
 */

function linearTrend(
    values,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    const minimumObservations =
        Math.max(
            2,
            Math.floor(
                toFiniteNumber(
                    options.minimumObservations,
                    DEFAULT_CONFIG
                        .trendMinimumObservations
                )
            )
        );

    if (
        series.length <
        minimumObservations
    ) {

        return {

            direction:
                TREND_DIRECTION
                    .INSUFFICIENT_DATA,

            slope: 0,

            intercept:
                series.length
                    ? series[0]
                    : 0,

            rSquared: 0,

            strength: 0,

            observations:
                series.length,

            sufficientData: false
        };
    }

    const n =
        series.length;

    const x =
        Array.from(
            {
                length: n
            },
            (
                _,
                index
            ) =>
                index
        );

    const meanX =
        mean(x);

    const meanY =
        mean(series);

    let numerator =
        0;

    let denominator =
        0;

    for (
        let index = 0;
        index < n;
        index += 1
    ) {

        const dx =
            x[index] -
            meanX;

        const dy =
            series[index] -
            meanY;

        numerator +=
            dx * dy;

        denominator +=
            dx * dx;
    }

    const slope =
        denominator
            ? numerator /
              denominator
            : 0;

    const intercept =
        meanY -
        slope *
        meanX;

    const predictions =
        x.map(
            value =>
                intercept +
                slope *
                value
        );

    const totalSumSquares =
        sum(
            series.map(
                value =>
                    Math.pow(
                        value -
                        meanY,
                        2
                    )
            )
        );

    const residualSumSquares =
        sum(
            series.map(
                (
                    value,
                    index
                ) =>
                    Math.pow(
                        value -
                        predictions[index],
                        2
                    )
            )
        );

    const rSquared =
        totalSumSquares >
        DEFAULT_CONFIG.epsilon
            ? clamp(
                1 -
                (
                    residualSumSquares /
                    totalSumSquares
                ),
                0,
                1
            )
            : 1;

    const normalizedSlope =
        Math.abs(meanY) >
        DEFAULT_CONFIG.epsilon
            ? slope /
              Math.abs(meanY)
            : slope;

    let direction =
        TREND_DIRECTION.STABLE;

    if (
        normalizedSlope >
        0.01
    ) {

        direction =
            TREND_DIRECTION
                .INCREASING;

    } else if (
        normalizedSlope <
        -0.01
    ) {

        direction =
            TREND_DIRECTION
                .DECREASING;
    }

    return {

        direction,

        slope:
            round(
                slope
            ),

        intercept:
            round(
                intercept
            ),

        rSquared:
            round(
                rSquared
            ),

        strength:
            round(
                rSquared *
                clamp(
                    Math.abs(
                        normalizedSlope
                    ) * 10,
                    0,
                    1
                )
            ),

        normalizedSlope:
            round(
                normalizedSlope
            ),

        currentValue:
            round(
                series[
                    series.length - 1
                ]
            ),

        fittedCurrentValue:
            round(
                predictions[
                    predictions.length - 1
                ]
            ),

        observations:
            n,

        sufficientData: true
    };
}

/**
 * ============================================================================
 * Trend Forecast
 * ============================================================================
 */

function trendForecast(
    values,
    periods = 1,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        !series.length
    ) {

        return {

            forecast: 0,

            periods,

            trend:
                linearTrend(
                    series,
                    options
                ),

            sufficientData: false
        };
    }

    const trend =
        linearTrend(
            series,
            options
        );

    if (
        !trend.sufficientData
    ) {

        return {

            forecast:
                round(
                    series[
                        series.length - 1
                    ]
                ),

            periods,

            trend,

            sufficientData: false
        };
    }

    const futureIndex =
        (
            series.length - 1
        ) +
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    periods,
                    1
                )
            )
        );

    const forecast =
        trend.intercept +
        trend.slope *
        futureIndex;

    return {

        forecast:
            round(
                Math.max(
                    0,
                    forecast
                )
            ),

        periods,

        trend,

        sufficientData: true
    };
}

/**
 * ============================================================================
 * Seasonal Baseline
 * ============================================================================
 *
 * Useful for recurring daily/weekly repair or settlement patterns.
 *
 * period:
 *   Number of observations in one seasonal cycle.
 *
 * Example:
 *   period = 7 for daily observations with weekly seasonality.
 */

function seasonalBaseline(
    values,
    period = 7,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    const normalizedPeriod =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    period,
                    7
                )
            )
        );

    if (
        series.length <
        normalizedPeriod
    ) {

        return {

            value:
                mean(series),

            period:
                normalizedPeriod,

            seasonalIndex:
                null,

            sufficientData: false
        };
    }

    const cycles =
        Math.floor(
            series.length /
            normalizedPeriod
        );

    const usableLength =
        cycles *
        normalizedPeriod;

    const usable =
        series.slice(
            -usableLength
        );

    const overallMean =
        mean(usable);

    if (
        Math.abs(
            overallMean
        ) <=
        DEFAULT_CONFIG.epsilon
    ) {

        return {

            value:
                round(
                    overallMean
                ),

            period:
                normalizedPeriod,

            seasonalIndex:
                Array(
                    normalizedPeriod
                ).fill(1),

            sufficientData: true
        };
    }

    const seasonalIndex =
        Array.from(
            {
                length:
                    normalizedPeriod
            },
            () => []
        );

    usable.forEach(
        (
            value,
            index
        ) => {

            seasonalIndex[
                index %
                normalizedPeriod
            ].push(
                value
            );
        }
    );

    const factors =
        seasonalIndex.map(
            bucket =>
                mean(bucket) /
                overallMean
        );

    const latestSeasonPosition =
        (
            series.length - 1
        ) %
        normalizedPeriod;

    const baseline =
        overallMean *
        factors[
            latestSeasonPosition
        ];

    return {

        value:
            round(
                baseline
            ),

        period:
            normalizedPeriod,

        overallMean:
            round(
                overallMean
            ),

        seasonalIndex:
            factors.map(
                factor =>
                    round(
                        factor
                    )
            ),

        seasonPosition:
            latestSeasonPosition,

        sufficientData: true
    };
}

/**
 * ============================================================================
 * Trend + Seasonal Forecast
 * ============================================================================
 */

function trendSeasonalForecast(
    values,
    periods = 1,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        !series.length
    ) {

        return {

            forecast: 0,

            trend:
                null,

            seasonal:
                null,

            sufficientData: false
        };
    }

    const trend =
        linearTrend(
            series,
            options
        );

    const seasonal =
        seasonalBaseline(
            series,
            options.period ||
            7,
            options
        );

    const horizon =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    periods,
                    1
                )
            )
        );

    let forecast;

    if (
        trend.sufficientData
    ) {

        const futureIndex =
            (
                series.length - 1
            ) +
            horizon;

        forecast =
            trend.intercept +
            trend.slope *
            futureIndex;

    } else {

        forecast =
            mean(series);
    }

    if (
        seasonal.sufficientData &&
        Array.isArray(
            seasonal.seasonalIndex
        )
    ) {

        const futurePosition =
            (
                (
                    series.length - 1
                ) +
                horizon
            ) %
            seasonal.period;

        const seasonalFactor =
            seasonal.seasonalIndex[
                futurePosition
            ];

        forecast *=
            seasonalFactor;
    }

    return {

        forecast:
            round(
                Math.max(
                    0,
                    forecast
                )
            ),

        periods:
            horizon,

        trend,

        seasonal,

        sufficientData:
            trend.sufficientData ||
            seasonal.sufficientData
    };
}

/**
 * ============================================================================
 * Forecast Error Metrics
 * ============================================================================
 */

function meanAbsoluteError(
    actual,
    predicted
) {

    const length =
        Math.min(
            actual?.length || 0,
            predicted?.length || 0
        );

    if (
        length === 0
    ) {

        return 0;
    }

    const errors =
        [];

    for (
        let index = 0;
        index < length;
        index += 1
    ) {

        errors.push(
            Math.abs(
                toFiniteNumber(
                    actual[index]
                ) -
                toFiniteNumber(
                    predicted[index]
                )
            )
        );
    }

    return round(
        mean(errors)
    );
}

function meanSquaredError(
    actual,
    predicted
) {

    const length =
        Math.min(
            actual?.length || 0,
            predicted?.length || 0
        );

    if (
        length === 0
    ) {

        return 0;
    }

    const errors =
        [];

    for (
        let index = 0;
        index < length;
        index += 1
    ) {

        const error =
            toFiniteNumber(
                actual[index]
            ) -
            toFiniteNumber(
                predicted[index]
            );

        errors.push(
            error * error
        );
    }

    return round(
        mean(errors)
    );
}

function rootMeanSquaredError(
    actual,
    predicted
) {

    return round(
        Math.sqrt(
            meanSquaredError(
                actual,
                predicted
            )
        )
    );
}

function meanAbsolutePercentageError(
    actual,
    predicted,
    epsilon = DEFAULT_CONFIG.epsilon
) {

    const length =
        Math.min(
            actual?.length || 0,
            predicted?.length || 0
        );

    if (
        length === 0
    ) {

        return 0;
    }

    const errors =
        [];

    for (
        let index = 0;
        index < length;
        index += 1
    ) {

        const actualValue =
            toFiniteNumber(
                actual[index]
            );

        if (
            Math.abs(
                actualValue
            ) <=
            epsilon
        ) {

            continue;
        }

        errors.push(
            Math.abs(
                (
                    actualValue -
                    toFiniteNumber(
                        predicted[index]
                    )
                ) /
                actualValue
            )
        );
    }

    return round(
        mean(errors)
    );
}

/**
 * ============================================================================
 * Volatility
 * ============================================================================
 */

function rollingVolatility(
    values,
    window = DEFAULT_CONFIG.movingAverageWindow
) {

    const series =
        normalizeSeries(
            values
        );

    const normalizedWindow =
        Math.max(
            2,
            Math.floor(
                toFiniteNumber(
                    window,
                    DEFAULT_CONFIG
                        .movingAverageWindow
                )
            )
        );

    if (
        series.length <
        2
    ) {

        return {

            value: 0,

            window:
                series.length,

            observations:
                series.length,

            sufficientData: false
        };
    }

    const recent =
        series.slice(
            -normalizedWindow
        );

    return {

        value:
            round(
                standardDeviation(
                    recent
                )
            ),

        window:
            recent.length,

        observations:
            series.length,

        coefficientOfVariation:
            round(
                coefficientOfVariation(
                    recent
                )
            ),

        sufficientData:
            recent.length >= 2
    };
}

/**
 * ============================================================================
 * Forecast Interval
 * ============================================================================
 */

function forecastInterval(
    values,
    forecast,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        !series.length
    ) {

        return {

            forecast:
                toFiniteNumber(
                    forecast
                ),

            lower:
                toFiniteNumber(
                    forecast
                ),

            upper:
                toFiniteNumber(
                    forecast
                ),

            margin: 0,

            confidenceLevel:
                options.confidenceLevel ||
                0.95,

            sufficientData: false
        };
    }

    const confidenceLevel =
        clamp(
            toFiniteNumber(
                options.confidenceLevel,
                0.95
            ),
            0.50,
            0.999
        );

    /*
     * Approximate normal critical values.
     *
     * These are intentionally bounded constants rather than introducing a
     * heavyweight statistics dependency into the financial core.
     */
    let zScore = 1.96;

    if (
        confidenceLevel >=
        0.99
    ) {

        zScore = 2.576;

    } else if (
        confidenceLevel >=
        0.975
    ) {

        zScore = 2.24;

    } else if (
        confidenceLevel >=
        0.90
    ) {

        zScore = 1.645;

    } else if (
        confidenceLevel >=
        0.80
    ) {

        zScore = 1.282;
    }

    const volatility =
        standardDeviation(
            series
        );

    const margin =
        zScore *
        volatility;

    const normalizedForecast =
        toFiniteNumber(
            forecast
        );

    return {

        forecast:
            round(
                normalizedForecast
            ),

        lower:
            round(
                Math.max(
                    0,
                    normalizedForecast -
                    margin
                )
            ),

        upper:
            round(
                normalizedForecast +
                margin
            ),

        margin:
            round(
                margin
            ),

        volatility:
            round(
                volatility
            ),

        confidenceLevel,

        sufficientData:
            series.length >=
            DEFAULT_CONFIG
                .minimumObservations
    };
}

/**
 * ============================================================================
 * Ensemble Forecast
 * ============================================================================
 */

function ensembleForecast(
    models,
    options = {}
) {

    if (
        !Array.isArray(models) ||
        models.length === 0
    ) {

        return {

            forecast: 0,

            confidence: 0,

            modelsUsed: 0,

            sufficientData: false
        };
    }

    const normalized =
        models
            .map(
                model => {

                    if (
                        typeof model ===
                        'number'
                    ) {

                        return {

                            forecast:
                                model,

                            weight: 1,

                            confidence: 1
                        };
                    }

                    return {

                        forecast:
                            toFiniteNumber(
                                model?.forecast,
                                0
                            ),

                        weight:
                            Math.max(
                                0,
                                toFiniteNumber(
                                    model?.weight,
                                    1
                                )
                            ),

                        confidence:
                            clamp(
                                toFiniteNumber(
                                    model?.confidence,
                                    1
                                ),
                                0,
                                1
                            )
                    };
                }
            )
            .filter(
                model =>
                    model.weight >
                    0
            );

    if (
        !normalized.length
    ) {

        return {

            forecast: 0,

            confidence: 0,

            modelsUsed: 0,

            sufficientData: false
        };
    }

    const totalWeight =
        sum(
            normalized.map(
                model =>
                    model.weight
            )
        );

    const forecast =
        normalized.reduce(
            (
                total,
                model
            ) =>
                total +
                (
                    model.forecast *
                    model.weight
                ),
            0
        ) /
        Math.max(
            totalWeight,
            DEFAULT_CONFIG.epsilon
        );

    const confidence =
        normalized.reduce(
            (
                total,
                model
            ) =>
                total +
                (
                    model.confidence *
                    model.weight
                ),
            0
        ) /
        Math.max(
            totalWeight,
            DEFAULT_CONFIG.epsilon
        );

    return {

        forecast:
            round(
                Math.max(
                    0,
                    forecast
                )
            ),

        confidence:
            round(
                clamp(
                    confidence,
                    0,
                    1
                )
            ),

        modelsUsed:
            normalized.length,

        weights:
            normalized.map(
                model =>
                    round(
                        model.weight /
                        totalWeight
                    )
            ),

        sufficientData:
            normalized.length > 0
    };
}

/**
 * ============================================================================
 * Forecast Confidence
 * ============================================================================
 */

function forecastConfidence(
    options = {}
) {

    const observations =
        Math.max(
            0,
            Math.floor(
                toFiniteNumber(
                    options.observations,
                    0
                )
            )
        );

    const dataQuality =
        clamp(
            toFiniteNumber(
                options.dataQuality,
                0
            ),
            0,
            1
        );

    const modelAccuracy =
        clamp(
            toFiniteNumber(
                options.modelAccuracy,
                0
            ),
            0,
            1
        );

    const stability =
        clamp(
            toFiniteNumber(
                options.stability,
                0
            ),
            0,
            1
        );

    const observationScore =
        clamp(
            observations /
            (
                DEFAULT_CONFIG
                    .confidenceMinimumObservations
            ),
            0,
            1
        );

    const score =
        (
            observationScore *
            0.30
        ) +
        (
            dataQuality *
            0.30
        ) +
        (
            modelAccuracy *
            0.25
        ) +
        (
            stability *
            0.15
        );

    let label =
        FORECAST_CONFIDENCE.LOW;

    if (
        observations <
        DEFAULT_CONFIG
            .minimumObservations
    ) {

        label =
            FORECAST_CONFIDENCE
                .INSUFFICIENT_DATA;

    } else if (
        score >=
        DEFAULT_CONFIG
            .confidenceThresholds
            .high
    ) {

        label =
            FORECAST_CONFIDENCE.HIGH;

    } else if (
        score >=
        DEFAULT_CONFIG
            .confidenceThresholds
            .medium
    ) {

        label =
            FORECAST_CONFIDENCE.MEDIUM;
    }

    return {

        score:
            round(
                clamp(
                    score,
                    0,
                    1
                )
            ),

        label,

        observations,

        dataQuality,

        modelAccuracy,

        stability
    };
}

/**
 * ============================================================================
 * Anomaly Detection
 * ============================================================================
 */

function anomalyScore(
    value,
    values,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    if (
        series.length <
        DEFAULT_CONFIG
            .minimumObservations
    ) {

        return {

            score: 0,

            zScore: 0,

            level:
                ANOMALY_LEVEL
                    .NORMAL,

            sufficientData: false
        };
    }

    const average =
        mean(series);

    const deviation =
        standardDeviation(
            series
        );

    if (
        deviation <=
        DEFAULT_CONFIG.epsilon
    ) {

        return {

            score:
                Math.abs(
                    toFiniteNumber(
                        value
                    ) -
                    average
                ) >
                DEFAULT_CONFIG.epsilon
                    ? 1
                    : 0,

            zScore: 0,

            level:
                ANOMALY_LEVEL
                    .NORMAL,

            sufficientData: true
        };
    }

    const zScore =
        (
            toFiniteNumber(
                value
            ) -
            average
        ) /
        deviation;

    const score =
        clamp(
            Math.abs(
                zScore
            ) /
            4,
            0,
            1
        );

    let level =
        ANOMALY_LEVEL.NORMAL;

    const absoluteZ =
        Math.abs(
            zScore
        );

    if (
        absoluteZ >=
        DEFAULT_CONFIG
            .anomalyThresholds
            .high
    ) {

        level =
            ANOMALY_LEVEL.HIGH;

    } else if (
        absoluteZ >=
        DEFAULT_CONFIG
            .anomalyThresholds
            .medium
    ) {

        level =
            ANOMALY_LEVEL.MEDIUM;

    } else if (
        absoluteZ >=
        DEFAULT_CONFIG
            .anomalyThresholds
            .low
    ) {

        level =
            ANOMALY_LEVEL.LOW;
    }

    return {

        score:
            round(
                score
            ),

        zScore:
            round(
                zScore
            ),

        mean:
            round(
                average
            ),

        standardDeviation:
            round(
                deviation
            ),

        level,

        sufficientData: true
    };
}

/**
 * ============================================================================
 * Reliability Score
 * ============================================================================
 */

function reliabilityScore(
    metrics = {},
    options = {}
) {

    const weights = {

        ...DEFAULT_CONFIG
            .reliabilityWeights,

        ...(options.weights || {})
    };

    const successRate =
        clamp(
            toFiniteNumber(
                metrics.successRate,
                0
            ),
            0,
            1
        );

    const failureRate =
        clamp(
            toFiniteNumber(
                metrics.failureRate,
                1
            ),
            0,
            1
        );

    const latencyScore =
        clamp(
            toFiniteNumber(
                metrics.latencyScore,
                metrics.latencyReliability ||
                0
            ),
            0,
            1
        );

    const volatilityScore =
        clamp(
            toFiniteNumber(
                metrics.volatilityScore,
                metrics.stability ||
                0
            ),
            0,
            1
        );

    const consistencyScore =
        clamp(
            toFiniteNumber(
                metrics.consistencyScore,
                metrics.consistency ||
                0
            ),
            0,
            1
        );

    const failureScore =
        1 -
        failureRate;

    const totalWeight =
        sum([
            toFiniteNumber(
                weights.successRate
            ),
            toFiniteNumber(
                weights.latency
            ),
            toFiniteNumber(
                weights.volatility
            ),
            toFiniteNumber(
                weights.failureRate
            ),
            toFiniteNumber(
                weights.consistency
            )
        ]);

    const score =
        totalWeight >
        DEFAULT_CONFIG.epsilon
            ? (
                (
                    successRate *
                    weights.successRate
                ) +
                (
                    latencyScore *
                    weights.latency
                ) +
                (
                    volatilityScore *
                    weights.volatility
                ) +
                (
                    failureScore *
                    weights.failureRate
                ) +
                (
                    consistencyScore *
                    weights.consistency
                )
            ) /
            totalWeight
            : 0;

    let level =
        'LOW';

    if (
        score >= 0.85
    ) {

        level =
            'EXCELLENT';

    } else if (
        score >= 0.70
    ) {

        level =
            'GOOD';

    } else if (
        score >= 0.50
    ) {

        level =
            'DEGRADED';

    } else {

        level =
            'CRITICAL';
    }

    return {

        score:
            round(
                clamp(
                    score,
                    0,
                    1
                )
            ),

        level,

        components: {

            successRate:
                round(
                    successRate
                ),

            failureScore:
                round(
                    failureScore
                ),

            latencyScore:
                round(
                    latencyScore
                ),

            volatilityScore:
                round(
                    volatilityScore
                ),

            consistencyScore:
                round(
                    consistencyScore
                )
        },

        weights
    };
}

/**
 * ============================================================================
 * Capacity Forecast
 * ============================================================================
 */

function capacityForecast(
    demand,
    options = {}
) {

    const expectedDemand =
        Math.max(
            0,
            toFiniteNumber(
                demand,
                0
            )
        );

    const capacityPerUnit =
        Math.max(
            1,
            toFiniteNumber(
                options.capacityPerUnit,
                1
            )
        );

    const availableUnits =
        Math.max(
            1,
            toFiniteNumber(
                options.availableUnits,
                1
            )
        );

    const totalCapacity =
        capacityPerUnit *
        availableUnits;

    const utilization =
        totalCapacity >
        DEFAULT_CONFIG.epsilon
            ? expectedDemand /
              totalCapacity
            : 1;

    const surplus =
        totalCapacity -
        expectedDemand;

    let status =
        'HEALTHY';

    if (
        utilization >= 1
    ) {

        status =
            'OVER_CAPACITY';

    } else if (
        utilization >= 0.85
    ) {

        status =
            'AT_RISK';
    }

    return {

        demand:
            round(
                expectedDemand
            ),

        capacity:
            round(
                totalCapacity
            ),

        utilization:
            round(
                utilization
            ),

        utilizationPercentage:
            round(
                utilization * 100,
                2
            ),

        surplus:
            round(
                surplus
            ),

        status,

        requiredUnits:
            Math.ceil(
                expectedDemand /
                capacityPerUnit
            )
    };
}

/**
 * ============================================================================
 * Rate Forecast
 * ============================================================================
 *
 * Converts count / exposure into a forecastable rate.
 */

function calculateRate(
    numerator,
    denominator
) {

    const safeNumerator =
        Math.max(
            0,
            toFiniteNumber(
                numerator
            )
        );

    const safeDenominator =
        Math.max(
            0,
            toFiniteNumber(
                denominator
            )
        );

    if (
        safeDenominator <=
        DEFAULT_CONFIG.epsilon
    ) {

        return {

            rate: 0,

            percentage: 0,

            sufficientDenominator:
                false
        };
    }

    const rate =
        safeNumerator /
        safeDenominator;

    return {

        rate:
            round(
                rate
            ),

        percentage:
            round(
                rate * 100,
                4
            ),

        numerator:
            safeNumerator,

        denominator:
            safeDenominator,

        sufficientDenominator:
            true
    };
}

/**
 * ============================================================================
 * Model Evaluation
 * ============================================================================
 */

function evaluateForecast(
    actual,
    predicted
) {

    const actualSeries =
        normalizeSeries(
            actual
        );

    const predictedSeries =
        normalizeSeries(
            predicted
        );

    const length =
        Math.min(
            actualSeries.length,
            predictedSeries.length
        );

    if (
        length === 0
    ) {

        return {

            observations: 0,

            mae: 0,

            mse: 0,

            rmse: 0,

            mape: 0,

            accuracy: 0,

            sufficientData: false
        };
    }

    const actualAligned =
        actualSeries.slice(
            0,
            length
        );

    const predictedAligned =
        predictedSeries.slice(
            0,
            length
        );

    const mae =
        meanAbsoluteError(
            actualAligned,
            predictedAligned
        );

    const mse =
        meanSquaredError(
            actualAligned,
            predictedAligned
        );

    const rmse =
        rootMeanSquaredError(
            actualAligned,
            predictedAligned
        );

    const mape =
        meanAbsolutePercentageError(
            actualAligned,
            predictedAligned
        );

    const accuracy =
        clamp(
            1 -
            mape,
            0,
            1
        );

    return {

        observations:
            length,

        mae,

        mse,

        rmse,

        mape,

        accuracy:
            round(
                accuracy
            ),

        sufficientData:
            length >=
            DEFAULT_CONFIG
                .minimumObservations
    };
}

/**
 * ============================================================================
 * Forecast Pipeline
 * ============================================================================
 *
 * Shared high-level model orchestration.
 */

function buildForecast(
    values,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    const horizon =
        Math.max(
            1,
            Math.floor(
                toFiniteNumber(
                    options.horizon,
                    1
                )
            )
        );

    if (
        !series.length
    ) {

        return {

            forecast:
                Array(
                    horizon
                ).fill(0),

            pointForecast: 0,

            confidence:
                forecastConfidence({
                    observations: 0
                }),

            models: {},

            interval:
                forecastInterval(
                    series,
                    0
                ),

            sufficientData: false
        };
    }

    const sma =
        simpleMovingAverage(
            series,
            options.window ||
            DEFAULT_CONFIG
                .movingAverageWindow
        );

    const wma =
        weightedMovingAverage(
            series,
            {
                window:
                    options.window ||
                    DEFAULT_CONFIG
                        .movingAverageWindow
            }
        );

    const ewma =
        exponentialMovingAverage(
            series,
            options.alpha ||
            DEFAULT_CONFIG
                .ewmaAlpha
        );

    const trend =
        linearTrend(
            series,
            options
        );

    const seasonal =
        trendSeasonalForecast(
            series,
            1,
            {
                ...options,

                period:
                    options.period ||
                    7
            }
        );

    const ensemble =
        ensembleForecast(
            [

                {
                    forecast:
                        sma.value,

                    weight:
                        options.smaWeight ??
                        0.20,

                    confidence:
                        sma.sufficientData
                            ? 1
                            : 0
                },

                {
                    forecast:
                        wma.value,

                    weight:
                        options.wmaWeight ??
                        0.20,

                    confidence:
                        wma.sufficientData
                            ? 1
                            : 0
                },

                {
                    forecast:
                        ewma.value,

                    weight:
                        options.ewmaWeight ??
                        0.30,

                    confidence:
                        ewma.sufficientData
                            ? 1
                            : 0
                },

                {
                    forecast:
                        seasonal.forecast,

                    weight:
                        options
                            .seasonalWeight ??
                        0.30,

                    confidence:
                        seasonal
                            .sufficientData
                            ? 1
                            : 0
                }
            ]
        );

    const volatility =
        rollingVolatility(
            series,
            options.window ||
            DEFAULT_CONFIG
                .movingAverageWindow
        );

    const interval =
        forecastInterval(
            series,
            ensemble.forecast,
            options
        );

    const confidence =
        forecastConfidence({

            observations:
                series.length,

            dataQuality:
                clamp(
                    series.length /
                    (
                        DEFAULT_CONFIG
                            .confidenceMinimumObservations
                    ),
                    0,
                    1
                ),

            modelAccuracy:
                ensemble.confidence,

            stability:
                clamp(
                    1 -
                    volatility
                        .coefficientOfVariation,
                    0,
                    1
                )
        });

    const forecast =
        Array.from(
            {
                length:
                    horizon
            },
            (
                _,
                index
            ) => {

                const period =
                    index + 1;

                const projected =
                    trend
                        .sufficientData
                        ? trend.intercept +
                          trend.slope *
                          (
                              series.length -
                              1 +
                              period
                          )
                        : ensemble.forecast;

                const seasonalProjection =
                    trendSeasonalForecast(
                        series,
                        period,
                        {
                            ...options,

                            period:
                                options.period ||
                                7
                        }
                    );

                const blended =
                    (
                        projected *
                        0.40
                    ) +
                    (
                        ensemble.forecast *
                        0.30
                    ) +
                    (
                        seasonalProjection
                            .forecast *
                        0.30
                    );

                return round(
                    Math.max(
                        0,
                        blended
                    )
                );
            }
        );

    return {

        forecast,

        pointForecast:
            round(
                forecast[0]
            ),

        confidence,

        models: {

            simpleMovingAverage:
                sma,

            weightedMovingAverage:
                wma,

            exponentialMovingAverage:
                ewma,

            linearTrend:
                trend,

            seasonal:
                seasonal,

            ensemble
        },

        volatility,

        interval,

        sufficientData:
            series.length >=
            DEFAULT_CONFIG
                .minimumObservations
    };
}

/**
 * ============================================================================
 * Model Registry
 * ============================================================================
 *
 * Central registry allows higher-level engines to dynamically select models
 * without hard-coding implementation details.
 */

const MODEL_REGISTRY =
    Object.freeze({

        simpleMovingAverage,

        weightedMovingAverage,

        exponentialMovingAverage,

        linearTrend,

        trendForecast,

        seasonalBaseline,

        trendSeasonalForecast,

        rollingVolatility,

        forecastInterval,

        ensembleForecast,

        forecastConfidence,

        anomalyScore,

        reliabilityScore,

        capacityForecast,

        calculateRate,

        evaluateForecast,

        buildForecast
    });

function getModel(
    name
) {

    if (
        !name ||
        typeof name !==
        'string'
    ) {

        return null;
    }

    return (
        MODEL_REGISTRY[
            name
        ] ||
        null
    );
}

/**
 * ============================================================================
 * Model Metadata
 * ============================================================================
 */

function getMetadata() {

    return {

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        deterministic:
            true,

        analyticalOnly:
            true,

        models:
            Object.keys(
                MODEL_REGISTRY
            ),

        supportedUseCases: [

            'repair_demand_forecasting',

            'settlement_reliability_forecasting',

            'settlement_failure_rate_forecasting',

            'repair_workload_forecasting',

            'capacity_planning',

            'operational_anomaly_detection',

            'forecast_confidence',

            'forecast_error_evaluation',

            'financial_operations_forecasting'
        ]
    };
}

/**
 * ============================================================================
 * Validation
 * ============================================================================
 */

function validateForecastInput(
    values,
    options = {}
) {

    const series =
        normalizeSeries(
            values
        );

    const minimumObservations =
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

    return {

        valid:
            series.length >=
            minimumObservations,

        observations:
            series.length,

        minimumObservations,

        sufficientData:
            series.length >=
            minimumObservations,

        hasNegativeValues:
            series.some(
                value =>
                    value < 0
            ),

        mean:
            round(
                mean(series)
            ),

        standardDeviation:
            round(
                standardDeviation(
                    series
                )
            )
    };
}

/**
 * ============================================================================
 * Public Model API
 * ============================================================================
 */

const ForecastModels = {

    MODULE_NAME,

    MODULE_VERSION,

    DEFAULT_CONFIG,

    FORECAST_CONFIDENCE,

    TREND_DIRECTION,

    ANOMALY_LEVEL,

    ForecastModelsError,

    /*
     * Numeric primitives
     */
    toFiniteNumber,

    isFiniteNumber,

    clamp,

    round,

    sum,

    mean,

    variance,

    standardDeviation,

    median,

    absoluteDeviation,

    coefficientOfVariation,

    /*
     * Normalization
     */
    normalizeSeries,

    validateForecastInput,

    /*
     * Forecasting models
     */
    simpleMovingAverage,

    weightedMovingAverage,

    exponentialMovingAverage,

    linearTrend,

    trendForecast,

    seasonalBaseline,

    trendSeasonalForecast,

    ensembleForecast,

    buildForecast,

    /*
     * Forecast uncertainty
     */
    forecastInterval,

    forecastConfidence,

    /*
     * Volatility / anomaly
     */
    rollingVolatility,

    anomalyScore,

    /*
     * Reliability / operational models
     */
    reliabilityScore,

    capacityForecast,

    calculateRate,

    /*
     * Model evaluation
     */
    meanAbsoluteError,

    meanSquaredError,

    rootMeanSquaredError,

    meanAbsolutePercentageError,

    evaluateForecast,

    /*
     * Registry
     */
    MODEL_REGISTRY,

    getModel,

    getMetadata
};

/**
 * ============================================================================
 * Factory
 * ============================================================================
 */

function createForecastModels(
    options = {}
) {

    /*
     * The model collection is stateless by default. A factory is provided so
     * future configuration can be introduced without changing consumers.
     */
    const config = {

        ...DEFAULT_CONFIG,

        ...(options.config || {})
    };

    return {

        config,

        ...ForecastModels
    };
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    ForecastModels;

module.exports.ForecastModels =
    ForecastModels;

module.exports.ForecastModelsError =
    ForecastModelsError;

module.exports.createForecastModels =
    createForecastModels;

module.exports.MODEL_REGISTRY =
    MODEL_REGISTRY;