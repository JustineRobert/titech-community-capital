'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Regulatory Calendar Service
 * ============================================================================
 *
 * File:
 * backend/modules/compliance/regulatory/RegulatoryCalendarService.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Central application service for regulatory reporting calendars.
 *
 * This service is deliberately jurisdiction-neutral.
 *
 * Country/regulator-specific calendar rules belong to the concrete regulatory
 * adapter resolved through RegulatoryAdapterRegistry.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Resolve the correct regulatory adapter
 * - Resolve tenant/jurisdiction context
 * - Determine reporting periods
 * - Determine filing deadlines
 * - Determine whether a report is due
 * - Determine whether a date is inside a filing window
 * - Apply adapter-provided calendar semantics
 * - Handle timezone-aware date boundaries
 * - Handle weekends / holidays when supplied by adapters
 * - Normalize calendar responses
 * - Produce deterministic calendar fingerprints
 * - Produce audit-friendly calendar snapshots
 * - Support due-soon / overdue calculations
 *
 * Explicitly NOT Responsible For
 * ----------------------------------------------------------------------------
 * - Country-specific legislation
 * - Regulator-specific thresholds
 * - Regulatory report transformation
 * - Regulator authentication
 * - Submission transport
 * - Regulator acknowledgement parsing
 * - Financial calculations
 * - Ledger posting
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *                 RegulatoryReportingService
 *                           │
 *                           ▼
 *                RegulatoryCalendarService
 *                           │
 *                           ▼
 *                RegulatoryAdapterRegistry
 *                           │
 *               ┌───────────┼───────────┐
 *               ▼           ▼           ▼
 *            Country      Regulator   Jurisdiction
 *             Adapter       Rules       Calendar
 *                           │
 *                           ▼
 *                    Calendar Result
 *                           │
 *          ┌────────────────┼────────────────┐
 *          ▼                ▼                ▼
 *      Reporting         Deadline         Due Status
 *       Period
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Tenant isolation
 * - Adapter-owned regulatory semantics
 * - Deterministic calculations
 * - Explicit timezone handling
 * - Immutable result snapshots
 * - Fail-closed on missing jurisdiction configuration
 * - Safe date normalization
 * - No hidden current-time dependence in deterministic calculations
 * - Audit-friendly provenance
 *
 * ============================================================================
 */

const crypto = require('crypto');

const {
    CAPABILITIES,
    REPORT_TYPES,
} = require('./RegulatoryAdapterInterface');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const SERVICE_NAME =
    'RegulatoryCalendarService';

const SERVICE_VERSION =
    '1.0.0';

const DEFAULT_TIMEZONE =
    'UTC';

const DEFAULT_DUE_SOON_DAYS =
    7;

const MAX_DUE_SOON_DAYS =
    366;

const MAX_CALENDAR_LOOKAHEAD_DAYS =
    3660;

const MAX_HOLIDAYS =
    1000;

const MAX_PERIODS =
    5000;

/**
 * ============================================================================
 * Calendar Status
 * ============================================================================
 */

const CALENDAR_STATUS =
    Object.freeze({

        NOT_DUE:
            'NOT_DUE',

        DUE:
            'DUE',

        DUE_SOON:
            'DUE_SOON',

        OVERDUE:
            'OVERDUE',

        CLOSED:
            'CLOSED',

        NOT_SUPPORTED:
            'NOT_SUPPORTED',

    });

/**
 * ============================================================================
 * Filing Window Status
 * ============================================================================
 */

const WINDOW_STATUS =
    Object.freeze({

        OPEN:
            'OPEN',

        CLOSED:
            'CLOSED',

        NOT_YET_OPEN:
            'NOT_YET_OPEN',

        UNKNOWN:
            'UNKNOWN',

    });

/**
 * ============================================================================
 * Helper Functions
 * ============================================================================
 */

function isPlainObject(
    value
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function normalizeRequiredString(
    value,
    field,
    maxLength
) {
    if (
        typeof value !== 'string' ||
        value.trim() === ''
    ) {
        throw new TypeError(
            `${field} is required`
        );
    }

    const normalized =
        value.trim();

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizeOptionalString(
    value,
    field,
    maxLength
) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return null;
    }

    if (
        typeof value !== 'string'
    ) {
        throw new TypeError(
            `${field} must be a string`
        );
    }

    const normalized =
        value.trim();

    if (
        !normalized
    ) {
        return null;
    }

    if (
        normalized.length >
        maxLength
    ) {
        throw new RangeError(
            `${field} exceeds maximum length`
        );
    }

    return normalized;
}

function normalizePositiveInteger(
    value,
    fallback,
    {
        min = 1,
        max = Number.MAX_SAFE_INTEGER,
        field = 'value',
    } = {}
) {
    const number =
        Number(value);

    if (
        !Number.isSafeInteger(
            number
        ) ||
        number < min ||
        number > max
    ) {
        return fallback;
    }

    return number;
}

function toDate(
    value,
    field = 'date'
) {
    if (
        value instanceof Date
    ) {
        const date =
            new Date(
                value.getTime()
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            throw new TypeError(
                `${field} must be a valid date`
            );
        }

        return date;
    }

    if (
        typeof value === 'string' ||
        typeof value === 'number'
    ) {
        const date =
            new Date(
                value
            );

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            throw new TypeError(
                `${field} must be a valid date`
            );
        }

        return date;
    }

    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    throw new TypeError(
        `${field} must be a Date, ISO string, or timestamp`
    );
}

function startOfUtcDay(
    date
) {
    const result =
        new Date(
            date.getTime()
        );

    result.setUTCHours(
        0,
        0,
        0,
        0
    );

    return result;
}

function endOfUtcDay(
    date
) {
    const result =
        startOfUtcDay(
            date
        );

    result.setUTCHours(
        23,
        59,
        59,
        999
    );

    return result;
}

function addDaysUtc(
    date,
    days
) {
    const result =
        new Date(
            date.getTime()
        );

    result.setUTCDate(
        result.getUTCDate() +
        days
    );

    return result;
}

function diffDaysUtc(
    from,
    to
) {
    const fromDay =
        startOfUtcDay(
            from
        );

    const toDay =
        startOfUtcDay(
            to
        );

    return Math.floor(
        (
            toDay.getTime() -
            fromDay.getTime()
        ) /
        86400000
    );
}

function isWeekendUtc(
    date
) {
    const day =
        date.getUTCDay();

    return (
        day === 0 ||
        day === 6
    );
}

function cloneValue(
    value,
    seen = new WeakMap()
) {
    if (
        value === null ||
        value === undefined ||
        typeof value !== 'object'
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        seen.has(value)
    ) {
        return seen.get(
            value
        );
    }

    if (
        Array.isArray(value)
    ) {
        const array = [];

        seen.set(
            value,
            array
        );

        for (
            const item of value
        ) {
            array.push(
                cloneValue(
                    item,
                    seen
                )
            );
        }

        return array;
    }

    const result = {};

    seen.set(
        value,
        result
    );

    for (
        const [
            key,
            child
        ] of Object.entries(
            value
        )
    ) {
        result[key] =
            cloneValue(
                child,
                seen
            );
    }

    return result;
}

function deepFreeze(
    value,
    seen = new WeakSet()
) {
    if (
        value === null ||
        typeof value !== 'object' ||
        seen.has(value)
    ) {
        return value;
    }

    if (
        value instanceof Date
    ) {
        return value;
    }

    seen.add(
        value
    );

    for (
        const child
        of Object.values(
            value
        )
    ) {
        deepFreeze(
            child,
            seen
        );
    }

    return Object.freeze(
        value
    );
}

function stableSerialize(
    value
) {
    if (
        value === null ||
        value === undefined
    ) {
        return JSON.stringify(
            value
        );
    }

    if (
        value instanceof Date
    ) {
        return JSON.stringify(
            value.toISOString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return `[${value
            .map(
                stableSerialize
            )
            .join(',')}]`;
    }

    if (
        typeof value === 'object'
    ) {
        return `{${Object.keys(
            value
        )
            .sort()
            .map(
                key =>
                    `${JSON.stringify(
                        key
                    )}:${stableSerialize(
                        value[key]
                    )}`
            )
            .join(',')}}`;
    }

    return JSON.stringify(
        value
    );
}

function sha256(
    value
) {
    return crypto
        .createHash(
            'sha256'
        )
        .update(
            value,
            'utf8'
        )
        .digest('hex');
}

function normalizeReportType(
    reportType
) {
    const normalized =
        normalizeRequiredString(
            reportType,
            'reportType',
            64
        ).toUpperCase();

    if (
        !Object.values(
            REPORT_TYPES
        ).includes(
            normalized
        )
    ) {
        throw new TypeError(
            `Unsupported report type: ${normalized}`
        );
    }

    return normalized;
}

function normalizeTimezone(
    timezone
) {
    if (
        timezone === undefined ||
        timezone === null ||
        timezone === ''
    ) {
        return DEFAULT_TIMEZONE;
    }

    const normalized =
        normalizeRequiredString(
            timezone,
            'timezone',
            128
        );

    /**
     * Validate the timezone using Intl rather than maintaining a hardcoded
     * IANA timezone list.
     */
    try {
        new Intl.DateTimeFormat(
            'en-US',
            {
                timeZone:
                    normalized,
            }
        ).format();

        return normalized;

    } catch (
        error
    ) {
        throw new TypeError(
            `Invalid IANA timezone: ${normalized}`
        );
    }
}

/**
 * ============================================================================
 * Service
 * ============================================================================
 */

class RegulatoryCalendarService {

    constructor(
        options = {}
    ) {

        this.registry =
            options.registry ||
            options.adapterRegistry ||
            null;

        this.logger =
            options.logger ||
            console;

        this.metrics =
            options.metrics ||
            null;

        this.defaultTimezone =
            normalizeTimezone(
                options.defaultTimezone ||
                DEFAULT_TIMEZONE
            );

        this.dueSoonDays =
            normalizePositiveInteger(
                options.dueSoonDays,
                DEFAULT_DUE_SOON_DAYS,
                {
                    min:
                        1,

                    max:
                        MAX_DUE_SOON_DAYS,

                    field:
                        'dueSoonDays',
                }
            );

        /**
         * By default, calendar resolution must have an adapter.
         *
         * This prevents silently treating "no adapter" as "no deadline".
         */
        this.requireAdapter =
            options.requireAdapter !==
                undefined
                ? Boolean(
                    options.requireAdapter
                )
                : true;
    }

    /**
     * =========================================================================
     * Resolve Adapter
     * =========================================================================
     */

    resolveAdapter(
        context = {}
    ) {
        if (
            !this.registry
        ) {
            if (
                this.requireAdapter
            ) {
                throw this.createError(
                    'REGULATORY_CALENDAR_REGISTRY_REQUIRED',
                    'Regulatory adapter registry is required.'
                );
            }

            return null;
        }

        if (
            context.adapter
        ) {
            return context.adapter;
        }

        if (
            typeof this.registry.resolveForReport ===
                'function' &&
            context.report
        ) {
            return this.registry.resolveForReport(
                context.report,
                context
            );
        }

        if (
            typeof this.registry.resolve ===
                'function'
        ) {
            return this.registry.resolve({
                tenantId:
                    context.tenantId,

                adapterName:
                    context.adapterName,

                version:
                    context.adapterVersion ||
                    context.version,

                countryCode:
                    context.countryCode,

                jurisdiction:
                    context.jurisdiction,

                regulatorCode:
                    context.regulatorCode,

                reportType:
                    context.reportType,

                capability:
                    context.capability ||
                    CAPABILITIES.CALENDAR,
            });
        }

        throw this.createError(
            'REGULATORY_CALENDAR_REGISTRY_INVALID',
            'Regulatory adapter registry does not provide a compatible resolve operation.'
        );
    }

    /**
     * =========================================================================
     * Build Calendar Context
     * =========================================================================
     */

    buildContext(
        input = {}
    ) {
        if (
            !isPlainObject(
                input
            )
        ) {
            throw new TypeError(
                'Regulatory calendar context must be an object'
            );
        }

        const report =
            input.report ||
            null;

        const tenantId =
            input.tenantId ||
            report?.tenantId ||
            null;

        const reportType =
            input.reportType ||
            report?.type ||
            null;

        return {
            ...input,

            tenantId:
                tenantId
                    ? String(
                        tenantId
                    ).trim()
                    : null,

            reportType:
                reportType
                    ? normalizeReportType(
                        reportType
                    )
                    : null,

            timezone:
                normalizeTimezone(
                    input.timezone ||
                    this.defaultTimezone
                ),

            asOf:
                input.asOf
                    ? toDate(
                        input.asOf,
                        'asOf'
                    )
                    : new Date(),

            now:
                input.now
                    ? toDate(
                        input.now,
                        'now'
                    )
                    : new Date(),
        };
    }

    /**
     * =========================================================================
     * Get Reporting Calendar
     * =========================================================================
     */

    getReportingCalendar(
        input = {}
    ) {
        const context =
            this.buildContext(
                input
            );

        const adapter =
            this.resolveAdapter(
                context
            );

        if (
            !adapter
        ) {
            return this.createUnsupportedCalendar(
                context
            );
        }

        this.assertTenantContext(
            context,
            adapter
        );

        if (
            typeof adapter.getReportingCalendar !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_NOT_SUPPORTED',
                'Resolved regulatory adapter does not implement calendar support.',
                context
            );
        }

        const calendar =
            adapter.getReportingCalendar(
                context
            );

        return this.normalizeCalendar(
            calendar,
            context,
            adapter
        );
    }

    /**
     * =========================================================================
     * Get Reporting Period
     * =========================================================================
     *
     * Adapters may provide:
     *
     * {
     *   periodStart,
     *   periodEnd,
     *   filingOpenAt,
     *   deadlineAt,
     *   timezone,
     *   periodType,
     *   status
     * }
     */

    getReportingPeriod(
        input = {}
    ) {
        const context =
            this.buildContext(
                input
            );

        const adapter =
            this.resolveAdapter(
                context
            );

        if (
            !adapter
        ) {
            return null;
        }

        this.assertTenantContext(
            context,
            adapter
        );

        if (
            typeof adapter.getReportingCalendar !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_NOT_SUPPORTED',
                'Resolved adapter does not provide a reporting calendar.',
                context
            );
        }

        const calendar =
            this.normalizeCalendar(
                adapter.getReportingCalendar(
                    context
                ),
                context,
                adapter
            );

        /**
         * Adapter-specific implementation may expose a direct period resolver.
         */
        if (
            typeof adapter.getReportingPeriod ===
                'function'
        ) {
            const period =
                adapter.getReportingPeriod(
                    context
                );

            return this.normalizePeriod(
                period,
                context,
                adapter
            );
        }

        /**
         * Otherwise use calendar periods if available.
         */
        if (
            Array.isArray(
                calendar.periods
            )
        ) {
            const asOf =
                context.asOf;

            const matching =
                calendar.periods.find(
                    period => {

                        const start =
                            period.periodStart;

                        const end =
                            period.periodEnd;

                        return (
                            start &&
                            end &&
                            asOf >= start &&
                            asOf <= end
                        );
                    }
                );

            if (
                matching
            ) {
                return this.normalizePeriod(
                    matching,
                    context,
                    adapter
                );
            }
        }

        return null;
    }

    /**
     * =========================================================================
     * Submission Deadline
     * =========================================================================
     */

    getSubmissionDeadline(
        report,
        input = {}
    ) {
        if (
            !report ||
            typeof report !==
                'object'
        ) {
            throw new TypeError(
                'report is required'
            );
        }

        const context =
            this.buildContext({
                ...input,

                report,

                tenantId:
                    input.tenantId ||
                    report.tenantId,

                reportType:
                    input.reportType ||
                    report.type,
            });

        const adapter =
            this.resolveAdapter(
                context
            );

        if (
            !adapter
        ) {
            return {
                status:
                    CALENDAR_STATUS.NOT_SUPPORTED,

                deadline:
                    null,
            };
        }

        this.assertTenantContext(
            context,
            adapter
        );

        if (
            typeof adapter.getSubmissionDeadline !==
                'function'
        ) {
            throw this.createError(
                'REGULATORY_DEADLINE_NOT_SUPPORTED',
                'Resolved regulatory adapter does not implement submission deadlines.',
                context
            );
        }

        const deadline =
            adapter.getSubmissionDeadline(
                report,
                context
            );

        return this.normalizeDeadline(
            deadline,
            context,
            adapter
        );
    }

    /**
     * =========================================================================
     * Determine Whether Report Is Due
     * =========================================================================
     */

    isReportDue(
        report,
        input = {}
    ) {
        if (
            !report ||
            typeof report !==
                'object'
        ) {
            throw new TypeError(
                'report is required'
            );
        }

        const context =
            this.buildContext({
                ...input,

                report,

                tenantId:
                    input.tenantId ||
                    report.tenantId,

                reportType:
                    input.reportType ||
                    report.type,
            });

        const adapter =
            this.resolveAdapter(
                context
            );

        if (
            !adapter
        ) {
            return {
                status:
                    CALENDAR_STATUS.NOT_SUPPORTED,

                due:
                    false,

                overdue:
                    false,

                dueSoon:
                    false,
            };
        }

        this.assertTenantContext(
            context,
            adapter
        );

        /**
         * Prefer adapter-native due semantics when provided.
         */
        if (
            typeof adapter.isReportDue ===
                'function'
        ) {
            const adapterResult =
                adapter.isReportDue(
                    report,
                    context
                );

            return this.normalizeDueResult(
                adapterResult,
                report,
                context,
                adapter
            );
        }

        /**
         * Fall back to deadline calculation.
         */
        const deadline =
            this.getSubmissionDeadline(
                report,
                context
            );

        return this.calculateDueStatus(
            deadline.deadline,
            {
                report,

                context,

                adapter,
            }
        );
    }

    /**
     * =========================================================================
     * Filing Window
     * =========================================================================
     */

    getFilingWindow(
        report,
        input = {}
    ) {
        if (
            !report ||
            typeof report !==
                'object'
        ) {
            throw new TypeError(
                'report is required'
            );
        }

        const context =
            this.buildContext({
                ...input,

                report,

                tenantId:
                    input.tenantId ||
                    report.tenantId,

                reportType:
                    input.reportType ||
                    report.type,
            });

        const calendar =
            this.getReportingCalendar(
                context
            );

        const now =
            context.now;

        /**
         * Direct adapter window API takes precedence.
         */
        const adapter =
            this.resolveAdapter(
                context
            );

        if (
            adapter &&
            typeof adapter.getFilingWindow ===
                'function'
        ) {
            return this.normalizeWindow(
                adapter.getFilingWindow(
                    report,
                    context
                ),
                context,
                adapter
            );
        }

        const filingOpenAt =
            calendar.filingOpenAt ||
            calendar.window?.openAt ||
            null;

        const filingCloseAt =
            calendar.filingCloseAt ||
            calendar.window?.closeAt ||
            calendar.deadlineAt ||
            calendar.window?.closeAt ||
            null;

        if (
            !filingOpenAt &&
            !filingCloseAt
        ) {
            return {
                status:
                    WINDOW_STATUS.UNKNOWN,

                openAt:
                    null,

                closeAt:
                    null,
            };
        }

        if (
            filingOpenAt &&
            now < filingOpenAt
        ) {
            return {
                status:
                    WINDOW_STATUS.NOT_YET_OPEN,

                openAt:
                    filingOpenAt,

                closeAt:
                    filingCloseAt,
            };
        }

        if (
            filingCloseAt &&
            now > filingCloseAt
        ) {
            return {
                status:
                    WINDOW_STATUS.CLOSED,

                openAt:
                    filingOpenAt,

                closeAt:
                    filingCloseAt,
            };
        }

        return {
            status:
                WINDOW_STATUS.OPEN,

            openAt:
                filingOpenAt,

            closeAt:
                filingCloseAt,
        };
    }

    /**
     * =========================================================================
     * Calendar Date Evaluation
     * =========================================================================
     */

    isBusinessDay(
        date,
        calendar = {}
    ) {
        const target =
            toDate(
                date,
                'date'
            );

        if (
            isWeekendUtc(
                target
            )
        ) {
            return false;
        }

        const holidays =
            this.normalizeHolidays(
                calendar.holidays ||
                []
            );

        const dayKey =
            this.dateKey(
                target
            );

        return !holidays.some(
            holiday =>
                holiday.dateKey ===
                dayKey
        );
    }

    nextBusinessDay(
        date,
        calendar = {}
    ) {
        let current =
            toDate(
                date,
                'date'
            );

        const maxIterations =
            MAX_CALENDAR_LOOKAHEAD_DAYS;

        for (
            let index = 0;
            index < maxIterations;
            index += 1
        ) {
            if (
                this.isBusinessDay(
                    current,
                    calendar
                )
            ) {
                return new Date(
                    current.getTime()
                );
            }

            current =
                addDaysUtc(
                    current,
                    1
                );
        }

        throw this.createError(
            'REGULATORY_CALENDAR_BUSINESS_DAY_NOT_FOUND',
            'Unable to resolve the next business day within the supported window.'
        );
    }

    previousBusinessDay(
        date,
        calendar = {}
    ) {
        let current =
            toDate(
                date,
                'date'
            );

        const maxIterations =
            MAX_CALENDAR_LOOKAHEAD_DAYS;

        for (
            let index = 0;
            index < maxIterations;
            index += 1
        ) {
            if (
                this.isBusinessDay(
                    current,
                    calendar
                )
            ) {
                return new Date(
                    current.getTime()
                );
            }

            current =
                addDaysUtc(
                    current,
                    -1
                );
        }

        throw this.createError(
            'REGULATORY_CALENDAR_BUSINESS_DAY_NOT_FOUND',
            'Unable to resolve the previous business day within the supported window.'
        );
    }

    addBusinessDays(
        date,
        numberOfDays,
        calendar = {}
    ) {
        const days =
            Number(
                numberOfDays
            );

        if (
            !Number.isInteger(
                days
            )
        ) {
            throw new TypeError(
                'numberOfDays must be an integer'
            );
        }

        if (
            days === 0
        ) {
            return this.nextBusinessDay(
                date,
                calendar
            );
        }

        let current =
            toDate(
                date,
                'date'
            );

        let remaining =
            Math.abs(
                days
            );

        const direction =
            days > 0
                ? 1
                : -1;

        while (
            remaining > 0
        ) {
            current =
                addDaysUtc(
                    current,
                    direction
                );

            if (
                this.isBusinessDay(
                    current,
                    calendar
                )
            ) {
                remaining -= 1;
            }
        }

        return current;
    }

    /**
     * =========================================================================
     * Normalize Calendar
     * =========================================================================
     */

    normalizeCalendar(
        calendar,
        context,
        adapter
    ) {
        if (
            calendar === null ||
            calendar === undefined
        ) {
            return {
                status:
                    CALENDAR_STATUS.NOT_SUPPORTED,

                supported:
                    false,

                timezone:
                    context.timezone,

                periods:
                    [],
            };
        }

        if (
            typeof calendar !==
                'object'
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_INVALID',
                'Regulatory adapter returned an invalid calendar object.',
                context,
                {
                    cause:
                        new TypeError(
                            'Calendar must be an object'
                        ),
                }
            );
        }

        const timezone =
            normalizeTimezone(
                calendar.timezone ||
                context.timezone ||
                this.defaultTimezone
            );

        const periods =
            Array.isArray(
                calendar.periods
            )
                ? calendar.periods
                    .slice(
                        0,
                        MAX_PERIODS
                    )
                    .map(
                        period =>
                            this.normalizePeriod(
                                period,
                                context,
                                adapter
                            )
                    )
                : [];

        const holidays =
            this.normalizeHolidays(
                calendar.holidays ||
                []
            );

        const normalized = {
            supported:
                calendar.supported !==
                    false,

            status:
                calendar.status ||
                'AVAILABLE',

            timezone,

            periodType:
                calendar.periodType ||
                null,

            periods,

            holidays,

            filingOpenAt:
                this.safeDate(
                    calendar.filingOpenAt ||
                    calendar.window?.openAt
                ),

            filingCloseAt:
                this.safeDate(
                    calendar.filingCloseAt ||
                    calendar.window?.closeAt
                ),

            deadlineAt:
                this.safeDate(
                    calendar.deadlineAt
                ),

            reportingFrequency:
                calendar.reportingFrequency ||
                null,

            businessDayRule:
                calendar.businessDayRule ||
                null,

            metadata:
                cloneValue(
                    calendar.metadata ||
                    {}
                ),

            adapter:
                adapter?.getIdentity?.() ||
                null,

            tenantId:
                context.tenantId ||
                null,

            reportType:
                context.reportType ||
                null,
        };

        normalized.fingerprint =
            this.createCalendarFingerprint(
                normalized
            );

        return deepFreeze(
            normalized
        );
    }

    /**
     * =========================================================================
     * Normalize Period
     * =========================================================================
     */

    normalizePeriod(
        period,
        context,
        adapter
    ) {
        if (
            !period ||
            typeof period !==
                'object'
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_PERIOD_INVALID',
                'Regulatory reporting period must be an object.',
                context
            );
        }

        const periodStart =
            toDate(
                period.periodStart ||
                period.start,
                'periodStart'
            );

        const periodEnd =
            toDate(
                period.periodEnd ||
                period.end,
                'periodEnd'
            );

        if (
            periodStart >
            periodEnd
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_PERIOD_INVALID',
                'Reporting period start cannot be after period end.',
                context
            );
        }

        const normalized = {
            periodId:
                period.periodId ||
                period.id ||
                null,

            periodType:
                period.periodType ||
                period.type ||
                null,

            periodStart,

            periodEnd,

            filingOpenAt:
                this.safeDate(
                    period.filingOpenAt ||
                    period.openAt
                ),

            filingCloseAt:
                this.safeDate(
                    period.filingCloseAt ||
                    period.closeAt
                ),

            deadlineAt:
                this.safeDate(
                    period.deadlineAt ||
                    period.deadline
                ),

            timezone:
                normalizeTimezone(
                    period.timezone ||
                    context.timezone
                ),

            status:
                period.status ||
                null,

            metadata:
                cloneValue(
                    period.metadata ||
                    {}
                ),

            adapter:
                adapter?.getIdentity?.() ||
                null,

            tenantId:
                context.tenantId ||
                null,
        };

        normalized.fingerprint =
            sha256(
                stableSerialize(
                    normalized
                )
            );

        return deepFreeze(
            normalized
        );
    }

    /**
     * =========================================================================
     * Normalize Deadline
     * =========================================================================
     */

    normalizeDeadline(
        deadline,
        context,
        adapter
    ) {
        if (
            deadline === null ||
            deadline === undefined
        ) {
            return deepFreeze({
                status:
                    CALENDAR_STATUS.NOT_SUPPORTED,

                deadline:
                    null,

                timezone:
                    context.timezone,

                adapter:
                    adapter?.getIdentity?.() ||
                    null,
            });
        }

        let deadlineDate;

        let metadata = {};

        if (
            deadline instanceof Date ||
            typeof deadline ===
                'string' ||
            typeof deadline ===
                'number'
        ) {
            deadlineDate =
                toDate(
                    deadline,
                    'deadline'
                );
        } else if (
            typeof deadline ===
                'object'
        ) {
            deadlineDate =
                toDate(
                    deadline.deadline ||
                    deadline.deadlineAt ||
                    deadline.dueAt,
                    'deadline'
                );

            metadata =
                cloneValue(
                    deadline
                );
        } else {
            throw this.createError(
                'REGULATORY_CALENDAR_DEADLINE_INVALID',
                'Regulatory adapter returned an invalid deadline.',
                context
            );
        }

        const result = {
            status:
                CALENDAR_STATUS.DUE,

            deadline:
                deadlineDate,

            timezone:
                normalizeTimezone(
                    deadline?.timezone ||
                    context.timezone
                ),

            metadata,

            adapter:
                adapter?.getIdentity?.() ||
                null,

            tenantId:
                context.tenantId ||
                null,

            reportType:
                context.reportType ||
                null,
        };

        result.fingerprint =
            sha256(
                stableSerialize(
                    result
                )
            );

        return deepFreeze(
            result
        );
    }

    /**
     * =========================================================================
     * Normalize Window
     * =========================================================================
     */

    normalizeWindow(
        window,
        context,
        adapter
    ) {
        if (
            !window ||
            typeof window !==
                'object'
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_WINDOW_INVALID',
                'Regulatory filing window is invalid.',
                context
            );
        }

        const openAt =
            this.safeDate(
                window.openAt ||
                window.filingOpenAt
            );

        const closeAt =
            this.safeDate(
                window.closeAt ||
                window.filingCloseAt
            );

        const result = {
            status:
                window.status ||
                WINDOW_STATUS.UNKNOWN,

            openAt,

            closeAt,

            timezone:
                normalizeTimezone(
                    window.timezone ||
                    context.timezone
                ),

            adapter:
                adapter?.getIdentity?.() ||
                null,

            tenantId:
                context.tenantId ||
                null,

            reportType:
                context.reportType ||
                null,
        };

        result.fingerprint =
            sha256(
                stableSerialize(
                    result
                )
            );

        return deepFreeze(
            result
        );
    }

    /**
     * =========================================================================
     * Normalize Due Result
     * =========================================================================
     */

    normalizeDueResult(
        result,
        report,
        context,
        adapter
    ) {
        if (
            typeof result ===
                'boolean'
        ) {
            return deepFreeze(
                this.calculateDueStatus(
                    null,
                    {
                        report,

                        context,

                        adapter,

                        adapterDue:
                            result,
                    }
                )
            );
        }

        if (
            !result ||
            typeof result !==
                'object'
        ) {
            return this.calculateDueStatus(
                null,
                {
                    report,

                    context,

                    adapter,
                }
            );
        }

        const deadline =
            this.safeDate(
                result.deadline ||
                result.deadlineAt ||
                result.dueAt
            );

        if (
            deadline &&
            !result.status
        ) {
            return this.calculateDueStatus(
                deadline,
                {
                    report,

                    context,

                    adapter,
                }
            );
        }

        const normalized = {
            due:
                result.due === true,

            overdue:
                result.overdue === true,

            dueSoon:
                result.dueSoon === true,

            status:
                result.status ||
                (
                    result.due
                        ? CALENDAR_STATUS.DUE
                        : CALENDAR_STATUS.NOT_DUE
                ),

            deadline,

            asOf:
                context.now,

            timezone:
                normalizeTimezone(
                    result.timezone ||
                    context.timezone
                ),

            adapter:
                adapter?.getIdentity?.() ||
                null,

            tenantId:
                context.tenantId ||
                report?.tenantId ||
                null,

            reportType:
                context.reportType ||
                report?.type ||
                null,

            metadata:
                cloneValue(
                    result.metadata ||
                    {}
                ),
        };

        normalized.daysRemaining =
            deadline
                ? diffDaysUtc(
                    context.now,
                    deadline
                )
                : null;

        normalized.fingerprint =
            sha256(
                stableSerialize(
                    normalized
                )
            );

        return deepFreeze(
            normalized
        );
    }

    /**
     * =========================================================================
     * Calculate Due Status
     * =========================================================================
     */

    calculateDueStatus(
        deadline,
        {
            report,
            context,
            adapter,
            adapterDue,
        } = {}
    ) {
        const now =
            context?.now ||
            new Date();

        let status =
            CALENDAR_STATUS.NOT_DUE;

        let due =
            false;

        let overdue =
            false;

        let dueSoon =
            false;

        let daysRemaining =
            null;

        if (
            typeof adapterDue ===
                'boolean'
        ) {
            due =
                adapterDue;

            status =
                adapterDue
                    ? CALENDAR_STATUS.DUE
                    : CALENDAR_STATUS.NOT_DUE;
        } else if (
            deadline
        ) {
            const deadlineDate =
                toDate(
                    deadline,
                    'deadline'
                );

            daysRemaining =
                diffDaysUtc(
                    now,
                    deadlineDate
                );

            if (
                now >
                deadlineDate
            ) {
                overdue =
                    true;

                status =
                    CALENDAR_STATUS.OVERDUE;
            } else if (
                now.getTime() ===
                deadlineDate.getTime()
            ) {
                due =
                    true;

                status =
                    CALENDAR_STATUS.DUE;
            } else if (
                daysRemaining <=
                this.dueSoonDays
            ) {
                dueSoon =
                    true;

                status =
                    CALENDAR_STATUS.DUE_SOON;
            } else {
                status =
                    CALENDAR_STATUS.NOT_DUE;
            }
        }

        const result = {
            due,

            overdue,

            dueSoon,

            status,

            deadline:
                deadline
                    ? toDate(
                        deadline,
                        'deadline'
                    )
                    : null,

            daysRemaining,

            asOf:
                now,

            timezone:
                context?.timezone ||
                this.defaultTimezone,

            adapter:
                adapter?.getIdentity?.() ||
                null,

            tenantId:
                context?.tenantId ||
                report?.tenantId ||
                null,

            reportType:
                context?.reportType ||
                report?.type ||
                null,
        };

        result.fingerprint =
            sha256(
                stableSerialize(
                    result
                )
            );

        return deepFreeze(
            result
        );
    }

    /**
     * =========================================================================
     * Normalize Holidays
     * =========================================================================
     */

    normalizeHolidays(
        holidays
    ) {
        if (
            !Array.isArray(
                holidays
            )
        ) {
            return [];
        }

        return holidays
            .slice(
                0,
                MAX_HOLIDAYS
            )
            .map(
                holiday => {

                    if (
                        holiday instanceof
                            Date
                    ) {
                        return {
                            date:
                                new Date(
                                    holiday.getTime()
                                ),

                            dateKey:
                                this.dateKey(
                                    holiday
                                ),

                            name:
                                null,
                        };
                    }

                    if (
                        typeof holiday ===
                        'string'
                    ) {
                        const date =
                            toDate(
                                holiday,
                                'holiday'
                            );

                        return {
                            date,

                            dateKey:
                                this.dateKey(
                                    date
                                ),

                            name:
                                null,
                        };
                    }

                    if (
                        holiday &&
                        typeof holiday ===
                            'object'
                    ) {
                        const date =
                            toDate(
                                holiday.date ||
                                holiday.dateAt,
                                'holiday.date'
                            );

                        return {
                            date,

                            dateKey:
                                this.dateKey(
                                    date
                                ),

                            name:
                                holiday.name ||
                                null,

                            type:
                                holiday.type ||
                                null,

                            metadata:
                                cloneValue(
                                    holiday.metadata ||
                                    {}
                                ),
                        };
                    }

                    throw this.createError(
                        'REGULATORY_CALENDAR_HOLIDAY_INVALID',
                        'Invalid regulatory calendar holiday.'
                    );
                }
            );
    }

    /**
     * =========================================================================
     * Date Key
     * =========================================================================
     */

    dateKey(
        date
    ) {
        const normalized =
            startOfUtcDay(
                toDate(
                    date,
                    'date'
                )
            );

        return normalized
            .toISOString()
            .slice(
                0,
                10
            );
    }

    /**
     * =========================================================================
     * Safe Date
     * =========================================================================
     */

    safeDate(
        value
    ) {
        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {
            return null;
        }

        return toDate(
            value,
            'date'
        );
    }

    /**
     * =========================================================================
     * Tenant Safety
     * =========================================================================
     */

    assertTenantContext(
        context,
        adapter
    ) {
        const tenantId =
            context.tenantId;

        if (
            !tenantId
        ) {
            throw this.createError(
                'REGULATORY_CALENDAR_TENANT_REQUIRED',
                'tenantId is required for regulatory calendar operations.',
                context
            );
        }

        /**
         * If the adapter exposes tenant support metadata, allow it to perform
         * additional validation.
         */
        if (
            typeof adapter.assertTenantContext ===
                'function'
        ) {
            adapter.assertTenantContext(
                context.report ||
                {
                    tenantId,
                },
                context
            );
        }

        return true;
    }

    /**
     * =========================================================================
     * Unsupported Calendar
     * =========================================================================
     */

    createUnsupportedCalendar(
        context
    ) {
        const result = {
            supported:
                false,

            status:
                CALENDAR_STATUS.NOT_SUPPORTED,

            timezone:
                context.timezone,

            periods:
                [],

            holidays:
                [],

            tenantId:
                context.tenantId,

            reportType:
                context.reportType,

            adapter:
                null,
        };

        result.fingerprint =
            this.createCalendarFingerprint(
                result
            );

        return deepFreeze(
            result
        );
    }

    /**
     * =========================================================================
     * Calendar Fingerprint
     * =========================================================================
     */

    createCalendarFingerprint(
        calendar
    ) {
        const canonical = {
            supported:
                calendar.supported,

            status:
                calendar.status,

            timezone:
                calendar.timezone,

            periodType:
                calendar.periodType,

            periods:
                calendar.periods,

            holidays:
                calendar.holidays,

            filingOpenAt:
                calendar.filingOpenAt,

            filingCloseAt:
                calendar.filingCloseAt,

            deadlineAt:
                calendar.deadlineAt,

            reportingFrequency:
                calendar.reportingFrequency,

            businessDayRule:
                calendar.businessDayRule,

            adapter:
                calendar.adapter,

            tenantId:
                calendar.tenantId,

            reportType:
                calendar.reportType,
        };

        return sha256(
            stableSerialize(
                canonical
            )
        );
    }

    /**
     * =========================================================================
     * Calendar Snapshot
     * =========================================================================
     */

    getSnapshot(
        input = {}
    ) {
        const context =
            this.buildContext(
                input
            );

        const calendar =
            this.getReportingCalendar(
                context
            );

        const period =
            input.report
                ? this.getReportingPeriod(
                    context
                )
                : null;

        const deadline =
            input.report
                ? this.getSubmissionDeadline(
                    context.report,
                    context
                )
                : null;

        const due =
            input.report
                ? this.isReportDue(
                    context.report,
                    context
                )
                : null;

        const window =
            input.report
                ? this.getFilingWindow(
                    context.report,
                    context
                )
                : null;

        const snapshot = {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            tenantId:
                context.tenantId,

            reportType:
                context.reportType,

            asOf:
                context.now,

            timezone:
                context.timezone,

            calendar,

            period,

            deadline,

            due,

            window,
        };

        snapshot.fingerprint =
            sha256(
                stableSerialize(
                    snapshot
                )
            );

        return deepFreeze(
            snapshot
        );
    }

    /**
     * =========================================================================
     * Health
     * =========================================================================
     */

    async health() {
        const registryHealthy =
            Boolean(
                this.registry &&
                (
                    typeof this.registry.readiness ===
                        'function' ||
                    typeof this.registry.health ===
                        'function'
                )
            );

        return {
            healthy:
                registryHealthy ||
                !this.requireAdapter,

            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            registryAvailable:
                Boolean(
                    this.registry
                ),

            timestamp:
                new Date().toISOString(),
        };
    }

    /**
     * =========================================================================
     * Error Factory
     * =========================================================================
     */

    createError(
        code,
        message,
        context = {},
        options = {}
    ) {
        const error =
            new Error(
                message
            );

        error.code =
            code;

        error.name =
            'RegulatoryCalendarServiceError';

        error.retryable =
            options.retryable === true;

        error.tenantId =
            context.tenantId ||
            null;

        error.reportType =
            context.reportType ||
            null;

        error.operation =
            options.operation ||
            null;

        if (
            options.cause
        ) {
            error.cause =
                options.cause;
        }

        return error;
    }

    /**
     * =========================================================================
     * Diagnostics
     * =========================================================================
     */

    diagnostics() {
        return {
            service:
                SERVICE_NAME,

            version:
                SERVICE_VERSION,

            defaultTimezone:
                this.defaultTimezone,

            dueSoonDays:
                this.dueSoonDays,

            requireAdapter:
                this.requireAdapter,

            registryAvailable:
                Boolean(
                    this.registry
                ),
        };
    }
}

/**
 * ============================================================================
 * Static Constants
 * ============================================================================
 */

RegulatoryCalendarService.CALENDAR_STATUS =
    CALENDAR_STATUS;

RegulatoryCalendarService.WINDOW_STATUS =
    WINDOW_STATUS;

RegulatoryCalendarService.SERVICE_NAME =
    SERVICE_NAME;

RegulatoryCalendarService.SERVICE_VERSION =
    SERVICE_VERSION;

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
    RegulatoryCalendarService;

module.exports.RegulatoryCalendarService =
    RegulatoryCalendarService;

module.exports.CALENDAR_STATUS =
    CALENDAR_STATUS;

module.exports.WINDOW_STATUS =
    WINDOW_STATUS;

module.exports.SERVICE_NAME =
    SERVICE_NAME;

module.exports.SERVICE_VERSION =
    SERVICE_VERSION;