'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Financial Period Validator
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/services/periodValidator.js
 *
 * Purpose:
 *   Enterprise validation boundary for financial periods.
 *
 * Responsibilities:
 *   - Validate period start/end dates
 *   - Reject missing and invalid dates
 *   - Enforce chronological ordering
 *   - Validate fiscal-year membership
 *   - Validate posting eligibility
 *   - Provide structured validation results
 *   - Preserve compatibility with the existing validateDates() API
 *
 * IMPORTANT:
 *   This validator does not mutate periods and does not perform ledger
 *   operations.
 *
 * ============================================================================
 */

'use strict';

const MAX_SUPPORTED_YEAR = 9999;
const MIN_SUPPORTED_YEAR = 1900;

/* ============================================================================
 * Constants
 * ========================================================================== */

const STATUS = Object.freeze({
    OPEN: 'OPEN',
    LOCKED: 'LOCKED',
    CLOSED: 'CLOSED',
    REOPENED: 'REOPENED',
    ADJUSTMENT: 'ADJUSTMENT',
    CANCELLED: 'CANCELLED'
});

const DEFAULT_OPTIONS = Object.freeze({
    requireStartDate: true,
    requireEndDate: true,
    allowSameDayPeriod: false,
    requireSameCalendarYear: false
});

/* ============================================================================
 * Error-safe date normalization
 * ========================================================================== */

function normalizeDate(
    value
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(
                value
            );

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        return null;
    }

    return date;
}

function isValidDate(
    value
) {
    return (
        value instanceof Date &&
        !Number.isNaN(
            value.getTime()
        )
    );
}

function normalizeYear(
    year
) {
    if (
        year === undefined ||
        year === null ||
        year === ''
    ) {
        return null;
    }

    const numericYear =
        Number(year);

    if (
        !Number.isInteger(
            numericYear
        ) ||
        numericYear <
            MIN_SUPPORTED_YEAR ||
        numericYear >
            MAX_SUPPORTED_YEAR
    ) {
        return null;
    }

    return numericYear;
}

/* ============================================================================
 * Period Validator
 * ========================================================================== */

class PeriodValidator {

    constructor(options = {}) {

        this.config = {
            ...DEFAULT_OPTIONS,
            ...options
        };

        this.statuses =
            new Set(
                Object.values(
                    STATUS
                )
            );
    }

    /* ========================================================================
     * Validate Dates
     * ====================================================================== */

    validateDates({
        startDate,
        endDate
    } = {}) {

        const errors = [];

        const normalizedStart =
            normalizeDate(
                startDate
            );

        const normalizedEnd =
            normalizeDate(
                endDate
            );

        /*
         * Presence validation.
         */

        if (
            this.config
                .requireStartDate &&
            (
                startDate ===
                undefined ||
                startDate ===
                null ||
                startDate === ''
            )
        ) {
            errors.push(
                'Start date is required'
            );
        }

        if (
            this.config
                .requireEndDate &&
            (
                endDate ===
                undefined ||
                endDate ===
                null ||
                endDate === ''
            )
        ) {
            errors.push(
                'End date is required'
            );
        }

        /*
         * Date validity.
         */

        if (
            startDate !==
                undefined &&
            startDate !==
                null &&
            startDate !== '' &&
            !isValidDate(
                normalizedStart
            )
        ) {
            errors.push(
                'Start date must be a valid date'
            );
        }

        if (
            endDate !==
                undefined &&
            endDate !==
                null &&
            endDate !== '' &&
            !isValidDate(
                normalizedEnd
            )
        ) {
            errors.push(
                'End date must be a valid date'
            );
        }

        /*
         * Chronological validation.
         */

        if (
            isValidDate(
                normalizedStart
            ) &&
            isValidDate(
                normalizedEnd
            )
        ) {

            if (
                normalizedStart >
                normalizedEnd
            ) {
                errors.push(
                    'Start date must be before end date'
                );
            }

            if (
                !this.config
                    .allowSameDayPeriod &&
                normalizedStart.getTime() ===
                    normalizedEnd.getTime()
            ) {
                errors.push(
                    'Start date and end date cannot be the same'
                );
            }
        }

        /*
         * Optional same-calendar-year requirement.
         */

        if (
            this.config
                .requireSameCalendarYear &&
            isValidDate(
                normalizedStart
            ) &&
            isValidDate(
                normalizedEnd
            ) &&
            normalizedStart
                .getFullYear() !==
                normalizedEnd
                    .getFullYear()
        ) {
            errors.push(
                'Start date and end date must belong to the same calendar year'
            );
        }

        return {
            valid:
                errors.length === 0,

            errors,

            startDate:
                normalizedStart,

            endDate:
                normalizedEnd
        };
    }

    /* ========================================================================
     * Validate Fiscal Year
     * ====================================================================== */

    validateFiscalYear({
        startDate,
        endDate,
        fiscalYear
    } = {}) {

        const errors = [];

        const dateValidation =
            this.validateDates({
                startDate,
                endDate
            });

        errors.push(
            ...dateValidation.errors
        );

        const normalizedYear =
            normalizeYear(
                fiscalYear
            );

        if (
            fiscalYear ===
                undefined ||
            fiscalYear ===
                null ||
            fiscalYear === ''
        ) {
            errors.push(
                'Fiscal year is required'
            );
        } else if (
            normalizedYear === null
        ) {
            errors.push(
                'Fiscal year must be a valid four-digit year'
            );
        }

        if (
            normalizedYear !== null &&
            isValidDate(
                dateValidation.startDate
            ) &&
            isValidDate(
                dateValidation.endDate
            )
        ) {

            if (
                dateValidation
                    .startDate
                    .getFullYear() !==
                normalizedYear
            ) {
                errors.push(
                    'Start date does not belong to the specified fiscal year'
                );
            }

            if (
                dateValidation
                    .endDate
                    .getFullYear() !==
                normalizedYear
            ) {
                errors.push(
                    'End date does not belong to the specified fiscal year'
                );
            }
        }

        return {
            valid:
                errors.length === 0,

            errors,

            fiscalYear:
                normalizedYear,

            startDate:
                dateValidation.startDate,

            endDate:
                dateValidation.endDate
        };
    }

    /* ========================================================================
     * Validate Period Object
     * ====================================================================== */

    validatePeriod({
        period
    } = {}) {

        const errors = [];

        if (
            !period ||
            typeof period !==
                'object'
        ) {
            return {
                valid: false,

                errors: [
                    'Period is required'
                ]
            };
        }

        if (
            !period.tenantId
        ) {
            errors.push(
                'Period tenantId is required'
            );
        }

        if (
            period.id ===
                undefined ||
            period.id ===
                null ||
            period.id === ''
        ) {
            errors.push(
                'Period id is required'
            );
        }

        const dateValidation =
            this.validateDates({
                startDate:
                    period.startDate,

                endDate:
                    period.endDate
            });

        errors.push(
            ...dateValidation.errors
        );

        if (
            period.fiscalYear !==
                undefined &&
            period.fiscalYear !==
                null
        ) {

            const fiscalYearValidation =
                this.validateFiscalYear({
                    startDate:
                        period.startDate,

                    endDate:
                        period.endDate,

                    fiscalYear:
                        period.fiscalYear
                });

            errors.push(
                ...fiscalYearValidation.errors
            );
        }

        if (
            period.status !==
                undefined &&
            period.status !==
                null
        ) {

            const normalizedStatus =
                String(
                    period.status
                )
                    .trim()
                    .toUpperCase();

            if (
                !this.statuses.has(
                    normalizedStatus
                )
            ) {
                errors.push(
                    `Invalid period status: ${period.status}`
                );
            }
        }

        return {
            valid:
                errors.length === 0,

            errors,

            normalized: {
                ...period,

                startDate:
                    dateValidation.startDate,

                endDate:
                    dateValidation.endDate,

                status:
                    period.status
                        ? String(
                            period.status
                        )
                            .trim()
                            .toUpperCase()
                        : undefined
            }
        };
    }

    /* ========================================================================
     * Validate Posting Eligibility
     * ====================================================================== */

    validatePostingPeriod({
        period,
        transactionDate
    } = {}) {

        const errors = [];

        if (
            !period
        ) {
            return {
                valid: false,

                errors: [
                    'Period is required'
                ]
            };
        }

        const normalizedDate =
            normalizeDate(
                transactionDate
            );

        if (
            !normalizedDate
        ) {
            errors.push(
                'Transaction date must be a valid date'
            );
        }

        const normalizedStatus =
            String(
                period.status ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            normalizedStatus !==
            STATUS.OPEN
        ) {
            errors.push(
                `Posting is not permitted in period status ${normalizedStatus || 'UNKNOWN'}`
            );
        }

        const start =
            normalizeDate(
                period.startDate
            );

        const end =
            normalizeDate(
                period.endDate
            );

        if (
            !start
        ) {
            errors.push(
                'Period startDate is invalid'
            );
        }

        if (
            !end
        ) {
            errors.push(
                'Period endDate is invalid'
            );
        }

        if (
            normalizedDate &&
            start &&
            end
        ) {

            if (
                normalizedDate <
                start ||
                normalizedDate >
                end
            ) {
                errors.push(
                    'Transaction date falls outside the accounting period'
                );
            }
        }

        return {
            valid:
                errors.length === 0,

            errors,

            periodId:
                period.id || null,

            tenantId:
                period.tenantId ||
                null,

            transactionDate:
                normalizedDate
        };
    }

    /* ========================================================================
     * Validate Period Transition
     * ====================================================================== */

    validateTransition({
        currentStatus,
        nextStatus
    } = {}) {

        const current =
            String(
                currentStatus ||
                ''
            )
                .trim()
                .toUpperCase();

        const next =
            String(
                nextStatus ||
                ''
            )
                .trim()
                .toUpperCase();

        const errors = [];

        if (
            !this.statuses.has(
                current
            )
        ) {
            errors.push(
                `Invalid current period status: ${currentStatus}`
            );
        }

        if (
            !this.statuses.has(
                next
            )
        ) {
            errors.push(
                `Invalid next period status: ${nextStatus}`
            );
        }

        if (
            errors.length === 0 &&
            !this.isAllowedTransition(
                current,
                next
            )
        ) {
            errors.push(
                `Invalid period transition: ${current} -> ${next}`
            );
        }

        return {
            valid:
                errors.length === 0,

            errors,

            from:
                current,

            to:
                next
        };
    }

    /* ========================================================================
     * Allowed State Transitions
     * ====================================================================== */

    isAllowedTransition(
        current,
        next
    ) {

        const transitions = {
            [STATUS.OPEN]: [
                STATUS.LOCKED,
                STATUS.CANCELLED
            ],

            [STATUS.LOCKED]: [
                STATUS.CLOSED,
                STATUS.OPEN,
                STATUS.CANCELLED
            ],

            [STATUS.CLOSED]: [
                STATUS.REOPENED
            ],

            [STATUS.REOPENED]: [
                STATUS.OPEN,
                STATUS.LOCKED
            ],

            [STATUS.ADJUSTMENT]: [
                STATUS.OPEN,
                STATUS.CLOSED,
                STATUS.CANCELLED
            ],

            [STATUS.CANCELLED]: []
        };

        return (
            transitions[
                current
            ] || []
        ).includes(
            next
        );
    }

    /* ========================================================================
     * Validate Date Inclusion
     * ====================================================================== */

    containsDate({
        period,
        date
    } = {}) {

        const errors = [];

        if (
            !period
        ) {
            errors.push(
                'Period is required'
            );
        }

        const normalizedDate =
            normalizeDate(
                date
            );

        if (
            !normalizedDate
        ) {
            errors.push(
                'Date must be valid'
            );
        }

        const start =
            normalizeDate(
                period?.startDate
            );

        const end =
            normalizeDate(
                period?.endDate
            );

        if (
            !start
        ) {
            errors.push(
                'Period startDate is invalid'
            );
        }

        if (
            !end
        ) {
            errors.push(
                'Period endDate is invalid'
            );
        }

        const contained =
            errors.length === 0 &&
            normalizedDate >= start &&
            normalizedDate <= end;

        return {
            valid:
                errors.length === 0,

            contained,

            errors,

            date:
                normalizedDate
        };
    }

    /* ========================================================================
     * Validate Period Collection
     * ====================================================================== */

    validatePeriods({
        periods
    } = {}) {

        const errors = [];

        if (
            !Array.isArray(
                periods
            )
        ) {
            return {
                valid: false,

                errors: [
                    'periods must be an array'
                ]
            };
        }

        if (
            periods.length === 0
        ) {
            return {
                valid: false,

                errors: [
                    'periods must not be empty'
                ]
            };
        }

        const normalized =
            periods.map(
                (
                    period,
                    index
                ) => {

                    const validation =
                        this.validatePeriod({
                            period
                        });

                    if (
                        !validation.valid
                    ) {

                        errors.push(
                            ...validation.errors.map(
                                error =>
                                    `period[${index}]: ${error}`
                            )
                        );
                    }

                    return validation
                        .normalized;
                }
            );

        /*
         * Sort a copy rather than mutating caller data.
         */
        const sorted =
            [...normalized]
                .filter(Boolean)
                .sort(
                    (
                        left,
                        right
                    ) => {

                        const leftTime =
                            left.startDate instanceof Date
                                ? left.startDate
                                    .getTime()
                                : 0;

                        const rightTime =
                            right.startDate instanceof Date
                                ? right.startDate
                                    .getTime()
                                : 0;

                        return (
                            leftTime -
                            rightTime
                        );
                    }
                );

        for (
            let index = 1;
            index < sorted.length;
            index += 1
        ) {

            const previous =
                sorted[
                    index - 1
                ];

            const current =
                sorted[
                    index
                ];

            if (
                previous.endDate >=
                current.startDate
            ) {
                errors.push(
                    `Overlapping periods detected between ${previous.id || index - 1} and ${current.id || index}`
                );
            }
        }

        return {
            valid:
                errors.length === 0,

            errors,

            periods:
                normalized
        };
    }

    /* ========================================================================
     * Diagnostics
     * ====================================================================== */

    diagnostics() {

        return {
            module:
                'PeriodValidator',

            supportedStatuses:
                Object.values(
                    STATUS
                ),

            configuration: {
                ...this.config
            },

            timestamp:
                new Date()
                    .toISOString()
        };
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

PeriodValidator.STATUS =
    STATUS;

PeriodValidator.DEFAULT_OPTIONS =
    DEFAULT_OPTIONS;

/* ============================================================================
 * Module export
 * ========================================================================== */

module.exports =
    PeriodValidator;