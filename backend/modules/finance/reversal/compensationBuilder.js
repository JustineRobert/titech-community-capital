'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Finance Core - Compensation Builder
 * ============================================================================
 *
 * File:
 *   backend/modules/finance/reversal/compensationBuilder.js
 *
 * Purpose:
 *   Construct a compensating/reversal journal for an immutable ledger record.
 *
 * Responsibilities:
 *   - Validate the original ledger structure
 *   - Validate tenant ownership
 *   - Validate original ledger balance
 *   - Construct exact debit/credit inversions
 *   - Preserve original account identity
 *   - Preserve original entry lineage
 *   - Preserve tenant/correlation/request/operation context
 *   - Generate deterministic reversal identity
 *   - Protect against duplicate reversal construction
 *   - Reject already-reversed source ledgers where supported
 *   - Validate the compensation journal remains balanced
 *   - Delegate journal construction to JournalService
 *
 * IMPORTANT:
 *
 *   This class DOES NOT:
 *     - modify the original ledger
 *     - modify existing journal entries
 *     - update account balances
 *     - post the reversal
 *     - reopen financial periods
 *
 *   It ONLY constructs a compensating journal.
 *
 *   Actual financial posting remains the responsibility of the immutable
 *   Ledger / Journal Posting Engine.
 *
 * Reversal model:
 *
 *   Original:
 *       Debit   Account A
 *       Credit  Account B
 *
 *   Compensation:
 *       Credit  Account A
 *       Debit   Account B
 *
 * ============================================================================
 */

const crypto = require('crypto');

/* ============================================================================
 * Constants
 * ========================================================================== */

const REVERSAL_TYPE =
    'REVERSAL';

const DEFAULT_DESCRIPTION_PREFIX =
    'Reversal';

const MAX_REASON_LENGTH =
    2000;

const MAX_ENTRIES =
    10000;

const MAX_METADATA_KEYS =
    100;

const MAX_METADATA_STRING_LENGTH =
    2000;

const MAX_METADATA_ARRAY_ITEMS =
    50;

/*
 * Floating-point arithmetic is retained only as a defensive compatibility
 * fallback. If the Finance Core uses Decimal128/minor units, those should be
 * passed through without converting monetary values prematurely.
 */
const BALANCE_TOLERANCE =
    0.00000001;

const SENSITIVE_PATTERNS = Object.freeze([
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
    /identity.?number/i,
    /raw.?payload/i,
    /request.?body/i,
    /response.?body/i
]);

/* ============================================================================
 * Errors
 * ========================================================================== */

class CompensationBuilderError extends Error {

    constructor(
        code,
        message,
        metadata = {}
    ) {

        super(message);

        this.name =
            'CompensationBuilderError';

        this.code =
            code;

        this.metadata =
            metadata;

        this.timestamp =
            new Date();

        Error.captureStackTrace?.(
            this,
            CompensationBuilderError
        );
    }
}

function validationError(
    message,
    metadata = {}
) {

    return new CompensationBuilderError(
        'COMPENSATION_VALIDATION_ERROR',
        message,
        metadata
    );
}

function conflictError(
    message,
    metadata = {}
) {

    return new CompensationBuilderError(
        'COMPENSATION_CONFLICT',
        message,
        metadata
    );
}

/* ============================================================================
 * Utility helpers
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

function normalizeId(
    value
) {

    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {

        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return normalized ||
        null;
}

function requireId(
    value,
    fieldName
) {

    const normalized =
        normalizeId(
            value
        );

    if (
        !normalized
    ) {

        throw validationError(
            `${fieldName} is required`,
            {
                fieldName
            }
        );
    }

    return normalized;
}

function normalizeReason(
    reason
) {

    const normalized =
        normalizeId(
            reason
        );

    if (
        !normalized
    ) {

        throw validationError(
            'reason is required'
        );
    }

    return normalized.slice(
        0,
        MAX_REASON_LENGTH
    );
}

function normalizeBoolean(
    value
) {

    return value === true;
}

/* ============================================================================
 * Compensation Builder
 * ========================================================================== */

class CompensationBuilder {

    constructor({
        journalService,
        logger,
        clock,
        idGenerator
    } = {}) {

        if (
            !journalService ||
            typeof journalService.build !==
                'function'
        ) {

            throw new TypeError(
                'CompensationBuilder requires journalService.build()'
            );
        }

        this.journalService =
            journalService;

        this.logger =
            logger ||
            console;

        this.clock =
            clock ||
            (() => new Date());

        this.idGenerator =
            idGenerator ||
            generateId;
    }

    /* ========================================================================
     * BUILD
     * ====================================================================== */

    async build({
        originalLedger,
        reason,
        context = {}
    } = {}) {

        this.validateOriginalLedger(
            originalLedger
        );

        const normalizedReason =
            normalizeReason(
                reason
            );

        const originalLedgerId =
            requireId(
                originalLedger.id ||
                originalLedger._id,
                'originalLedger.id'
            );

        /*
         * Tenant identity must not silently drift between source ledger and
         * reversal context.
         */
        this.validateTenantConsistency(
            originalLedger,
            context
        );

        /*
         * Prevent an already reversed source ledger from being compensated
         * again unless the caller explicitly declares a special corrective
         * workflow.
         */
        this.validateReversalEligibility(
            originalLedger,
            context
        );

        /*
         * Validate that the source itself is balanced before constructing a
         * compensating journal.
         */
        this.validateOriginalLedgerBalance(
            originalLedger
        );

        const reversalId =
            normalizeId(
                context.reversalId
            ) ||
            this.idGenerator();

        const idempotencyKey =
            this.buildIdempotencyKey(
                originalLedgerId,
                reversalId,
                context
            );

        const entries =
            this.buildCompensationEntries(
                originalLedger,
                normalizedReason,
                reversalId
            );

        const balance =
            this.validateCompensationEntries(
                entries
            );

        const metadata =
            this.buildReversalMetadata(
                originalLedger,
                normalizedReason,
                reversalId,
                idempotencyKey,
                balance,
                context
            );

        const buildContext =
            this.buildContext(
                context,
                {
                    reversalId,
                    originalLedgerId,
                    idempotencyKey
                }
            );

        try {

            return await this.journalService.build({
                entries,

                metadata,

                context:
                    buildContext
            });

        } catch (error) {

            this.safeLog(
                'warn',
                'JournalService failed to build compensation journal',
                error,
                {
                    originalLedgerId,
                    reversalId
                }
            );

            throw error;
        }
    }

    /* ========================================================================
     * VALIDATE ORIGINAL LEDGER
     * ====================================================================== */

    validateOriginalLedger(
        originalLedger
    ) {

        if (
            !originalLedger ||
            typeof originalLedger !==
                'object'
        ) {

            throw validationError(
                'originalLedger is required'
            );
        }

        const originalLedgerId =
            normalizeId(
                originalLedger.id ||
                originalLedger._id
            );

        if (
            !originalLedgerId
        ) {

            throw validationError(
                'originalLedger.id is required'
            );
        }

        if (
            !Array.isArray(
                originalLedger.entries
            )
        ) {

            throw validationError(
                'originalLedger.entries must be an array',
                {
                    originalLedgerId
                }
            );
        }

        if (
            originalLedger.entries.length ===
            0
        ) {

            throw validationError(
                'originalLedger.entries must not be empty',
                {
                    originalLedgerId
                }
            );
        }

        if (
            originalLedger.entries.length >
            MAX_ENTRIES
        ) {

            throw validationError(
                `originalLedger.entries exceeds maximum supported size of ${MAX_ENTRIES}`,
                {
                    originalLedgerId,

                    entryCount:
                        originalLedger.entries.length
                }
            );
        }

        for (
            let index = 0;
            index <
            originalLedger.entries.length;
            index += 1
        ) {

            this.validateOriginalEntry(
                originalLedger.entries[index],
                index
            );
        }

        return true;
    }

    /* ========================================================================
     * VALIDATE ORIGINAL ENTRY
     * ====================================================================== */

    validateOriginalEntry(
        entry,
        index
    ) {

        if (
            !entry ||
            typeof entry !==
                'object'
        ) {

            throw validationError(
                `originalLedger.entries[${index}] must be an object`
            );
        }

        requireId(
            entry.accountId,
            `originalLedger.entries[${index}].accountId`
        );

        const debit =
            this.normalizeAmount(
                entry.debit,
                `originalLedger.entries[${index}].debit`
            );

        const credit =
            this.normalizeAmount(
                entry.credit,
                `originalLedger.entries[${index}].credit`
            );

        if (
            debit === 0 &&
            credit === 0
        ) {

            throw validationError(
                `originalLedger.entries[${index}] must contain a debit or credit amount`
            );
        }

        if (
            debit > 0 &&
            credit > 0
        ) {

            throw validationError(
                `originalLedger.entries[${index}] cannot contain both debit and credit`
            );
        }

        return true;
    }

    /* ========================================================================
     * TENANT CONSISTENCY
     * ====================================================================== */

    validateTenantConsistency(
        originalLedger,
        context
    ) {

        const ledgerTenantId =
            normalizeId(
                originalLedger.tenantId
            );

        const contextTenantId =
            normalizeId(
                context.tenantId
            );

        /*
         * If both exist, they MUST match.
         */
        if (
            ledgerTenantId &&
            contextTenantId &&
            ledgerTenantId !==
                contextTenantId
        ) {

            throw conflictError(
                'Original ledger and reversal context belong to different tenants',
                {
                    originalLedgerId:
                        originalLedger.id ||
                        originalLedger._id,

                    ledgerTenantId,

                    contextTenantId
                }
            );
        }

        /*
         * Production financial operations should normally carry tenant
         * identity explicitly.
         */
        if (
            !ledgerTenantId &&
            !contextTenantId
        ) {

            throw validationError(
                'tenantId is required for financial compensation'
            );
        }

        return true;
    }

    /* ========================================================================
     * REVERSAL ELIGIBILITY
     * ====================================================================== */

    validateReversalEligibility(
        originalLedger,
        context
    ) {

        /*
         * If the source has an explicit reversal marker, reject by default.
         */
        if (
            normalizeBoolean(
                originalLedger.reversed
            ) ||
            normalizeBoolean(
                originalLedger.isReversed
            ) ||
            normalizeBoolean(
                originalLedger.alreadyReversed
            )
        ) {

            if (
                context.allowReversalOfReversal !==
                true
            ) {

                throw conflictError(
                    'Original ledger has already been reversed',
                    {
                        originalLedgerId:
                            originalLedger.id ||
                            originalLedger._id
                    }
                );
            }
        }

        /*
         * A ledger generated as a reversal should not normally itself be
         * reversed by this generic builder.
         */
        const ledgerType =
            String(
                originalLedger.type ||
                originalLedger.transactionType ||
                originalLedger.entryType ||
                ''
            )
                .trim()
                .toUpperCase();

        if (
            ledgerType ===
                REVERSAL_TYPE &&
            context.allowReversalOfReversal !==
                true
        ) {

            throw conflictError(
                'A reversal ledger cannot be reversed again through the standard compensation workflow',
                {
                    originalLedgerId:
                        originalLedger.id ||
                        originalLedger._id,

                    ledgerType
                }
            );
        }

        return true;
    }

    /* ========================================================================
     * VALIDATE ORIGINAL LEDGER BALANCE
     * ====================================================================== */

    validateOriginalLedgerBalance(
        originalLedger
    ) {

        let totalDebit = 0;
        let totalCredit = 0;

        originalLedger.entries.forEach(
            (
                entry,
                index
            ) => {

                const debit =
                    this.normalizeAmount(
                        entry.debit,
                        `originalLedger.entries[${index}].debit`
                    );

                const credit =
                    this.normalizeAmount(
                        entry.credit,
                        `originalLedger.entries[${index}].credit`
                    );

                totalDebit +=
                    debit;

                totalCredit +=
                    credit;
            }
        );

        const difference =
            Math.abs(
                totalDebit -
                totalCredit
            );

        if (
            difference >
            BALANCE_TOLERANCE
        ) {

            throw validationError(
                'Original ledger is not balanced and cannot be reversed',
                {
                    originalLedgerId:
                        originalLedger.id ||
                        originalLedger._id,

                    totalDebit,

                    totalCredit,

                    difference
                }
            );
        }

        return {
            totalDebit,

            totalCredit,

            difference,

            balanced:
                true
        };
    }

    /* ========================================================================
     * BUILD COMPENSATION ENTRIES
     * ====================================================================== */

    buildCompensationEntries(
        originalLedger,
        reason,
        reversalId
    ) {

        const originalLedgerId =
            requireId(
                originalLedger.id ||
                originalLedger._id,
                'originalLedger.id'
            );

        return originalLedger.entries.map(
            (
                entry,
                index
            ) => {

                const debit =
                    this.normalizeAmount(
                        entry.debit,
                        `entries[${index}].debit`
                    );

                const credit =
                    this.normalizeAmount(
                        entry.credit,
                        `entries[${index}].credit`
                    );

                const compensation = {

                    accountId:
                        requireId(
                            entry.accountId,
                            `entries[${index}].accountId`
                        ),

                    /*
                     * Exact debit/credit inversion.
                     */
                    debit:
                        credit,

                    credit:
                        debit,

                    reference:
                        originalLedgerId,

                    originalLedgerId,

                    originalEntryId:
                        normalizeId(
                            entry.id ||
                            entry._id
                        ),

                    reversalId,

                    description:
                        `${DEFAULT_DESCRIPTION_PREFIX}: ${reason}`
                };

                /*
                 * Preserve only controlled accounting attributes.
                 */
                if (
                    entry.currency
                ) {

                    compensation.currency =
                        String(
                            entry.currency
                        )
                            .trim()
                            .slice(
                                0,
                                16
                            );
                }

                if (
                    entry.exchangeRate !==
                        undefined &&
                    entry.exchangeRate !==
                        null
                ) {

                    compensation.exchangeRate =
                        this.normalizeRate(
                            entry.exchangeRate
                        );
                }

                if (
                    entry.category
                ) {

                    compensation.category =
                        String(
                            entry.category
                        )
                            .trim()
                            .slice(
                                0,
                                128
                            );
                }

                if (
                    entry.costCenter
                ) {

                    compensation.costCenter =
                        String(
                            entry.costCenter
                        )
                            .trim()
                            .slice(
                                0,
                                128
                            );
                }

                return compensation;
            }
        );
    }

    /* ========================================================================
     * VALIDATE COMPENSATION
     * ====================================================================== */

    validateCompensationEntries(
        entries
    ) {

        if (
            !Array.isArray(
                entries
            ) ||
            entries.length ===
                0
        ) {

            throw validationError(
                'Compensation entries must not be empty'
            );
        }

        let totalDebit = 0;
        let totalCredit = 0;

        entries.forEach(
            (
                entry,
                index
            ) => {

                const debit =
                    this.normalizeAmount(
                        entry.debit,
                        `compensation.entries[${index}].debit`
                    );

                const credit =
                    this.normalizeAmount(
                        entry.credit,
                        `compensation.entries[${index}].credit`
                    );

                if (
                    debit > 0 &&
                    credit > 0
                ) {

                    throw validationError(
                        `Compensation entry ${index} contains both debit and credit`
                    );
                }

                if (
                    debit < 0 ||
                    credit < 0
                ) {

                    throw validationError(
                        `Compensation entry ${index} contains a negative amount`
                    );
                }

                totalDebit +=
                    debit;

                totalCredit +=
                    credit;
            }
        );

        const difference =
            Math.abs(
                totalDebit -
                totalCredit
            );

        if (
            difference >
            BALANCE_TOLERANCE
        ) {

            throw validationError(
                'Compensation journal is not balanced',
                {
                    totalDebit,
                    totalCredit,
                    difference
                }
            );
        }

        return {

            valid:
                true,

            totalDebit,

            totalCredit,

            difference,

            entryCount:
                entries.length
        };
    }

    /* ========================================================================
     * AMOUNT NORMALIZATION
     * ====================================================================== */

    normalizeAmount(
        value,
        fieldName
    ) {

        if (
            value === undefined ||
            value === null ||
            value === ''
        ) {

            return 0;
        }

        /*
         * Decimal-like values.
         */
        if (
            typeof value ===
                'object' &&
            typeof value.toString ===
                'function'
        ) {

            const stringValue =
                value.toString();

            if (
                /^-?\d+(?:\.\d+)?$/
                    .test(
                        stringValue
                    )
            ) {

                const numeric =
                    Number(
                        stringValue
                    );

                if (
                    Number.isFinite(
                        numeric
                    )
                ) {

                    if (
                        numeric < 0
                    ) {

                        throw validationError(
                            `${fieldName} cannot be negative`
                        );
                    }

                    return numeric;
                }
            }
        }

        if (
            typeof value ===
                'string' &&
            value.trim() ===
                ''
        ) {

            return 0;
        }

        const numeric =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numeric
            )
        ) {

            throw validationError(
                `${fieldName} must be a finite numeric amount`
            );
        }

        if (
            numeric < 0
        ) {

            throw validationError(
                `${fieldName} cannot be negative`
            );
        }

        return numeric;
    }

    normalizeRate(
        value
    ) {

        const numeric =
            Number(
                value
            );

        if (
            !Number.isFinite(
                numeric
            )
        ) {

            throw validationError(
                'exchangeRate must be a finite number'
            );
        }

        if (
            numeric <= 0
        ) {

            throw validationError(
                'exchangeRate must be greater than zero'
            );
        }

        return numeric;
    }

    /* ========================================================================
     * IDEMPOTENCY IDENTITY
     * ====================================================================== */

    buildIdempotencyKey(
        originalLedgerId,
        reversalId,
        context
    ) {

        if (
            context.idempotencyKey
        ) {

            return String(
                context.idempotencyKey
            )
                .trim()
                .slice(
                    0,
                    512
                );
        }

        /*
         * Stable identity for this exact reversal construction.
         *
         * If the caller explicitly supplies reversalId, the result can be
         * safely reconstructed without generating a second logical reversal.
         */
        return crypto
            .createHash('sha256')
            .update(
                [
                    REVERSAL_TYPE,
                    originalLedgerId,
                    reversalId,
                    context.tenantId ||
                        ''
                ].join(':')
            )
            .digest('hex');
    }

    /* ========================================================================
     * REVERSAL METADATA
     * ====================================================================== */

    buildReversalMetadata(
        originalLedger,
        reason,
        reversalId,
        idempotencyKey,
        balance,
        context
    ) {

        const metadata = {

            reversal:
                true,

            reversalType:
                REVERSAL_TYPE,

            reversalId,

            idempotencyKey,

            originalLedgerId:
                String(
                    originalLedger.id ||
                    originalLedger._id
                ),

            originalTransactionId:
                normalizeId(
                    originalLedger.transactionId
                ),

            originalJournalId:
                normalizeId(
                    originalLedger.journalId
                ),

            originalTenantId:
                normalizeId(
                    originalLedger.tenantId
                ) ||
                normalizeId(
                    context.tenantId
                ),

            reason,

            entryCount:
                balance.entryCount,

            totalDebit:
                balance.totalDebit,

            totalCredit:
                balance.totalCredit,

            createdAt:
                this.clock(),

            correlationId:
                normalizeId(
                    context.correlationId
                ),

            requestId:
                normalizeId(
                    context.requestId
                ),

            operationId:
                normalizeId(
                    context.operationId
                )
        };

        return this.sanitizeMetadata(
            metadata
        );
    }

    /* ========================================================================
     * CONTEXT
     * ====================================================================== */

    buildContext(
        context,
        additional = {}
    ) {

        const tenantId =
            normalizeId(
                context.tenantId
            ) ||
            normalizeId(
                additional.tenantId
            );

        return {

            ...this.sanitizeMetadata(
                context
            ),

            ...additional,

            tenantId,

            adjustment:
                context.adjustment === true,

            reversal:
                true,

            reversalType:
                REVERSAL_TYPE,

            originalLedgerId:
                normalizeId(
                    additional.originalLedgerId
                ),

            reversalId:
                normalizeId(
                    additional.reversalId
                ),

            idempotencyKey:
                normalizeId(
                    additional.idempotencyKey
                ) ||
                normalizeId(
                    context.idempotencyKey
                ),

            correlationId:
                normalizeId(
                    context.correlationId
                ),

            requestId:
                normalizeId(
                    context.requestId
                ),

            operationId:
                normalizeId(
                    context.operationId
                )
        };
    }

    /* ========================================================================
     * SANITIZATION
     * ====================================================================== */

    sanitizeMetadata(
        metadata = {}
    ) {

        const output = {};
        let count = 0;

        for (
            const [
                key,
                value
            ]
            of Object.entries(
                metadata
            )
        ) {

            if (
                count >=
                MAX_METADATA_KEYS
            ) {

                break;
            }

            if (
                SENSITIVE_PATTERNS.some(
                    pattern =>
                        pattern.test(
                            key
                        )
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
                this.sanitizeValue(
                    value
                );

            count++;
        }

        return output;
    }

    sanitizeValue(
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
                MAX_METADATA_STRING_LENGTH
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
            Array.isArray(
                value
            )
        ) {

            return value
                .slice(
                    0,
                    MAX_METADATA_ARRAY_ITEMS
                )
                .map(
                    item =>
                        this.sanitizeValue(
                            item
                        )
                );
        }

        if (
            typeof value ===
            'object'
        ) {

            const nested = {};
            let count = 0;

            for (
                const [
                    key,
                    nestedValue
                ]
                of Object.entries(
                    value
                )
            ) {

                if (
                    count >=
                    MAX_METADATA_KEYS
                ) {

                    break;
                }

                if (
                    SENSITIVE_PATTERNS.some(
                        pattern =>
                            pattern.test(
                                key
                            )
                    )
                ) {

                    continue;
                }

                nested[
                    String(
                        key
                    ).slice(
                        0,
                        128
                    )
                ] =
                    this.sanitizeValue(
                        nestedValue
                    );

                count++;
            }

            return nested;
        }

        return String(
            value
        ).slice(
            0,
            MAX_METADATA_STRING_LENGTH
        );
    }

    /* ========================================================================
     * LOGGING
     * ====================================================================== */

    safeLog(
        level,
        message,
        error,
        metadata = {}
    ) {

        try {

            const method =
                this.logger?.[
                    level
                ];

            if (
                typeof method ===
                'function'
            ) {

                method.call(
                    this.logger,
                    message,
                    {
                        ...metadata,

                        error:
                            error instanceof
                            Error
                                ? error.message
                                : error
                    }
                );
            }

        } catch (_) {
            /*
             * Observability/logging must never alter reversal construction.
             */
        }
    }

    /* ========================================================================
     * DIAGNOSTICS
     * ====================================================================== */

    diagnostics() {

        return {

            module:
                'CompensationBuilder',

            reversalType:
                REVERSAL_TYPE,

            journalServiceConfigured:
                Boolean(
                    this.journalService
                ),

            maxEntries:
                MAX_ENTRIES,

            balanceTolerance:
                BALANCE_TOLERANCE,

            timestamp:
                this.clock()
                    .toISOString()
        };
    }

    /* ========================================================================
     * FACTORY
     * ====================================================================== */

    static create(
        options = {}
    ) {

        return new CompensationBuilder(
            options
        );
    }
}

/* ============================================================================
 * Static exports
 * ========================================================================== */

CompensationBuilder.TYPE =
    REVERSAL_TYPE;

CompensationBuilder.Error =
    CompensationBuilderError;

/* ============================================================================
 * Export
 * ========================================================================== */

module.exports =
    CompensationBuilder;