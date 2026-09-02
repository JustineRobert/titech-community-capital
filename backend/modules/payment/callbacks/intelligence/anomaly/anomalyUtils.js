/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Callback Anomaly Utilities
 * ============================================================================
 *
 * Enterprise Features
 * -------------------
 * • Statistical Calculations
 * • Latency Analysis
 * • Failure Rate Calculations
 * • Moving Average Utilities
 * • Standard Deviation
 * • Callback Grouping
 * • Duplicate Detection Helpers
 * • Outlier Detection
 * • Timestamp Normalization
 * • Provider Normalization
 * • Immutable Utility Functions
 * • Zero Business Rules
 * • Deterministic Results
 *
 * Purpose
 * -------
 * Provides shared mathematical, statistical and normalization utilities for
 * the Enterprise Callback Anomaly Detection subsystem.
 *
 * Design Principles
 * -----------------
 * • Pure Functions
 * • No Side Effects
 * • No External State
 * • Provider Independent
 * • Business Rule Free
 * • Reusable Across Detectors
 *
 * Every anomaly detector should rely on these shared helpers instead of
 * duplicating calculations.
 * ============================================================================
 */

/**
 * --------------------------------------------------------------------------
 * Calculate Percentage
 * --------------------------------------------------------------------------
 */

function calculatePercentage(value, total) {

    if (total <= 0) {
        return 0;
    }

    return (value / total) * 100;

}

/**
 * --------------------------------------------------------------------------
 * Calculate Average
 * --------------------------------------------------------------------------
 */

function calculateAverage(values = []) {

    if (!values.length) {
        return 0;
    }

    return values.reduce(

        (sum, value) => sum + Number(value),

        0

    ) / values.length;

}

/**
 * --------------------------------------------------------------------------
 * Calculate Average Latency
 * --------------------------------------------------------------------------
 */

function calculateAverageLatency(callbacks = []) {

    if (!callbacks.length) {
        return 0;
    }

    const latencies = callbacks.map(

        callback => Number(callback.latencyMs || 0)

    );

    return calculateAverage(latencies);

}

/**
 * --------------------------------------------------------------------------
 * Calculate Failure Rate
 * --------------------------------------------------------------------------
 */

function calculateFailureRate(callbacks = []) {

    if (!callbacks.length) {
        return 0;
    }

    const failures = callbacks.filter(

        callback => callback.status === "FAILED"

    ).length;

    return calculatePercentage(

        failures,

        callbacks.length

    );

}

/**
 * --------------------------------------------------------------------------
 * Moving Average
 * --------------------------------------------------------------------------
 */

function calculateMovingAverage(

    values = [],

    windowSize = 5

) {

    if (!values.length) {
        return [];
    }

    const averages = [];

    for (

        let i = 0;

        i < values.length;

        i++

    ) {

        const start = Math.max(

            0,

            i - windowSize + 1

        );

        const window = values.slice(

            start,

            i + 1

        );

        averages.push(

            calculateAverage(window)

        );

    }

    return averages;

}

/**
 * --------------------------------------------------------------------------
 * Standard Deviation
 * --------------------------------------------------------------------------
 */

function calculateStandardDeviation(values = []) {

    if (values.length <= 1) {

        return 0;

    }

    const mean = calculateAverage(values);

    const variance =

        values.reduce(

            (sum, value) =>

                sum +

                Math.pow(value - mean, 2),

            0

        ) / values.length;

    return Math.sqrt(variance);

}

/**
 * --------------------------------------------------------------------------
 * Group Callbacks By Provider
 * --------------------------------------------------------------------------
 */

function groupCallbacksByProvider(callbacks = []) {

    return callbacks.reduce(

        (groups, callback) => {

            const provider = normalizeProvider(

                callback.provider

            );

            if (!groups[provider]) {

                groups[provider] = [];

            }

            groups[provider].push(callback);

            return groups;

        },

        {}

    );

}

/**
 * --------------------------------------------------------------------------
 * Duplicate Reference Detection
 * --------------------------------------------------------------------------
 */

function isDuplicateReference(

    reference,

    references = []

) {

    return references.includes(reference);

}

/**
 * --------------------------------------------------------------------------
 * Outlier Detection (Z-Score)
 * --------------------------------------------------------------------------
 */

function isOutlier(

    value,

    values = [],

    threshold = 3

) {

    if (values.length < 2) {

        return false;

    }

    const mean = calculateAverage(values);

    const deviation =

        calculateStandardDeviation(values);

    if (deviation === 0) {

        return false;

    }

    const zScore =

        Math.abs(

            (value - mean) /

            deviation

        );

    return zScore > threshold;

}

/**
 * --------------------------------------------------------------------------
 * Normalize Timestamp
 * --------------------------------------------------------------------------
 */

function normalizeTimestamp(timestamp) {

    if (!timestamp) {

        return null;

    }

    const date =

        new Date(timestamp);

    if (

        Number.isNaN(

            date.getTime()

        )

    ) {

        return null;

    }

    return date;

}

/**
 * --------------------------------------------------------------------------
 * Normalize Provider
 * --------------------------------------------------------------------------
 */

function normalizeProvider(provider) {

    if (!provider) {

        return "";

    }

    return String(provider)

        .trim()

        .toLowerCase()

        .replace(/\s+/g, "_");

}

/**
 * --------------------------------------------------------------------------
 * Calculate Median
 * --------------------------------------------------------------------------
 */

function calculateMedian(values = []) {

    if (!values.length) {

        return 0;

    }

    const sorted =

        [...values]

        .sort(

            (a, b) => a - b

        );

    const middle =

        Math.floor(

            sorted.length / 2

        );

    return sorted.length % 2 === 0

        ? (

            sorted[middle - 1] +

            sorted[middle]

        ) / 2

        : sorted[middle];

}

/**
 * --------------------------------------------------------------------------
 * Calculate Success Rate
 * --------------------------------------------------------------------------
 */

function calculateSuccessRate(callbacks = []) {

    if (!callbacks.length) {

        return 0;

    }

    const successful = callbacks.filter(

        callback =>

            callback.status === "SUCCESS"

    ).length;

    return calculatePercentage(

        successful,

        callbacks.length

    );

}

/**
 * --------------------------------------------------------------------------
 * Module Exports
 * --------------------------------------------------------------------------
 */

module.exports = Object.freeze({

    calculatePercentage,

    calculateAverage,

    calculateAverageLatency,

    calculateFailureRate,

    calculateMovingAverage,

    calculateStandardDeviation,

    calculateMedian,

    calculateSuccessRate,

    groupCallbacksByProvider,

    isDuplicateReference,

    isOutlier,

    normalizeTimestamp,

    normalizeProvider

});