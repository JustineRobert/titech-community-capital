'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * FeatureExtractor
 * ============================================================================
 *
 * Location:
 *   backend/modules/finance/statements/ai/FeatureExtractor.js
 *
 * Purpose:
 *   Enterprise-grade feature extraction for statement intelligence.
 *
 * Responsibilities:
 *   - Normalize heterogeneous statement transaction payloads
 *   - Extract deterministic transaction features
 *   - Extract reconciliation / repair features
 *   - Extract financial-impact features
 *   - Extract temporal and aging features
 *   - Extract ledger / settlement / payment-provider features
 *   - Extract historical and recurrence features when supplied
 *   - Produce explainable feature metadata
 *   - Preserve missing-data semantics
 *   - Support single and batch extraction
 *   - Produce deterministic feature fingerprints
 *
 * IMPORTANT:
 *   This module is analytical only.
 *
 *   It MUST NOT:
 *   - mutate statements
 *   - modify ledger records
 *   - create journal entries
 *   - execute repairs
 *   - approve repairs
 *   - persist financial transactions
 *
 * ============================================================================
 */

const crypto = require('crypto');

const MODULE_NAME =
    'FeatureExtractor';

const MODULE_VERSION =
    '1.0.0';

const MODULE_TYPE =
    'STATEMENT_AI_FEATURE_EXTRACTION';

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const FEATURE_SCHEMA_VERSION =
    '1.0.0';

const DEFAULT_CURRENCY =
    'UGX';

const DEFAULT_CONFIG =
    Object.freeze({

        defaultCurrency:
            DEFAULT_CURRENCY,

        maximumBatchSize:
            5000,

        roundingDecimals:
            6,

        amountRoundingDecimals:
            2,

        materialityThreshold:
            1000,

        highMaterialityThreshold:
            10000,

        criticalMaterialityThreshold:
            100000,

        amountVarianceTolerance:
            0.01,

        amountVarianceRelativeTolerance:
            0.001,

        dateVarianceToleranceDays:
            1,

        duplicateWindowDays:
            3,

        recurrenceWindowDays:
            30,

        featureMissingValue:
            null,

        includeRawValues:
            false,

        includeFeatureMetadata:
            true,

        includeFingerprint:
            true,

        normalizeText:
            true,

        normalizeReferences:
            true,

        includeTemporalFeatures:
            true,

        includeHistoricalFeatures:
            true,

        includeOperationalFeatures:
            true
    });

/**
 * ============================================================================
 * Error
 * ============================================================================
 */

class FeatureExtractorError extends Error {

    constructor(
        message,
        code = 'FEATURE_EXTRACTION_ERROR',
        metadata = {}
    ) {

        super(message);

        this.name =
            'FeatureExtractorError';

        this.code =
            code;

        this.metadata =
            metadata;

        Error.captureStackTrace?.(
            this,
            FeatureExtractorError
        );
    }
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function isObject(value) {

    return (
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
    );
}

function isArray(value) {

    return Array.isArray(value);
}

function hasValue(value) {

    return (
        value !== null &&
        value !== undefined &&
        (
            typeof value !== 'string' ||
            value.trim() !== ''
        )
    );
}

function toNumber(
    value,
    fallback = 0
) {

    if (
        typeof value === 'number' &&
        Number.isFinite(value)
    ) {

        return value;
    }

    if (
        typeof value === 'string' &&
        value.trim() !== ''
    ) {

        const normalized =
            value
                .replace(/,/g, '')
                .replace(/\s/g, '');

        const number =
            Number(normalized);

        return Number.isFinite(number)
            ? number
            : fallback;
    }

    return fallback;
}

function toNullableNumber(
    value
) {

    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {

        return null;
    }

    const number =
        Number(value);

    return Number.isFinite(number)
        ? number
        : null;
}

function clamp(
    value,
    minimum = 0,
    maximum = 1
) {

    return Math.min(
        maximum,
        Math.max(
            minimum,
            toNumber(value)
        )
    );
}

function round(
    value,
    decimals = DEFAULT_CONFIG.roundingDecimals
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
    }

    const number =
        Number(value);

    if (
        !Number.isFinite(number)
    ) {

        return null;
    }

    const factor =
        Math.pow(
            10,
            decimals
        );

    return Math.round(
        (
            number +
            Number.EPSILON
        ) *
        factor
    ) / factor;
}

function normalizeText(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return '';
    }

    return String(value)
        .trim()
        .replace(/\s+/g, ' ')
        .toUpperCase();
}

function normalizeReference(
    value
) {

    if (
        value === null ||
        value === undefined
    ) {

        return null;
    }

    return normalizeText(
        value
    )
        .replace(/\s+/g, '')
        .replace(/[^A-Z0-9._:/-]/g, '');
}

function parseDate(
    value
) {

    if (
        !hasValue(value)
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
        parseDate(first);

    const secondDate =
        parseDate(second);

    if (
        !firstDate ||
        !secondDate
    ) {

        return null;
    }

    return (
        (
            secondDate.getTime() -
            firstDate.getTime()
        ) /
        (
            1000 *
            60 *
            60 *
            24
        )
    );
}

function absolute(
    value
) {

    return Math.abs(
        toNumber(value)
    );
}

function safeRatio(
    numerator,
    denominator
) {

    const top =
        toNumber(numerator);

    const bottom =
        toNumber(denominator);

    if (
        bottom === 0
    ) {

        return 0;
    }

    return top / bottom;
}

function boolToNumber(
    value
) {

    return value === true
        ? 1
        : 0;
}

function normalizeBoolean(
    value
) {

    if (
        typeof value === 'boolean'
    ) {

        return value;
    }

    if (
        typeof value === 'number'
    ) {

        return value !== 0;
    }

    if (
        typeof value === 'string'
    ) {

        return [
            'TRUE',
            'YES',
            'Y',
            '1',
            'ACTIVE',
            'VALID'
        ].includes(
            normalizeText(value)
        );
    }

    return false;
}

function firstDefined(
    ...values
) {

    for (
        const value of values
    ) {

        if (
            hasValue(value)
        ) {

            return value;
        }
    }

    return null;
}

/**
 * ============================================================================
 * Stable Serialization
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
                    stableSerialize(item)
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

function fingerprint(
    value
) {

    return crypto
        .createHash(
            'sha256'
        )
        .update(
            stableSerialize(value)
        )
        .digest(
            'hex'
        );
}

/**
 * ============================================================================
 * Field Extraction Helpers
 * ============================================================================
 */

function getAmount(
    transaction
) {

    return firstDefined(

        transaction.amount,

        transaction.transactionAmount,

        transaction.statementAmount,

        transaction.value,

        transaction.grossAmount,

        transaction.netAmount
    );
}

function getLedgerAmount(
    transaction
) {

    return firstDefined(

        transaction.ledgerAmount,

        transaction.postedAmount,

        transaction.accountingAmount,

        transaction.ledger?.amount,

        transaction.reconciledAmount
    );
}

function getVarianceAmount(
    transaction
) {

    const explicit =
        firstDefined(

            transaction.varianceAmount,

            transaction.amountVariance,

            transaction.variance?.amount
        );

    if (
        explicit !== null
    ) {

        return toNullableNumber(
            explicit
        );
    }

    const statementAmount =
        toNullableNumber(
            getAmount(
                transaction
            )
        );

    const ledgerAmount =
        toNullableNumber(
            getLedgerAmount(
                transaction
            )
        );

    if (
        statementAmount === null ||
        ledgerAmount === null
    ) {

        return null;
    }

    return (
        statementAmount -
        ledgerAmount
    );
}

function getCurrency(
    transaction,
    config
) {

    return normalizeText(
        firstDefined(

            transaction.currency,

            transaction.currencyCode,

            transaction.statementCurrency,

            transaction.ledgerCurrency,

            transaction.account?.currency,

            config.defaultCurrency
        )
    );
}

function getTransactionDate(
    transaction
) {

    return firstDefined(

        transaction.transactionDate,

        transaction.date,

        transaction.valueDate,

        transaction.postingDate,

        transaction.postedAt
    );
}

function getPostingDate(
    transaction
) {

    return firstDefined(

        transaction.postingDate,

        transaction.postedAt,

        transaction.ledger?.postingDate,

        transaction.ledger?.postedAt
    );
}

function getValueDate(
    transaction
) {

    return firstDefined(

        transaction.valueDate,

        transaction.transactionDate,

        transaction.date
    );
}

function getReference(
    transaction
) {

    return firstDefined(

        transaction.transactionReference,

        transaction.reference,

        transaction.referenceNumber,

        transaction.externalReference,

        transaction.providerReference,

        transaction.bankReference,

        transaction.traceId
    );
}

function getDescription(
    transaction
) {

    return firstDefined(

        transaction.description,

        transaction.narration,

        transaction.memo,

        transaction.details,

        transaction.transactionDescription
    );
}

function getAccountId(
    transaction
) {

    return firstDefined(

        transaction.accountId,

        transaction.ledgerAccountId,

        transaction.account?._id,

        transaction.account?.id,

        transaction.account?.accountId
    );
}

function getTransactionId(
    transaction
) {

    return firstDefined(

        transaction.transactionId,

        transaction.id,

        transaction._id,

        transaction.statementTransactionId,

        transaction.externalTransactionId
    );
}

function getStatementId(
    transaction
) {

    return firstDefined(

        transaction.statementId,

        transaction.statement?._id,

        transaction.statement?.id
    );
}

/**
 * ============================================================================
 * Text / Description Features
 * ============================================================================
 */

function extractTextFeatures(
    transaction,
    config
) {

    const description =
        getDescription(
            transaction
        );

    const normalizedDescription =
        config.normalizeText
            ? normalizeText(
                description
            )
            : String(
                description || ''
            );

    const tokens =
        normalizedDescription
            ? normalizedDescription
                .split(/\s+/)
                .filter(Boolean)
            : [];

    const digits =
        (
            normalizedDescription
                .match(
                    /\d/g
                ) ||
            []
        ).length;

    const letters =
        (
            normalizedDescription
                .match(
                    /[A-Z]/g
                ) ||
            []
        ).length;

    const specialCharacters =
        (
            normalizedDescription
                .match(
                    /[^A-Z0-9\s]/g
                ) ||
            []
        ).length;

    const hasPhoneNumber =
        /\b(?:\+?256|0)?7\d{8}\b/
            .test(
                normalizedDescription
            );

    const hasProviderReference =
        /\b(?:MTN|AIRTEL|MOMO|MOBILE|PAY|BANK|TRANSFER)\b/
            .test(
                normalizedDescription
            );

    const hasLoanKeyword =
        /\b(?:LOAN|REPAYMENT|INSTALLMENT|PRINCIPAL|INTEREST)\b/
            .test(
                normalizedDescription
            );

    const hasFeeKeyword =
        /\b(?:FEE|CHARGE|COMMISSION|LEVY|COST)\b/
            .test(
                normalizedDescription
            );

    const hasSettlementKeyword =
        /\b(?:SETTLEMENT|SETTLE|CLEARING|BATCH)\b/
            .test(
                normalizedDescription
            );

    const hasReversalKeyword =
        /\b(?:REVERSAL|REVERSED|REVERSE)\b/
            .test(
                normalizedDescription
            );

    const hasRefundKeyword =
        /\b(?:REFUND|REFUNDED)\b/
            .test(
                normalizedDescription
            );

    return {

        descriptionLength:
            normalizedDescription.length,

        tokenCount:
            tokens.length,

        digitCount:
            digits,

        letterCount:
            letters,

        specialCharacterCount:
            specialCharacters,

        digitDensity:
            round(
                safeRatio(
                    digits,
                    normalizedDescription.length
                )
            ),

        hasPhoneNumber:
            hasPhoneNumber,

        hasProviderReference:
            hasProviderReference,

        hasLoanKeyword:
            hasLoanKeyword,

        hasFeeKeyword:
            hasFeeKeyword,

        hasSettlementKeyword:
            hasSettlementKeyword,

        hasReversalKeyword:
            hasReversalKeyword,

        hasRefundKeyword:
            hasRefundKeyword
    };
}

/**
 * ============================================================================
 * Amount Features
 * ============================================================================
 */

function extractAmountFeatures(
    transaction,
    config
) {

    const amount =
        toNullableNumber(
            getAmount(
                transaction
            )
        );

    const ledgerAmount =
        toNullableNumber(
            getLedgerAmount(
                transaction
            )
        );

    const varianceAmount =
        getVarianceAmount(
            transaction
        );

    const absoluteAmount =
        amount === null
            ? null
            : Math.abs(
                amount
            );

    const absoluteVariance =
        varianceAmount === null
            ? null
            : Math.abs(
                varianceAmount
            );

    const relativeVariance =
        varianceAmount === null ||
        amount === null ||
        amount === 0
            ? 0
            : Math.abs(
                varianceAmount /
                amount
            );

    const debitAmount =
        firstDefined(
            transaction.debitAmount,
            transaction.debit,
            transaction.withdrawal,
            transaction.withdrawalAmount
        );

    const creditAmount =
        firstDefined(
            transaction.creditAmount,
            transaction.credit,
            transaction.deposit,
            transaction.depositAmount
        );

    const debit =
        toNullableNumber(
            debitAmount
        );

    const credit =
        toNullableNumber(
            creditAmount
        );

    const signedAmount =
        firstDefined(
            transaction.signedAmount,
            transaction.netAmount
        );

    const effectiveSignedAmount =
        signedAmount !== null
            ? toNullableNumber(
                signedAmount
            )
            : (
                credit !== null &&
                debit !== null
                    ? credit - debit
                    : amount
            );

    const materialityThreshold =
        toNumber(
            config.materialityThreshold
        );

    const highMaterialityThreshold =
        toNumber(
            config.highMaterialityThreshold
        );

    const criticalMaterialityThreshold =
        toNumber(
            config.criticalMaterialityThreshold
        );

    let materiality =
        'NONE';

    if (
        absoluteAmount !== null &&
        absoluteAmount >=
        criticalMaterialityThreshold
    ) {

        materiality =
            'CRITICAL';

    } else if (
        absoluteAmount !== null &&
        absoluteAmount >=
        highMaterialityThreshold
    ) {

        materiality =
            'HIGH';

    } else if (
        absoluteAmount !== null &&
        absoluteAmount >=
        materialityThreshold
    ) {

        materiality =
            'MEDIUM';

    } else if (
        absoluteAmount !== null
    ) {

        materiality =
            'LOW';
    }

    const varianceTolerance =
        Math.max(
            toNumber(
                config.amountVarianceTolerance
            ),
            Math.abs(
                toNumber(
                    amount
                )
            ) *
            toNumber(
                config.amountVarianceRelativeTolerance
            )
        );

    return {

        amount:
            amount === null
                ? null
                : round(
                    amount,
                    config.amountRoundingDecimals
                ),

        absoluteAmount:
            absoluteAmount === null
                ? null
                : round(
                    absoluteAmount,
                    config.amountRoundingDecimals
                ),

        ledgerAmount:
            ledgerAmount === null
                ? null
                : round(
                    ledgerAmount,
                    config.amountRoundingDecimals
                ),

        varianceAmount:
            varianceAmount === null
                ? null
                : round(
                    varianceAmount,
                    config.amountRoundingDecimals
                ),

        absoluteVariance:
            absoluteVariance === null
                ? null
                : round(
                    absoluteVariance,
                    config.amountRoundingDecimals
                ),

        relativeVariance:
            round(
                relativeVariance
            ),

        debitAmount:
            debit === null
                ? null
                : round(
                    debit,
                    config.amountRoundingDecimals
                ),

        creditAmount:
            credit === null
                ? null
                : round(
                    credit,
                    config.amountRoundingDecimals
                ),

        signedAmount:
            effectiveSignedAmount === null
                ? null
                : round(
                    effectiveSignedAmount,
                    config.amountRoundingDecimals
                ),

        isDebit:
            effectiveSignedAmount !== null
                ? effectiveSignedAmount < 0
                : debit !== null &&
                  debit > 0,

        isCredit:
            effectiveSignedAmount !== null
                ? effectiveSignedAmount > 0
                : credit !== null &&
                  credit > 0,

        hasAmount:
            amount !== null,

        hasLedgerAmount:
            ledgerAmount !== null,

        hasVariance:
            varianceAmount !== null,

        varianceWithinTolerance:
            varianceAmount === null
                ? null
                : absoluteVariance <=
                  varianceTolerance,

        varianceTolerance:
            round(
                varianceTolerance,
                config.amountRoundingDecimals
            ),

        materiality
    };
}

/**
 * ============================================================================
 * Date / Temporal Features
 * ============================================================================
 */

function extractTemporalFeatures(
    transaction,
    options,
    config
) {

    if (
        config.includeTemporalFeatures === false
    ) {

        return {};
    }

    const transactionDate =
        getTransactionDate(
            transaction
        );

    const postingDate =
        getPostingDate(
            transaction
        );

    const valueDate =
        getValueDate(
            transaction
        );

    const referenceDate =
        parseDate(
            options.referenceDate
        ) ||
        new Date();

    const transactionDateObject =
        parseDate(
            transactionDate
        );

    const postingDateObject =
        parseDate(
            postingDate
        );

    const valueDateObject =
        parseDate(
            valueDate
        );

    const transactionToPostingDays =
        daysBetween(
            transactionDateObject,
            postingDateObject
        );

    const transactionToValueDays =
        daysBetween(
            transactionDateObject,
            valueDateObject
        );

    const transactionAgeDays =
        transactionDateObject
            ? Math.max(
                0,
                daysBetween(
                    transactionDateObject,
                    referenceDate
                )
            )
            : null;

    const postingAgeDays =
        postingDateObject
            ? Math.max(
                0,
                daysBetween(
                    postingDateObject,
                    referenceDate
                )
            )
            : null;

    const date =
        transactionDateObject;

    return {

        transactionDate:
            date
                ? date.toISOString()
                : null,

        postingDate:
            postingDateObject
                ? postingDateObject.toISOString()
                : null,

        valueDate:
            valueDateObject
                ? valueDateObject.toISOString()
                : null,

        transactionToPostingDays:
            transactionToPostingDays === null
                ? null
                : round(
                    Math.abs(
                        transactionToPostingDays
                    )
                ),

        transactionToValueDays:
            transactionToValueDays === null
                ? null
                : round(
                    Math.abs(
                        transactionToValueDays
                    )
                ),

        transactionAgeDays:
            transactionAgeDays === null
                ? null
                : round(
                    transactionAgeDays
                ),

        postingAgeDays:
            postingAgeDays === null
                ? null
                : round(
                    postingAgeDays
                ),

        transactionYear:
            date
                ? date.getUTCFullYear()
                : null,

        transactionMonth:
            date
                ? date.getUTCMonth() + 1
                : null,

        transactionDay:
            date
                ? date.getUTCDate()
                : null,

        transactionDayOfWeek:
            date
                ? date.getUTCDay()
                : null,

        transactionHour:
            date
                ? date.getUTCHours()
                : null,

        isWeekend:
            date
                ? (
                    date.getUTCDay() === 0 ||
                    date.getUTCDay() === 6
                )
                : null,

        isMonthEnd:
            date
                ? date.getUTCDate() >=
                  25
                : null,

        isMonthStart:
            date
                ? date.getUTCDate() <=
                  5
                : null
    };
}

/**
 * ============================================================================
 * Identity / Reference Features
 * ============================================================================
 */

function extractIdentityFeatures(
    transaction,
    config
) {

    const transactionId =
        getTransactionId(
            transaction
        );

    const statementId =
        getStatementId(
            transaction
        );

    const reference =
        getReference(
            transaction
        );

    const normalizedReference =
        config.normalizeReferences
            ? normalizeReference(
                reference
            )
            : reference;

    const accountId =
        getAccountId(
            transaction
        );

    const provider =
        firstDefined(

            transaction.provider,

            transaction.paymentProvider,

            transaction.providerName,

            transaction.channel?.provider,

            transaction.settlement?.provider
        );

    const channel =
        firstDefined(

            transaction.channel,

            transaction.paymentChannel,

            transaction.transactionChannel,

            transaction.source
        );

    const transactionType =
        firstDefined(

            transaction.transactionType,

            transaction.type,

            transaction.messageType,

            transaction.category
        );

    return {

        transactionId:
            transactionId !== null
                ? String(transactionId)
                : null,

        statementId:
            statementId !== null
                ? String(statementId)
                : null,

        accountId:
            accountId !== null
                ? String(accountId)
                : null,

        reference:
            reference !== null
                ? String(reference)
                : null,

        normalizedReference,

        referenceLength:
            normalizedReference
                ? normalizedReference.length
                : 0,

        referenceTokenCount:
            normalizedReference
                ? normalizedReference
                    .split(/[-_:/.]/)
                    .filter(Boolean)
                    .length
                : 0,

        hasReference:
            hasValue(reference),

        provider:
            provider
                ? normalizeText(
                    provider
                )
                : null,

        channel:
            channel
                ? normalizeText(
                    channel
                )
                : null,

        transactionType:
            transactionType
                ? normalizeText(
                    transactionType
                )
                : null
    };
}

/**
 * ============================================================================
 * Reconciliation Features
 * ============================================================================
 */

function extractReconciliationFeatures(
    transaction,
    amountFeatures,
    temporalFeatures,
    config
) {

    const reconciliation =
        transaction.reconciliation ||
        {};

    const matched =
        firstDefined(

            transaction.matched,

            transaction.isMatched,

            reconciliation.matched,

            reconciliation.isMatched
        );

    const matchScore =
        firstDefined(

            transaction.matchScore,

            transaction.matchConfidence,

            reconciliation.score,

            reconciliation.matchScore,

            reconciliation.confidence
        );

    const matchStatus =
        firstDefined(

            transaction.matchStatus,

            reconciliation.status
        );

    const candidateCount =
        firstDefined(

            transaction.candidateCount,

            reconciliation.candidateCount,

            reconciliation.candidates?.length
        );

    const ledgerEntryExists =
        firstDefined(

            transaction.ledgerEntryExists,

            transaction.hasLedgerEntry,

            transaction.ledger?.exists,

            reconciliation.ledgerEntryExists
        );

    const duplicate =
        firstDefined(

            transaction.isDuplicate,

            transaction.duplicate,

            reconciliation.isDuplicate
        );

    const varianceDetected =
        amountFeatures.hasVariance &&
        !amountFeatures.varianceWithinTolerance;

    const dateVarianceDetected =
        temporalFeatures.transactionToPostingDays !== null &&
        temporalFeatures.transactionToPostingDays >
        toNumber(
            config.dateVarianceToleranceDays
        );

    const unmatched =
        matched !== null
            ? !normalizeBoolean(
                matched
            )
            : (
                ledgerEntryExists !== null
                    ? !normalizeBoolean(
                        ledgerEntryExists
                    )
                    : false
            );

    return {

        matched:
            matched === null
                ? null
                : normalizeBoolean(
                    matched
                ),

        matchScore:
            matchScore === null
                ? null
                : clamp(
                    toNumber(
                        matchScore
                    ) > 1
                        ? toNumber(
                            matchScore
                        ) / 100
                        : toNumber(
                            matchScore
                        )
                ),

        matchStatus:
            matchStatus
                ? normalizeText(
                    matchStatus
                )
                : null,

        candidateCount:
            candidateCount === null
                ? null
                : Math.max(
                    0,
                    Math.floor(
                        toNumber(
                            candidateCount
                        )
                    )
                ),

        ledgerEntryExists:
            ledgerEntryExists === null
                ? null
                : normalizeBoolean(
                    ledgerEntryExists
                ),

        duplicate:
            duplicate === null
                ? null
                : normalizeBoolean(
                    duplicate
                ),

        unmatched,

        varianceDetected,

        dateVarianceDetected,

        reconciliationConfidence:
            matchScore === null
                ? null
                : clamp(
                    toNumber(
                        matchScore
                    ) > 1
                        ? toNumber(
                            matchScore
                        ) / 100
                        : toNumber(
                            matchScore
                        )
                )
    };
}

/**
 * ============================================================================
 * Settlement Features
 * ============================================================================
 */

function extractSettlementFeatures(
    transaction
) {

    const settlement =
        transaction.settlement ||
        {};

    const settlementId =
        firstDefined(

            transaction.settlementId,

            settlement.id,

            settlement.settlementId,

            settlement.reference
        );

    const settlementStatus =
        firstDefined(

            transaction.settlementStatus,

            settlement.status,

            settlement.state
        );

    const settlementAmount =
        firstDefined(

            transaction.settlementAmount,

            settlement.amount,

            settlement.netAmount
        );

    const settlementCurrency =
        firstDefined(

            transaction.settlementCurrency,

            settlement.currency,

            settlement.currencyCode
        );

    const settlementDate =
        firstDefined(

            transaction.settlementDate,

            settlement.date,

            settlement.settledAt
        );

    const failed =
        firstDefined(

            transaction.settlementFailed,

            settlement.failed,

            settlementStatus &&
            [
                'FAILED',
                'ERROR',
                'REJECTED'
            ].includes(
                normalizeText(
                    settlementStatus
                )
            )
        );

    return {

        settlementId:
            settlementId !== null
                ? String(
                    settlementId
                )
                : null,

        settlementStatus:
            settlementStatus
                ? normalizeText(
                    settlementStatus
                )
                : null,

        settlementAmount:
            settlementAmount === null
                ? null
                : round(
                    toNumber(
                        settlementAmount
                    ),
                    2
                ),

        settlementCurrency:
            settlementCurrency
                ? normalizeText(
                    settlementCurrency
                )
                : null,

        settlementDate:
            parseDate(
                settlementDate
            )?.toISOString() ||
            null,

        settlementFailed:
            normalizeBoolean(
                failed
            ),

        settlementPresent:
            settlementId !== null ||
            settlementStatus !== null
    };
}

/**
 * ============================================================================
 * Provider Features
 * ============================================================================
 */

function extractProviderFeatures(
    transaction
) {

    const provider =
        firstDefined(

            transaction.provider,

            transaction.paymentProvider,

            transaction.providerName,

            transaction.channel?.provider,

            transaction.settlement?.provider
        );

    const providerReference =
        firstDefined(

            transaction.providerReference,

            transaction.externalReference,

            transaction.providerTransactionId,

            transaction.externalTransactionId,

            transaction.provider?.transactionId
        );

    const providerStatus =
        firstDefined(

            transaction.providerStatus,

            transaction.providerState,

            transaction.paymentStatus,

            transaction.provider?.status
        );

    const providerResponseCode =
        firstDefined(

            transaction.providerResponseCode,

            transaction.responseCode,

            transaction.provider?.responseCode
        );

    const providerFailure =
        firstDefined(

            transaction.providerFailure,

            transaction.providerError,

            transaction.provider?.failed
        );

    return {

        provider:
            provider
                ? normalizeText(
                    provider
                )
                : null,

        providerReference:
            providerReference !== null
                ? String(
                    providerReference
                )
                : null,

        normalizedProviderReference:
            providerReference !== null
                ? normalizeReference(
                    providerReference
                )
                : null,

        providerStatus:
            providerStatus
                ? normalizeText(
                    providerStatus
                )
                : null,

        providerResponseCode:
            providerResponseCode !== null
                ? String(
                    providerResponseCode
                )
                : null,

        providerFailure:
            providerFailure === null
                ? false
                : normalizeBoolean(
                    providerFailure
                )
    };
}

/**
 * ============================================================================
 * Loan Features
 * ============================================================================
 */

function extractLoanFeatures(
    transaction
) {

    const loan =
        transaction.loan ||
        {};

    const loanId =
        firstDefined(

            transaction.loanId,

            loan.loanId,

            loan.id,

            loan._id
        );

    const repaymentId =
        firstDefined(

            transaction.repaymentId,

            loan.repaymentId,

            loan.repayment?.id,

            loan.repayment?._id
        );

    const expectedRepayment =
        firstDefined(

            transaction.expectedRepaymentAmount,

            transaction.expectedAmount,

            loan.expectedRepaymentAmount,

            loan.repayment?.expectedAmount
        );

    const principal =
        firstDefined(

            transaction.principalAmount,

            loan.principalAmount,

            loan.repayment?.principal
        );

    const interest =
        firstDefined(

            transaction.interestAmount,

            loan.interestAmount,

            loan.repayment?.interest
        );

    const penalty =
        firstDefined(

            transaction.penaltyAmount,

            loan.penaltyAmount,

            loan.repayment?.penalty
        );

    const repaymentVariance =
        firstDefined(

            transaction.loanRepaymentVariance,

            transaction.repaymentVariance
        );

    const actualAmount =
        getAmount(
            transaction
        );

    return {

        hasLoan:
            loanId !== null,

        loanId:
            loanId !== null
                ? String(
                    loanId
                )
                : null,

        repaymentId:
            repaymentId !== null
                ? String(
                    repaymentId
                )
                : null,

        expectedRepaymentAmount:
            expectedRepayment === null
                ? null
                : round(
                    toNumber(
                        expectedRepayment
                    ),
                    2
                ),

        principalAmount:
            principal === null
                ? null
                : round(
                    toNumber(
                        principal
                    ),
                    2
                ),

        interestAmount:
            interest === null
                ? null
                : round(
                    toNumber(
                        interest
                    ),
                    2
                ),

        penaltyAmount:
            penalty === null
                ? null
                : round(
                    toNumber(
                        penalty
                    ),
                    2
                ),

        repaymentVariance:
            repaymentVariance !== null
                ? round(
                    toNumber(
                        repaymentVariance
                    ),
                    2
                )
                : (
                    expectedRepayment !== null &&
                    actualAmount !== null
                        ? round(
                            toNumber(
                                actualAmount
                            ) -
                            toNumber(
                                expectedRepayment
                            ),
                            2
                        )
                        : null
                )
    };
}

/**
 * ============================================================================
 * Historical / Recurrence Features
 * ============================================================================
 */

function extractHistoricalFeatures(
    transaction,
    context,
    config
) {

    if (
        config.includeHistoricalFeatures === false
    ) {

        return {};
    }

    const history =
        context.history ||
        context.historical ||
        {};

    const previousTransactions =
        isArray(
            context.previousTransactions
        )
            ? context.previousTransactions
            : isArray(
                history.transactions
            )
                ? history.transactions
                : [];

    const transactionDate =
        getTransactionDate(
            transaction
        );

    const reference =
        getReference(
            transaction
        );

    const amount =
        toNullableNumber(
            getAmount(
                transaction
            )
        );

    let duplicateCandidates =
        0;

    let recurrenceCount =
        0;

    let nearbyAmountMatches =
        0;

    let nearbyReferenceMatches =
        0;

    const duplicateWindow =
        toNumber(
            config.duplicateWindowDays
        );

    const recurrenceWindow =
        toNumber(
            config.recurrenceWindowDays
        );

    for (
        const previous
        of previousTransactions
    ) {

        const previousDate =
            getTransactionDate(
                previous
            );

        const dateDistance =
            transactionDate &&
            previousDate
                ? Math.abs(
                    toNumber(
                        daysBetween(
                            transactionDate,
                            previousDate
                        )
                    )
                )
                : null;

        const previousAmount =
            toNullableNumber(
                getAmount(
                    previous
                )
            );

        const previousReference =
            getReference(
                previous
            );

        const amountMatches =
            amount !== null &&
            previousAmount !== null &&
            Math.abs(
                amount -
                previousAmount
            ) <=
            toNumber(
                config.amountVarianceTolerance
            );

        const referenceMatches =
            hasValue(reference) &&
            hasValue(previousReference) &&
            normalizeReference(
                reference
            ) ===
            normalizeReference(
                previousReference
            );

        if (
            amountMatches
        ) {

            nearbyAmountMatches++;
        }

        if (
            referenceMatches
        ) {

            nearbyReferenceMatches++;
        }

        if (
            dateDistance !== null &&
            dateDistance <=
            duplicateWindow &&
            (
                amountMatches ||
                referenceMatches
            )
        ) {

            duplicateCandidates++;
        }

        if (
            dateDistance !== null &&
            dateDistance <=
            recurrenceWindow &&
            amountMatches
        ) {

            recurrenceCount++;
        }
    }

    const historyCount =
        previousTransactions.length;

    return {

        historicalTransactionCount:
            historyCount,

        duplicateCandidateCount:
            duplicateCandidates,

        recurrenceCount,

        nearbyAmountMatchCount:
            nearbyAmountMatches,

        nearbyReferenceMatchCount:
            nearbyReferenceMatches,

        recurrenceRate:
            round(
                safeRatio(
                    recurrenceCount,
                    Math.max(
                        historyCount,
                        1
                    )
                )
            ),

        duplicateLikelihood:
            round(
                clamp(
                    safeRatio(
                        duplicateCandidates,
                        Math.max(
                            historyCount,
                            1
                        )
                    ) *
                    5
                )
            )
    };
}

/**
 * ============================================================================
 * Operational / Control Features
 * ============================================================================
 */

function extractOperationalFeatures(
    transaction,
    context,
    config
) {

    if (
        config.includeOperationalFeatures === false
    ) {

        return {};
    }

    const period =
        transaction.period ||
        {};

    const control =
        transaction.control ||
        {};

    const operational =
        transaction.operational ||
        {};

    const periodClosed =
        firstDefined(

            transaction.periodClosed,

            transaction.isPeriodClosed,

            period.closed,

            period.isClosed,

            control.periodClosed
        );

    const periodClosing =
        firstDefined(

            transaction.periodClosing,

            period.closing,

            control.periodClosing
        );

    const auditLocked =
        firstDefined(

            transaction.auditLocked,

            transaction.isAuditLocked,

            control.auditLocked
        );

    const regulatoryReportAffected =
        firstDefined(

            transaction.regulatoryReportAffected,

            control.regulatoryReportAffected
        );

    const retryCount =
        firstDefined(

            transaction.retryCount,

            transaction.retries,

            operational.retryCount
        );

    const failureCount =
        firstDefined(

            transaction.failureCount,

            operational.failureCount
        );

    const processingLatency =
        firstDefined(

            transaction.processingLatencyMs,

            transaction.latencyMs,

            operational.processingLatencyMs
        );

    return {

        periodClosed:
            normalizeBoolean(
                periodClosed
            ),

        periodClosing:
            normalizeBoolean(
                periodClosing
            ),

        auditLocked:
            normalizeBoolean(
                auditLocked
            ),

        regulatoryReportAffected:
            normalizeBoolean(
                regulatoryReportAffected
            ),

        retryCount:
            Math.max(
                0,
                Math.floor(
                    toNumber(
                        retryCount
                    )
                )
            ),

        failureCount:
            Math.max(
                0,
                Math.floor(
                    toNumber(
                        failureCount
                    )
                )
            ),

        processingLatencyMs:
            processingLatency === null
                ? null
                : Math.max(
                    0,
                    toNumber(
                        processingLatency
                    )
                ),

        hasOperationalHistory:
            retryCount !== null ||
            failureCount !== null ||
            processingLatency !== null,

        automaticExecutionAllowed:
            !normalizeBoolean(
                periodClosed
            ) &&
            !normalizeBoolean(
                auditLocked
            ) &&
            !normalizeBoolean(
                regulatoryReportAffected
            )
    };
}

/**
 * ============================================================================
 * Data Quality Features
 * ============================================================================
 */

function extractDataQualityFeatures(
    transaction,
    featureSections
) {

    const requiredFields = [

        'transactionId',

        'amount',

        'currency',

        'transactionDate',

        'reference'
    ];

    const present =
        requiredFields.filter(
            field =>
                hasValue(
                    featureSections.identity?.[
                        field
                    ] ??
                    featureSections.amount?.[
                        field
                    ] ??
                    featureSections.temporal?.[
                        field
                    ]
                )
        );

    const missing =
        requiredFields.filter(
            field =>
                !present.includes(
                    field
                )
        );

    const quality =
        requiredFields.length === 0
            ? 1
            : present.length /
              requiredFields.length;

    const amountAvailable =
        featureSections.amount?.hasAmount === true;

    const dateAvailable =
        hasValue(
            featureSections.temporal
                ?.transactionDate
        );

    const referenceAvailable =
        featureSections.identity
            ?.hasReference === true;

    return {

        requiredFieldCount:
            requiredFields.length,

        presentFieldCount:
            present.length,

        missingFieldCount:
            missing.length,

        missingFields:
            missing,

        completeness:
            round(
                quality
            ),

        amountAvailable,

        dateAvailable,

        referenceAvailable,

        qualityLevel:
            quality >= 0.90
                ? 'HIGH'
                : quality >= 0.70
                    ? 'MEDIUM'
                    : 'LOW'
    };
}

/**
 * ============================================================================
 * Feature Metadata
 * ============================================================================
 */

const FEATURE_GROUPS =
    Object.freeze({

        identity:
            'Transaction identity and references',

        amount:
            'Financial amount and variance features',

        temporal:
            'Transaction timing and aging features',

        text:
            'Narration and text-derived features',

        reconciliation:
            'Ledger reconciliation and matching features',

        settlement:
            'Settlement lifecycle features',

        provider:
            'Payment-provider features',

        loan:
            'Loan and repayment features',

        historical:
            'Historical and recurrence features',

        operational:
            'Operational and financial-control features',

        dataQuality:
            'Input data quality features'
    });

function buildFeatureMetadata() {

    return Object.entries(
        FEATURE_GROUPS
    ).map(
        (
            [name, description]
        ) => ({

            name,

            description
        })
    );
}

/**
 * ============================================================================
 * Feature Vector
 * ============================================================================
 */

function buildNumericFeatureVector(
    features
) {

    const vector =
        {};

    function addGroup(
        group,
        values
    ) {

        if (
            !isObject(values)
        ) {

            return;
        }

        for (
            const [
                key,
                value
            ]
            of Object.entries(values)
        ) {

            if (
                typeof value === 'number' &&
                Number.isFinite(value)
            ) {

                vector[
                    `${group}.${key}`
                ] =
                    value;

            } else if (
                typeof value === 'boolean'
            ) {

                vector[
                    `${group}.${key}`
                ] =
                    boolToNumber(
                        value
                    );
            }
        }
    }

    addGroup(
        'amount',
        features.amount
    );

    addGroup(
        'temporal',
        features.temporal
    );

    addGroup(
        'text',
        features.text
    );

    addGroup(
        'reconciliation',
        features.reconciliation
    );

    addGroup(
        'settlement',
        features.settlement
    );

    addGroup(
        'loan',
        features.loan
    );

    addGroup(
        'historical',
        features.historical
    );

    addGroup(
        'operational',
        features.operational
    );

    addGroup(
        'dataQuality',
        features.dataQuality
    );

    return vector;
}

/**
 * ============================================================================
 * Categorical Feature Vector
 * ============================================================================
 */

function buildCategoricalFeatureVector(
    features
) {

    return {

        provider:
            features.identity?.provider ??
            features.provider?.provider ??
            null,

        channel:
            features.identity?.channel ??
            null,

        transactionType:
            features.identity?.transactionType ??
            null,

        currency:
            features.currency ??
            null,

        materiality:
            features.amount?.materiality ??
            null,

        matchStatus:
            features.reconciliation?.matchStatus ??
            null,

        settlementStatus:
            features.settlement?.settlementStatus ??
            null,

        providerStatus:
            features.provider?.providerStatus ??
            null,

        dataQuality:
            features.dataQuality?.qualityLevel ??
            null
    };
}

/**
 * ============================================================================
 * Core Extraction
 * ============================================================================
 */

function extract(
    transaction = {},
    options = {}
) {

    if (
        !isObject(
            transaction
        )
    ) {

        throw new FeatureExtractorError(
            'Transaction input must be an object.',
            'INVALID_TRANSACTION'
        );
    }

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options.config || {})
        };

    const context =
        options.context ||
        {};

    const identity =
        extractIdentityFeatures(
            transaction,
            config
        );

    const amount =
        extractAmountFeatures(
            transaction,
            config
        );

    const temporal =
        extractTemporalFeatures(
            transaction,
            options,
            config
        );

    const text =
        extractTextFeatures(
            transaction,
            config
        );

    const reconciliation =
        extractReconciliationFeatures(
            transaction,
            amount,
            temporal,
            config
        );

    const settlement =
        extractSettlementFeatures(
            transaction
        );

    const provider =
        extractProviderFeatures(
            transaction
        );

    const loan =
        extractLoanFeatures(
            transaction
        );

    const historical =
        extractHistoricalFeatures(
            transaction,
            context,
            config
        );

    const operational =
        extractOperationalFeatures(
            transaction,
            context,
            config
        );

    const currency =
        getCurrency(
            transaction,
            config
        );

    const featureSections = {

        identity,

        amount,

        temporal,

        text,

        reconciliation,

        settlement,

        provider,

        loan,

        historical,

        operational
    };

    const dataQuality =
        extractDataQualityFeatures(
            transaction,
            featureSections
        );

    featureSections.dataQuality =
        dataQuality;

    const numeric =
        buildNumericFeatureVector(
            featureSections
        );

    const categorical =
        buildCategoricalFeatureVector(
            {

                ...featureSections,

                currency
            }
        );

    const baseIdentity = {

        transactionId:
            identity.transactionId,

        statementId:
            identity.statementId,

        accountId:
            identity.accountId,

        reference:
            identity.reference
    };

    const result = {

        success:
            true,

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        schemaVersion:
            FEATURE_SCHEMA_VERSION,

        timestamp:
            new Date()
                .toISOString(),

        transaction:
            baseIdentity,

        currency,

        features:
            featureSections,

        vectors: {

            numeric,

            categorical
        },

        quality:
            dataQuality,

        metadata:
            config.includeFeatureMetadata
                ? buildFeatureMetadata()
                : undefined
    };

    if (
        config.includeRawValues
    ) {

        result.raw =
            {

                amount:
                    getAmount(
                        transaction
                    ),

                ledgerAmount:
                    getLedgerAmount(
                        transaction
                    ),

                reference:
                    getReference(
                        transaction
                    ),

                description:
                    getDescription(
                        transaction
                    ),

                transactionDate:
                    getTransactionDate(
                        transaction
                    ),

                postingDate:
                    getPostingDate(
                        transaction
                    )
            };
    }

    if (
        config.includeFingerprint
    ) {

        result.fingerprint =
            fingerprint(
                {

                    schemaVersion:
                        FEATURE_SCHEMA_VERSION,

                    transaction:
                        baseIdentity,

                    currency,

                    features:
                        featureSections,

                    vectors:
                        {

                            numeric,

                            categorical
                        }
                }
            );
    }

    return result;
}

/**
 * ============================================================================
 * Batch Extraction
 * ============================================================================
 */

function extractBatch(
    transactions,
    options = {}
) {

    if (
        !Array.isArray(
            transactions
        )
    ) {

        throw new FeatureExtractorError(
            'Batch input must be an array.',
            'INVALID_BATCH'
        );
    }

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options.config || {})
        };

    if (
        transactions.length >
        config.maximumBatchSize
    ) {

        throw new FeatureExtractorError(
            `Batch size ${transactions.length} exceeds maximum ${config.maximumBatchSize}.`,
            'BATCH_SIZE_EXCEEDED',
            {

                size:
                    transactions.length,

                maximum:
                    config.maximumBatchSize
            }
        );
    }

    const results =
        [];

    let successCount =
        0;

    let failureCount =
        0;

    for (
        let index = 0;
        index < transactions.length;
        index++
    ) {

        try {

            const result =
                extract(
                    transactions[index],
                    options
                );

            results.push({

                index,

                success:
                    true,

                result
            });

            successCount++;

        } catch (
            error
        ) {

            results.push({

                index,

                success:
                    false,

                error: {

                    name:
                        error.name,

                    code:
                        error.code ||
                        'FEATURE_EXTRACTION_ERROR',

                    message:
                        error.message,

                    metadata:
                        error.metadata || {}
                }
            });

            failureCount++;
        }
    }

    return {

        success:
            failureCount === 0,

        module:
            MODULE_NAME,

        version:
            MODULE_VERSION,

        schemaVersion:
            FEATURE_SCHEMA_VERSION,

        total:
            transactions.length,

        successCount,

        failureCount,

        results
    };
}

/**
 * ============================================================================
 * Flat Feature Extraction
 * ============================================================================
 *
 * Useful for:
 *   - ML pipelines
 *   - analytics
 *   - feature stores
 *   - scoring engines
 *   - Prometheus-compatible aggregation
 *
 * ============================================================================
 */

function extractFlat(
    transaction,
    options = {}
) {

    const result =
        extract(
            transaction,
            options
        );

    const flat =
        {};

    function flatten(
        object,
        prefix = ''
    ) {

        if (
            !isObject(
                object
            )
        ) {

            return;
        }

        for (
            const [
                key,
                value
            ]
            of Object.entries(object)
        ) {

            const path =
                prefix
                    ? `${prefix}.${key}`
                    : key;

            if (
                isObject(
                    value
                )
            ) {

                flatten(
                    value,
                    path
                );

            } else if (
                Array.isArray(
                    value
                )
            ) {

                flat[path] =
                    value;

            } else {

                flat[path] =
                    value;
            }
        }
    }

    flatten(
        result.features
    );

    return {

        success:
            true,

        module:
            MODULE_NAME,

        schemaVersion:
            FEATURE_SCHEMA_VERSION,

        transaction:
            result.transaction,

        features:
            flat,

        fingerprint:
            result.fingerprint
    };
}

/**
 * ============================================================================
 * Feature Fingerprint
 * ============================================================================
 */

function getFeatureFingerprint(
    transaction,
    options = {}
) {

    const result =
        extract(
            transaction,
            {

                ...options,

                config: {

                    ...(options.config || {}),

                    includeRawValues:
                        false,

                    includeFeatureMetadata:
                        false,

                    includeFingerprint:
                        false
                }
            }
        );

    return fingerprint(
        {

            schemaVersion:
                FEATURE_SCHEMA_VERSION,

            features:
                result.features,

            vectors:
                result.vectors
        }
    );
}

/**
 * ============================================================================
 * Feature Comparison
 * ============================================================================
 */

function compare(
    firstTransaction,
    secondTransaction,
    options = {}
) {

    const first =
        extract(
            firstTransaction,
            options
        );

    const second =
        extract(
            secondTransaction,
            options
        );

    const differences =
        [];

    const allKeys =
        new Set(
            [
                ...Object.keys(
                    first.vectors.numeric
                ),

                ...Object.keys(
                    second.vectors.numeric
                )
            ]
        );

    for (
        const key
        of allKeys
    ) {

        const firstValue =
            first.vectors.numeric[
                key
            ] ?? 0;

        const secondValue =
            second.vectors.numeric[
                key
            ] ?? 0;

        if (
            firstValue !==
            secondValue
        ) {

            differences.push({

                feature:
                    key,

                first:
                    firstValue,

                second:
                    secondValue,

                absoluteDifference:
                    Math.abs(
                        firstValue -
                        secondValue
                    )
            });
        }
    }

    const categoricalDifferences =
        [];

    const categoricalKeys =
        new Set(
            [
                ...Object.keys(
                    first.vectors.categorical
                ),

                ...Object.keys(
                    second.vectors.categorical
                )
            ]
        );

    for (
        const key
        of categoricalKeys
    ) {

        const firstValue =
            first.vectors.categorical[
                key
            ];

        const secondValue =
            second.vectors.categorical[
                key
            ];

        if (
            firstValue !==
            secondValue
        ) {

            categoricalDifferences.push({

                feature:
                    key,

                first:
                    firstValue,

                second:
                    secondValue
            });
        }
    }

    return {

        identical:
            differences.length === 0 &&
            categoricalDifferences.length === 0,

        numericDifferences:
            differences,

        categoricalDifferences,

        firstFingerprint:
            first.fingerprint,

        secondFingerprint:
            second.fingerprint
    };
}

/**
 * ============================================================================
 * Similarity
 * ============================================================================
 */

function calculateSimilarity(
    firstTransaction,
    secondTransaction,
    options = {}
) {

    const first =
        extract(
            firstTransaction,
            options
        );

    const second =
        extract(
            secondTransaction,
            options
        );

    const keys =
        new Set(
            [
                ...Object.keys(
                    first.vectors.numeric
                ),

                ...Object.keys(
                    second.vectors.numeric
                )
            ]
        );

    if (
        keys.size === 0
    ) {

        return 0;
    }

    let totalDifference =
        0;

    let comparable =
        0;

    for (
        const key
        of keys
    ) {

        const firstValue =
            first.vectors.numeric[
                key
            ];

        const secondValue =
            second.vectors.numeric[
                key
            ];

        if (
            typeof firstValue !== 'number' ||
            typeof secondValue !== 'number'
        ) {

            continue;
        }

        totalDifference +=
            Math.min(
                1,
                Math.abs(
                    firstValue -
                    secondValue
                )
            );

        comparable++;
    }

    if (
        comparable === 0
    ) {

        return 0;
    }

    return clamp(
        1 -
        (
            totalDifference /
            comparable
        )
    );
}

/**
 * ============================================================================
 * Validation
 * ============================================================================
 */

function validate(
    transaction,
    options = {}
) {

    const errors =
        [];

    const warnings =
        [];

    if (
        !isObject(
            transaction
        )
    ) {

        errors.push(
            'Transaction must be an object.'
        );

        return {

            valid:
                false,

            errors,

            warnings
        };
    }

    const result =
        extract(
            transaction,
            options
        );

    if (
        !result.quality.amountAvailable
    ) {

        warnings.push(
            'Transaction amount is unavailable.'
        );
    }

    if (
        !result.quality.dateAvailable
    ) {

        warnings.push(
            'Transaction date is unavailable.'
        );
    }

    if (
        !result.quality.referenceAvailable
    ) {

        warnings.push(
            'Transaction reference is unavailable.'
        );
    }

    if (
        result.quality.completeness <
        0.50
    ) {

        errors.push(
            'Transaction feature completeness is below the minimum operational threshold.'
        );
    }

    if (
        result.features.operational.periodClosed &&
        result.features.operational.automaticExecutionAllowed
    ) {

        errors.push(
            'Operational control state is internally inconsistent.'
        );
    }

    return {

        valid:
            errors.length === 0,

        errors,

        warnings,

        quality:
            result.quality,

        fingerprint:
            result.fingerprint
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

        schemaVersion:
            FEATURE_SCHEMA_VERSION,

        analyticalOnly:
            true,

        mutatesFinancialState:
            false,

        supportsBatch:
            true,

        supportsFlatFeatures:
            true,

        supportsComparison:
            true,

        supportsSimilarity:
            true,

        supportsFingerprinting:
            true,

        featureGroups:
            FEATURE_GROUPS
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

        schemaVersion:
            FEATURE_SCHEMA_VERSION,

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

function createFeatureExtractor(
    options = {}
) {

    const config =
        {

            ...DEFAULT_CONFIG,

            ...(options.config || {})
        };

    return {

        config,

        extract:
            (
                transaction,
                callOptions = {}
            ) =>
                extract(
                    transaction,
                    {

                        ...options,

                        ...callOptions,

                        config: {

                            ...config,

                            ...(callOptions.config || {})
                        }
                    }
                ),

        extractBatch:
            (
                transactions,
                callOptions = {}
            ) =>
                extractBatch(
                    transactions,
                    {

                        ...options,

                        ...callOptions,

                        config: {

                            ...config,

                            ...(callOptions.config || {})
                        }
                    }
                ),

        extractFlat:
            (
                transaction,
                callOptions = {}
            ) =>
                extractFlat(
                    transaction,
                    {

                        ...options,

                        ...callOptions,

                        config: {

                            ...config,

                            ...(callOptions.config || {})
                        }
                    }
                ),

        validate:
            (
                transaction,
                callOptions = {}
            ) =>
                validate(
                    transaction,
                    {

                        ...options,

                        ...callOptions,

                        config: {

                            ...config,

                            ...(callOptions.config || {})
                        }
                    }
                ),

        getFeatureFingerprint:
            (
                transaction,
                callOptions = {}
            ) =>
                getFeatureFingerprint(
                    transaction,
                    {

                        ...options,

                        ...callOptions,

                        config: {

                            ...config,

                            ...(callOptions.config || {})
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

const FeatureExtractor = {

    MODULE_NAME,

    MODULE_VERSION,

    MODULE_TYPE,

    FEATURE_SCHEMA_VERSION,

    DEFAULT_CONFIG,

    FEATURE_GROUPS,

    FeatureExtractorError,

    /*
     * Utilities
     */
    isObject,

    isArray,

    hasValue,

    toNumber,

    toNullableNumber,

    clamp,

    round,

    normalizeText,

    normalizeReference,

    parseDate,

    daysBetween,

    safeRatio,

    stableSerialize,

    fingerprint,

    /*
     * Field access
     */
    getAmount,

    getLedgerAmount,

    getVarianceAmount,

    getCurrency,

    getTransactionDate,

    getPostingDate,

    getValueDate,

    getReference,

    getDescription,

    getAccountId,

    getTransactionId,

    getStatementId,

    /*
     * Feature extraction
     */
    extractTextFeatures,

    extractAmountFeatures,

    extractTemporalFeatures,

    extractIdentityFeatures,

    extractReconciliationFeatures,

    extractSettlementFeatures,

    extractProviderFeatures,

    extractLoanFeatures,

    extractHistoricalFeatures,

    extractOperationalFeatures,

    extractDataQualityFeatures,

    buildNumericFeatureVector,

    buildCategoricalFeatureVector,

    /*
     * Public extraction
     */
    extract,

    extractBatch,

    extractFlat,

    /*
     * Intelligence support
     */
    getFeatureFingerprint,

    compare,

    calculateSimilarity,

    validate,

    /*
     * Operations
     */
    getMetadata,

    healthCheck
};

module.exports =
    FeatureExtractor;

module.exports.FeatureExtractor =
    FeatureExtractor;

module.exports.FeatureExtractorError =
    FeatureExtractorError;

module.exports.createFeatureExtractor =
    createFeatureExtractor;