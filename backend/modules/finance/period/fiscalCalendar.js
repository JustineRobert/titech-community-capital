'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Fiscal Calendar Service
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/services/fiscalCalendar.js
 *
 * Purpose:
 *   Enterprise fiscal-calendar service for the Finance Core financial-period
 *   engine.
 *
 * Responsibilities:
 *   - Create fiscal years
 *   - Validate fiscal-year structure
 *   - Resolve a financial period by date
 *   - Resolve the currently open period
 *   - Enforce tenant isolation
 *   - Validate period boundaries
 *   - Prevent overlapping periods
 *   - Validate period ordering
 *   - Preserve repository abstraction
 *   - Provide deterministic date normalization
 *
 * IMPORTANT:
 *   This service does not directly post ledger transactions or mutate
 *   financial balances.
 *
 *   Fiscal-period state is control-plane state. Financial posting remains the
 *   responsibility of the immutable Ledger / Journal posting engine.
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const FISCAL_YEAR_STATUS = Object.freeze({
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    LOCKED: 'LOCKED',
    CANCELLED: 'CANCELLED'
});

const PERIOD_STATUS = Object.freeze({
    OPEN: 'OPEN',
    CLOSED: 'CLOSED',
    LOCKED: 'LOCKED',
    ADJUSTMENT: 'ADJUSTMENT',
    CANCELLED: 'CANCELLED'
});

const DEFAULT_PERIOD_STATUS =
    PERIOD_STATUS.OPEN;

/* ============================================================================
 * Utility functions
 * ========================================================================== */

function generateId() {
    if (
        typeof crypto.randomUUID ===
        'function'
    ) {
        return crypto.randomUUID();
    }

    return [
        Date.now().toString(16),
        Math.random()
            .toString(16)
            .slice(2)
    ].join('-');
}

function normalizeTenantId(
    tenantId
) {
    if (
        tenantId === undefined ||
        tenantId === null ||
        String(tenantId).trim() === ''
    ) {
        throw createValidationError(
            'tenantId is required'
        );
    }

    return String(
        tenantId
    ).trim();
}

function normalizeYear(year) {
    const numericYear =
        Number(year);

    if (
        !Number.isInteger(
            numericYear
        ) ||
        numericYear < 1900 ||
        numericYear > 9999
    ) {
        throw createValidationError(
            'year must be a valid four-digit fiscal year'
        );
    }

    return numericYear;
}

function normalizeDate(
    value,
    fieldName = 'date'
) {
    if (
        value === undefined ||
        value === null
    ) {
        throw createValidationError(
            `${fieldName} is required`
        );
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
        throw createValidationError(
            `${fieldName} must be a valid date`
        );
    }

    return date;
}

function normalizePeriodStatus(
    status
) {
    const value =
        String(
            status ||
            DEFAULT_PERIOD_STATUS
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            PERIOD_STATUS
        ).includes(value)
    ) {
        throw createValidationError(
            `Invalid fiscal period status: ${value}`
        );
    }

    return value;
}

function normalizeFiscalYearStatus(
    status
) {
    const value =
        String(
            status ||
            FISCAL_YEAR_STATUS.OPEN
        )
            .trim()
            .toUpperCase();

    if (
        !Object.values(
            FISCAL_YEAR_STATUS
        ).includes(value)
    ) {
        throw createValidationError(
            `Invalid fiscal year status: ${value}`
        );
    }

    return value;
}

function startOfDay(date) {
    const normalized =
        new Date(
            date.getTime()
        );

    normalized.setHours(
        0,
        0,
        0,
        0
    );

    return normalized;
}

function endOfDay(date) {
    const normalized =
        new Date(
            date.getTime()
        );

    normalized.setHours(
        23,
        59,
        59,
        999
    );

    return normalized;
}

function createValidationError(
    message
) {
    const error =
        new Error(
            message
        );

    error.code =
        'FISCAL_CALENDAR_VALIDATION_ERROR';

    error.statusCode =
        400;

    return error;
}

function createConflictError(
    message
) {
    const error =
        new Error(
            message
        );

    error.code =
        'FISCAL_CALENDAR_CONFLICT';

    error.statusCode =
        409;

    return error;
}

/* ============================================================================
 * Service
 * ========================================================================== */

class FiscalCalendar {

    constructor({
        repository,
        clock,
        idGenerator,
        logger
    } = {}) {

        if (
            !repository ||
            typeof repository.create !==
                'function'
        ) {
            throw new TypeError(
                'FiscalCalendar requires a repository with create()'
            );
        }

        this.repository =
            repository;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;

        this.logger =
            logger ||
            console;
    }

    /* ========================================================================
     * Create Fiscal Year
     * ====================================================================== */

    async createFiscalYear({
        tenantId,
        year,
        periods,
        status = FISCAL_YEAR_STATUS.OPEN,
        fiscalYearId = null,
        metadata = {}
    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedYear =
            normalizeYear(
                year
            );

        const normalizedStatus =
            normalizeFiscalYearStatus(
                status
            );

        const normalizedPeriods =
            this.normalizePeriods(
                periods,
                normalizedYear
            );

        this.validateNoOverlappingPeriods(
            normalizedPeriods
        );

        this.validatePeriodSequence(
            normalizedPeriods
        );

        const existing =
            await this.findExistingFiscalYear(
                normalizedTenantId,
                normalizedYear
            );

        if (existing) {
            throw createConflictError(
                `Fiscal year ${normalizedYear} already exists for tenant ${normalizedTenantId}`
            );
        }

        const now =
            this.clock();

        const document = {
            id:
                fiscalYearId ||
                this.idGenerator(),

            tenantId:
                normalizedTenantId,

            year:
                normalizedYear,

            status:
                normalizedStatus,

            periods:
                normalizedPeriods,

            metadata:
                this.sanitizeMetadata(
                    metadata
                ),

            createdAt:
                new Date(
                    now
                ),

            updatedAt:
                new Date(
                    now
                )
        };

        try {

            return await this.repository
                .create(
                    document
                );

        } catch (error) {

            this.safeLog(
                'error',
                'Failed to create fiscal year',
                error,
                {
                    tenantId:
                        normalizedTenantId,

                    year:
                        normalizedYear
                }
            );

            throw error;
        }
    }

    /* ========================================================================
     * Find Period By Date
     * ====================================================================== */

    async findPeriod({
        tenantId,
        date
    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedDate =
            normalizeDate(
                date
            );

        /*
         * Prefer repository-native date resolution. This is important for
         * indexed/database-backed fiscal period lookup.
         */
        if (
            typeof this.repository
                .findByDate ===
            'function'
        ) {

            return this.repository
                .findByDate({
                    tenantId:
                        normalizedTenantId,

                    date:
                        normalizedDate
                });
        }

        /*
         * Do not silently perform an unbounded in-memory search against an
         * unknown repository implementation.
         */
        throw new TypeError(
            'FiscalCalendar repository must implement findByDate()'
        );
    }

    /* ========================================================================
     * Get Current Open Period
     * ====================================================================== */

    async getCurrentPeriod({
        tenantId
    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        if (
            typeof this.repository
                .findOpenPeriod !==
            'function'
        ) {
            throw new TypeError(
                'FiscalCalendar repository must implement findOpenPeriod()'
            );
        }

        return this.repository
            .findOpenPeriod({
                tenantId:
                    normalizedTenantId,

                status:
                    PERIOD_STATUS.OPEN
            });
    }

    /* ========================================================================
     * Find Fiscal Year
     * ====================================================================== */

    async findFiscalYear({
        tenantId,
        year
    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedYear =
            normalizeYear(
                year
            );

        if (
            typeof this.repository
                .findByYear !==
            'function'
        ) {
            throw new TypeError(
                'FiscalCalendar repository must implement findByYear()'
            );
        }

        return this.repository
            .findByYear({
                tenantId:
                    normalizedTenantId,

                year:
                    normalizedYear
            });
    }

    /* ========================================================================
     * Current Fiscal Year
     * ====================================================================== */

    async getCurrentFiscalYear({
        tenantId
    } = {}) {

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        if (
            typeof this.repository
                .findOpenFiscalYear !==
            'function'
        ) {
            throw new TypeError(
                'FiscalCalendar repository must implement findOpenFiscalYear()'
            );
        }

        return this.repository
            .findOpenFiscalYear({
                tenantId:
                    normalizedTenantId
            });
    }

    /* ========================================================================
     * Normalize Fiscal Periods
     * ====================================================================== */

    normalizePeriods(
        periods,
        fiscalYear
    ) {

        if (
            !Array.isArray(
                periods
            ) ||
            periods.length === 0
        ) {
            throw createValidationError(
                'periods must be a non-empty array'
            );
        }

        return periods
            .map(
                (
                    period,
                    index
                ) =>
                    this.normalizePeriod(
                        period,
                        fiscalYear,
                        index
                    )
            )
            .sort(
                (
                    left,
                    right
                ) =>
                    left.startDate -
                    right.startDate
            );
    }

    normalizePeriod(
        period,
        fiscalYear,
        index
    ) {

        if (
            !period ||
            typeof period !==
                'object'
        ) {
            throw createValidationError(
                `period at index ${index} must be an object`
            );
        }

        const startDate =
            startOfDay(
                normalizeDate(
                    period.startDate ||
                    period.start,
                    `period[${index}].startDate`
                )
            );

        const endDate =
            endOfDay(
                normalizeDate(
                    period.endDate ||
                    period.end,
                    `period[${index}].endDate`
                )
            );

        if (
            endDate <
            startDate
        ) {
            throw createValidationError(
                `period at index ${index} has endDate before startDate`
            );
        }

        if (
            startDate.getFullYear() !==
                fiscalYear ||
            endDate.getFullYear() !==
                fiscalYear
        ) {
            throw createValidationError(
                `period at index ${index} must belong to fiscal year ${fiscalYear}`
            );
        }

        const periodId =
            period.id ||
            this.idGenerator();

        const name =
            period.name ||
            period.label ||
            `Period ${index + 1}`;

        return {
            id:
                String(
                    periodId
                ),

            sequence:
                Number.isInteger(
                    period.sequence
                )
                    ? period.sequence
                    : index + 1,

            name:
                String(
                    name
                )
                    .trim()
                    .slice(
                        0,
                        200
                    ),

            code:
                period.code
                    ? String(
                        period.code
                    )
                        .trim()
                        .slice(
                            0,
                            100
                        )
                    : null,

            status:
                normalizePeriodStatus(
                    period.status
                ),

            startDate,

            endDate,

            metadata:
                this.sanitizeMetadata(
                    period.metadata
                )
        };
    }

    /* ========================================================================
     * Validate Period Overlap
     * ====================================================================== */

    validateNoOverlappingPeriods(
        periods
    ) {

        for (
            let index = 1;
            index < periods.length;
            index += 1
        ) {

            const previous =
                periods[
                    index - 1
                ];

            const current =
                periods[index];

            if (
                current.startDate <=
                previous.endDate
            ) {
                throw createConflictError(
                    `Fiscal periods overlap: ${previous.id} and ${current.id}`
                );
            }
        }

        return true;
    }

    /* ========================================================================
     * Validate Period Sequence
     * ====================================================================== */

    validatePeriodSequence(
        periods
    ) {

        const sequences =
            periods.map(
                period =>
                    period.sequence
            );

        const unique =
            new Set(
                sequences
            );

        if (
            unique.size !==
            sequences.length
        ) {
            throw createConflictError(
                'Fiscal period sequence values must be unique'
            );
        }

        for (
            let index = 0;
            index < periods.length;
            index += 1
        ) {

            const expected =
                index + 1;

            if (
                periods[index]
                    .sequence !==
                expected
            ) {
                throw createValidationError(
                    `Fiscal period sequence must be contiguous starting at 1; expected ${expected}`
                );
            }
        }

        return true;
    }

    /* ========================================================================
     * Existing Fiscal Year Detection
     * ====================================================================== */

    async findExistingFiscalYear(
        tenantId,
        year
    ) {

        if (
            typeof this.repository
                .findByYear ===
            'function'
        ) {

            return this.repository
                .findByYear({
                    tenantId,
                    year
                });
        }

        if (
            typeof this.repository
                .findOne ===
            'function'
        ) {

            return this.repository
                .findOne({
                    tenantId,
                    year
                });
        }

        return null;
    }

    /* ========================================================================
     * Metadata Sanitization
     * ====================================================================== */

    sanitizeMetadata(
        metadata = {}
    ) {

        if (
            !metadata ||
            typeof metadata !==
                'object'
        ) {
            return {};
        }

        const output = {};

        for (
            const [
                key,
                value
            ] of Object.entries(
                metadata
            )
        ) {

            if (
                Object.keys(
                    output
                ).length >= 50
            ) {
                break;
            }

            if (
                this.isSensitiveKey(
                    key
                )
            ) {
                continue;
            }

            output[
                String(
                    key
                ).slice(
                    0,
                    128
                )
            ] =
                this.sanitizeMetadataValue(
                    value
                );
        }

        return output;
    }

    sanitizeMetadataValue(
        value
    ) {

        if (
            value === null ||
            value === undefined
        ) {
            return value;
        }

        if (
            typeof value ===
            'string'
        ) {
            return value.slice(
                0,
                1000
            );
        }

        if (
            typeof value ===
                'number' ||
            typeof value ===
                'boolean'
        ) {
            return value;
        }

        if (
            value instanceof Date
        ) {
            return value.toISOString();
        }

        if (
            Array.isArray(value)
        ) {
            return value
                .slice(
                    0,
                    20
                )
                .map(
                    item =>
                        this.sanitizeMetadataValue(
                            item
                        )
                );
        }

        try {
            return JSON.parse(
                JSON.stringify(
                    value
                )
            );
        } catch (_error) {
            return '[unserializable]';
        }
    }

    isSensitiveKey(
        key
    ) {

        return [
            /password/i,
            /token/i,
            /secret/i,
            /authorization/i,
            /private.?key/i,
            /pin/i,
            /otp/i,
            /cvv/i,
            /card.?number/i,
            /account.?number/i,
            /wallet.?number/i,
            /national.?id/i,
            /identity.?number/i
        ].some(
            pattern =>
                pattern.test(
                    String(
                        key || ''
                    )
                )
        );
    }

    /* ========================================================================
     * Diagnostics
     * ====================================================================== */

    diagnostics() {

        return {
            module:
                'FiscalCalendar',

            repositoryConfigured:
                Boolean(
                    this.repository
                ),

            repositoryCapabilities: {
                create:
                    typeof this.repository
                        ?.create ===
                    'function',

                findByDate:
                    typeof this.repository
                        ?.findByDate ===
                    'function',

                findByYear:
                    typeof this.repository
                        ?.findByYear ===
                    'function',

                findOpenPeriod:
                    typeof this.repository
                        ?.findOpenPeriod ===
                    'function',

                findOpenFiscalYear:
                    typeof this.repository
                        ?.findOpenFiscalYear ===
                    'function'
            },

            timestamp:
                new Date()
                    .toISOString()
        };
    }

    /* ========================================================================
     * Factory
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new FiscalCalendar(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

FiscalCalendar.FISCAL_YEAR_STATUS =
    FISCAL_YEAR_STATUS;

FiscalCalendar.PERIOD_STATUS =
    PERIOD_STATUS;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    FiscalCalendar;