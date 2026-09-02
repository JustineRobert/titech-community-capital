'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE REFERRAL REWARD / REWARD-OUTBOX MODEL
 * =============================================================================
 *
 * File:
 *   backend/models/ReferralReward.js
 *
 * Purpose:
 *   Durable, tenant-isolated, idempotent referral reward financial-intent and
 *   reward-outbox record for TITech Community Capital.
 *
 * Architectural position:
 *
 *                         Referral
 *                            │
 *                     eligibility reached
 *                            │
 *                            ▼
 *                    ReferralReward
 *                            │
 *                 durable financial intent
 *                            │
 *              ┌─────────────┴─────────────┐
 *              │                           │
 *              ▼                           ▼
 *       Recovery Worker              Reward Worker
 *                                          │
 *                                      atomic claim
 *                                          │
 *                                          ▼
 *                                      PROCESSING
 *                                          │
 *                              authoritative financial write
 *                                          │
 *                                          ▼
 *                              FinancialTransaction / Ledger
 *                                          │
 *                                          ▼
 *                                       ISSUED
 *
 * FINANCIAL BOUNDARY
 * -----------------------------------------------------------------------------
 *
 * Referral
 *   Represents the referral/business relationship.
 *
 * ReferralReward
 *   Represents the financial obligation, processing lifecycle, retry state,
 *   reconciliation state and durable reward-outbox intent.
 *
 * FinancialTransaction / LedgerTransaction
 *   Represents authoritative movement of money.
 *
 * ReferralReward MUST NOT become an accounting ledger.
 *
 * =============================================================================
 * CORE GUARANTEES
 * =============================================================================
 *
 *  1. Every business operation is tenant scoped.
 *  2. Monetary values use MongoDB Decimal128.
 *  3. JavaScript floating-point arithmetic is never used for reward money.
 *  4. Reward identity is immutable after creation.
 *  5. Idempotency identity is immutable after creation.
 *  6. Idempotency uniqueness is tenant + namespace + key scoped.
 *  7. Processing uses an atomic worker lease.
 *  8. Only the live lease owner may finalize processing.
 *  9. Stale workers cannot issue, retry or permanently fail a reward.
 * 10. Stale PROCESSING records can be atomically recovered.
 * 11. Retry accounting cannot exceed the configured retry budget silently.
 * 12. Issuance is idempotent.
 * 13. Financial reconciliation requires authoritative evidence.
 * 14. Issued rewards may only transition to REVERSED.
 * 15. Physical deletion is prohibited through normal Mongoose APIs.
 * 16. Soft deletion is available only for non-issued administrative records.
 * 17. Legal-hold records cannot be soft deleted.
 * 18. Worker IDs and raw error messages are redacted from normal JSON output.
 * 19. Query helpers are explicitly tenant scoped.
 * 20. All legacy ACFOS terminology is replaced by TITech terminology.
 *
 * =============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('node:crypto');

const {
    REFERRAL_REWARD_STATUS,
    REFERRAL_REWARD_STATUSES,
    REFERRAL_RETRY_POLICY
} = require('../constants/referralConstants');

const {
    Schema,
    Types
} = mongoose;

/**
 * =============================================================================
 * MODEL METADATA
 * =============================================================================
 */

const MODEL_NAME =
    'ReferralReward';

const MODEL_VERSION =
    '2026.3';

const SERVICE_NAME =
    'TITech Referral Reward';

const COLLECTION_NAME =
    'referral_rewards';

/**
 * =============================================================================
 * LIMITS
 * =============================================================================
 */

const MAX_REFERENCE_LENGTH = 128;
const MAX_EXTERNAL_REFERENCE_LENGTH = 256;
const MAX_ERROR_MESSAGE_LENGTH = 1000;
const MAX_ERROR_CODE_LENGTH = 128;
const MAX_REASON_LENGTH = 500;
const MAX_CURRENCY_LENGTH = 16;
const MAX_COUNTRY_LENGTH = 8;
const MAX_DEVICE_ID_LENGTH = 256;
const MAX_IP_LENGTH = 64;
const MAX_USER_AGENT_LENGTH = 1024;
const MAX_WORKER_ID_LENGTH = 256;
const MAX_TAGS = 50;
const MAX_TAG_LENGTH = 64;
const MAX_METADATA_BYTES = 64 * 1024;
const MAX_METADATA_DEPTH = 10;

const DEFAULT_PROCESSING_LEASE_MINUTES = 15;
const MAX_PROCESSING_LEASE_MINUTES = 24 * 60;
const DEFAULT_MAX_ATTEMPTS = 5;

const IDEMPOTENCY_NAMESPACE =
    'titech.referral.reward';

/**
 * =============================================================================
 * ENVIRONMENT CONFIGURATION
 * =============================================================================
 */

function parsePositiveInteger(
    value,
    fallback,
    maximum
) {
    const parsed =
        Number(value);

    if (
        !Number.isFinite(parsed) ||
        parsed <= 0
    ) {
        return fallback;
    }

    return Math.min(
        Math.floor(parsed),
        maximum
    );
}

const MAX_RETRY_ATTEMPTS =
    parsePositiveInteger(
        process.env
            .TITECH_REFERRAL_REWARD_MAX_ATTEMPTS ||
            REFERRAL_RETRY_POLICY?.MAX_ATTEMPTS,
        DEFAULT_MAX_ATTEMPTS,
        100000
    );

const PROCESSING_LEASE_MINUTES =
    parsePositiveInteger(
        process.env
            .TITECH_REFERRAL_REWARD_LEASE_MINUTES,
        DEFAULT_PROCESSING_LEASE_MINUTES,
        MAX_PROCESSING_LEASE_MINUTES
    );

/**
 * =============================================================================
 * STATUS NORMALIZATION
 * =============================================================================
 */

const STATUS =
    Object.freeze({
        PENDING:
            REFERRAL_REWARD_STATUS?.PENDING ||
            'PENDING',

        ELIGIBLE:
            REFERRAL_REWARD_STATUS?.ELIGIBLE ||
            'ELIGIBLE',

        PROCESSING:
            REFERRAL_REWARD_STATUS?.PROCESSING ||
            'PROCESSING',

        RETRYING:
            REFERRAL_REWARD_STATUS?.RETRYING ||
            'RETRYING',

        ISSUED:
            REFERRAL_REWARD_STATUS?.ISSUED ||
            'ISSUED',

        FAILED:
            REFERRAL_REWARD_STATUS?.FAILED ||
            'FAILED',

        FRAUD_REVIEW:
            REFERRAL_REWARD_STATUS?.FRAUD_REVIEW ||
            'FRAUD_REVIEW',

        CANCELLED:
            REFERRAL_REWARD_STATUS?.CANCELLED ||
            'CANCELLED',

        REVERSED:
            REFERRAL_REWARD_STATUS?.REVERSED ||
            'REVERSED'
    });

const ALL_STATUSES =
    Object.freeze(
        Array.from(
            new Set([
                ...(Array.isArray(
                    REFERRAL_REWARD_STATUSES
                )
                    ? REFERRAL_REWARD_STATUSES
                    : []),

                ...Object.values(
                    STATUS
                )
            ])
        )
    );

const TERMINAL_STATUSES =
    Object.freeze([
        STATUS.ISSUED,
        STATUS.CANCELLED,
        STATUS.REVERSED
    ]);

const WORKER_PROCESSABLE_STATUSES =
    Object.freeze([
        STATUS.PENDING,
        STATUS.ELIGIBLE,
        STATUS.RETRYING,
        STATUS.FAILED
    ]);

const RECOVERABLE_STATUSES =
    Object.freeze([
        STATUS.PENDING,
        STATUS.ELIGIBLE,
        STATUS.RETRYING,
        STATUS.FAILED
    ]);

/**
 * =============================================================================
 * ERROR FACTORY
 * =============================================================================
 */

function createReferralRewardError(
    message,
    code,
    details = undefined
) {
    const error =
        new Error(message);

    error.name =
        'ReferralRewardError';

    error.code =
        code;

    if (
        details !== undefined
    ) {
        error.details =
            details;
    }

    return error;
}

/**
 * =============================================================================
 * GENERAL HELPERS
 * =============================================================================
 */

function isValidObjectId(
    value
) {
    return (
        value !== undefined &&
        value !== null &&
        Types.ObjectId.isValid(
            value
        )
    );
}

function assertObjectId(
    value,
    fieldName
) {
    if (
        !isValidObjectId(value)
    ) {
        throw createReferralRewardError(
            `Valid ${fieldName} is required.`,
            'REFERRAL_REWARD_INVALID_IDENTIFIER',
            {
                field:
                    fieldName
            }
        );
    }
}

function assertTenantId(
    tenantId
) {
    assertObjectId(
        tenantId,
        'tenantId'
    );
}

function assertRewardId(
    rewardId
) {
    assertObjectId(
        rewardId,
        'rewardId'
    );
}

function assertReferralId(
    referralId
) {
    assertObjectId(
        referralId,
        'referralId'
    );
}

function normalizeString(
    value,
    {
        maxLength =
            MAX_REFERENCE_LENGTH,

        uppercase =
            false,

        lowercase =
            false
    } = {}
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    let normalized =
        String(value).trim();

    if (!normalized) {
        return undefined;
    }

    if (uppercase) {
        normalized =
            normalized.toUpperCase();
    }

    if (lowercase) {
        normalized =
            normalized.toLowerCase();
    }

    if (
        normalized.length >
        maxLength
    ) {
        normalized =
            normalized.slice(
                0,
                maxLength
            );
    }

    return normalized;
}

function normalizeWorkerId(
    workerId
) {
    const normalized =
        normalizeString(
            workerId,
            {
                maxLength:
                    MAX_WORKER_ID_LENGTH
            }
        );

    if (!normalized) {
        throw createReferralRewardError(
            'workerId is required for leased referral reward operations.',
            'REFERRAL_REWARD_WORKER_REQUIRED'
        );
    }

    return normalized;
}

function normalizeCurrency(
    currency
) {
    const normalized =
        normalizeString(
            currency,
            {
                maxLength:
                    MAX_CURRENCY_LENGTH,

                uppercase:
                    true
            }
        );

    if (
        !normalized ||
        !/^[A-Z]{3,16}$/.test(
            normalized
        )
    ) {
        throw createReferralRewardError(
            'Referral reward currency must be a valid uppercase currency code.',
            'REFERRAL_REWARD_INVALID_CURRENCY'
        );
    }

    return normalized;
}

function normalizeCountryCode(
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
        normalizeString(
            value,
            {
                maxLength:
                    MAX_COUNTRY_LENGTH,

                uppercase:
                    true
            }
        );

    if (
        !normalized ||
        !/^[A-Z]{2,8}$/.test(
            normalized
        )
    ) {
        throw createReferralRewardError(
            'Referral reward countryCode is invalid.',
            'REFERRAL_REWARD_INVALID_COUNTRY'
        );
    }

    return normalized;
}

/**
 * =============================================================================
 * DECIMAL128 MONEY
 * =============================================================================
 *
 * Never perform reward arithmetic using Number(), parseFloat() or parseInt().
 * =============================================================================
 */

function normalizeDecimal(
    value,
    {
        allowZero = true
    } = {}
) {
    if (
        value === undefined ||
        value === null
    ) {
        return undefined;
    }

    if (
        value instanceof
        Types.Decimal128
    ) {
        const stringValue =
            value.toString();

        if (
            !allowZero &&
            /^(?:0+)(?:\.0+)?$/.test(
                stringValue
            )
        ) {
            throw createReferralRewardError(
                'Referral reward amount must be greater than zero.',
                'REFERRAL_REWARD_AMOUNT_ZERO'
            );
        }

        return value;
    }

    const stringValue =
        String(value).trim();

    /**
     * Non-negative decimal, maximum 18 fractional digits.
     */
    if (
        !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(
            stringValue
        )
    ) {
        throw createReferralRewardError(
            'Referral reward amount must be a valid non-negative decimal value.',
            'REFERRAL_REWARD_INVALID_AMOUNT'
        );
    }

    if (
        !allowZero &&
        /^(?:0+)(?:\.0+)?$/.test(
            stringValue
        )
    ) {
        throw createReferralRewardError(
            'Referral reward amount must be greater than zero.',
            'REFERRAL_REWARD_AMOUNT_ZERO'
        );
    }

    return Types.Decimal128.fromString(
        stringValue
    );
}

function decimalToString(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return null;
    }

    if (
        value instanceof
        Types.Decimal128
    ) {
        return value.toString();
    }

    return String(value);
}

function isZeroDecimal(
    value
) {
    const stringValue =
        decimalToString(value);

    return (
        stringValue !== null &&
        /^(?:0+)(?:\.0+)?$/.test(
            stringValue
        )
    );
}

/**
 * =============================================================================
 * DATE HELPERS
 * =============================================================================
 */

function normalizeDate(
    value,
    fallback = new Date()
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const date =
        value instanceof Date
            ? new Date(
                value.getTime()
            )
            : new Date(value);

    if (
        Number.isNaN(
            date.getTime()
        )
    ) {
        throw createReferralRewardError(
            'Invalid date supplied to referral reward operation.',
            'REFERRAL_REWARD_INVALID_DATE'
        );
    }

    return date;
}

function buildLeaseExpiry(
    now,
    leaseMinutes =
        PROCESSING_LEASE_MINUTES
) {
    const minutes =
        parsePositiveInteger(
            leaseMinutes,
            PROCESSING_LEASE_MINUTES,
            MAX_PROCESSING_LEASE_MINUTES
        );

    return new Date(
        now.getTime() +
        minutes *
            60 *
            1000
    );
}

function normalizeLimit(
    value,
    fallback = 50,
    maximum = 500
) {
    return parsePositiveInteger(
        value,
        fallback,
        maximum
    );
}

/**
 * =============================================================================
 * METADATA SAFETY
 * =============================================================================
 */

function calculateDepth(
    value,
    depth = 0
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return depth;
    }

    if (
        depth >
        MAX_METADATA_DEPTH
    ) {
        return depth;
    }

    const values =
        Array.isArray(value)
            ? value
            : Object.values(
                value
            );

    let maximum =
        depth;

    for (
        const child of values
    ) {
        maximum =
            Math.max(
                maximum,
                calculateDepth(
                    child,
                    depth + 1
                )
            );
    }

    return maximum;
}

function validateMetadata(
    value
) {
    if (
        value === undefined ||
        value === null
    ) {
        return true;
    }

    if (
        typeof value !== 'object' ||
        Array.isArray(value)
    ) {
        return false;
    }

    if (
        calculateDepth(value) >
        MAX_METADATA_DEPTH
    ) {
        return false;
    }

    try {
        const serialized =
            JSON.stringify(value);

        return (
            Buffer.byteLength(
                serialized,
                'utf8'
            ) <=
            MAX_METADATA_BYTES
        );
    } catch {
        return false;
    }
}

/**
 * =============================================================================
 * IDENTIFIERS
 * =============================================================================
 */

function createRewardReference() {
    const timestamp =
        Date.now()
            .toString(36)
            .toUpperCase();

    const random =
        crypto
            .randomBytes(12)
            .toString('hex')
            .toUpperCase();

    return (
        `TITECH-RWD-${timestamp}-${random}`
    );
}

function createFallbackIdempotencyKey(
    doc
) {
    const tenantId =
        String(
            doc.tenantId ||
            'unknown-tenant'
        );

    const referralId =
        String(
            doc.referralId ||
            'unknown-referral'
        );

    const beneficiary =
        String(
            doc.beneficiaryUserId ||
            'unknown-beneficiary'
        );

    const rewardType =
        String(
            doc.rewardType ||
            'REFERRAL_REWARD'
        )
            .trim()
            .toUpperCase();

    const campaign =
        doc.campaignId
            ? String(
                doc.campaignId
            )
            : (
                doc.campaignCode ||
                'default-campaign'
            );

    return crypto
        .createHash('sha256')
        .update(
            [
                'titech',
                'referral-reward',
                tenantId,
                referralId,
                beneficiary,
                rewardType,
                campaign
            ].join(':')
        )
        .digest('hex');
}

/**
 * =============================================================================
 * STATE MACHINE
 * =============================================================================
 */

const ALLOWED_TRANSITIONS =
    Object.freeze({
        [STATUS.PENDING]:
            Object.freeze([
                STATUS.ELIGIBLE,
                STATUS.CANCELLED,
                STATUS.FRAUD_REVIEW
            ]),

        [STATUS.ELIGIBLE]:
            Object.freeze([
                STATUS.PROCESSING,
                STATUS.CANCELLED,
                STATUS.FRAUD_REVIEW
            ]),

        [STATUS.PROCESSING]:
            Object.freeze([
                STATUS.ISSUED,
                STATUS.RETRYING,
                STATUS.FAILED,
                STATUS.FRAUD_REVIEW
            ]),

        [STATUS.RETRYING]:
            Object.freeze([
                STATUS.PROCESSING,
                STATUS.CANCELLED,
                STATUS.FRAUD_REVIEW
            ]),

        [STATUS.FAILED]:
            Object.freeze([
                STATUS.RETRYING,
                STATUS.PROCESSING,
                STATUS.FRAUD_REVIEW,
                STATUS.CANCELLED
            ]),

        [STATUS.FRAUD_REVIEW]:
            Object.freeze([
                STATUS.ELIGIBLE,
                STATUS.PROCESSING,
                STATUS.CANCELLED
            ]),

        [STATUS.ISSUED]:
            Object.freeze([
                STATUS.REVERSED
            ]),

        [STATUS.REVERSED]:
            Object.freeze([]),

        [STATUS.CANCELLED]:
            Object.freeze([])
    });

function isAllowedTransition(
    from,
    to
) {
    if (
        from === to
    ) {
        return true;
    }

    return Boolean(
        ALLOWED_TRANSITIONS[
            from
        ]?.includes(to)
    );
}

/**
 * =============================================================================
 * SCHEMA
 * =============================================================================
 */

const referralRewardSchema =
    new Schema(
        {
            /**
             * -----------------------------------------------------------------
             * MODEL IDENTITY
             * -----------------------------------------------------------------
             */

            modelVersion: {
                type:
                    String,

                default:
                    MODEL_VERSION,

                immutable:
                    true,

                trim:
                    true,

                maxlength:
                    32
            },

            rewardReference: {
                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                uppercase:
                    true,

                minlength:
                    12,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH
            },

            /**
             * -----------------------------------------------------------------
             * TENANT / OWNERSHIP
             * -----------------------------------------------------------------
             */

            tenantId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'Tenant',

                required:
                    true,

                immutable:
                    true,

                index:
                    true
            },

            referralId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'Referral',

                required:
                    true,

                immutable:
                    true,

                index:
                    true
            },

            referrerUserId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                required:
                    true,

                immutable:
                    true,

                index:
                    true
            },

            beneficiaryUserId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                required:
                    true,

                immutable:
                    true,

                index:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * REWARD PROGRAM
             * -----------------------------------------------------------------
             */

            rewardType: {
                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                uppercase:
                    true,

                minlength:
                    2,

                maxlength:
                    64,

                index:
                    true
            },

            campaignId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'ReferralCampaign',

                immutable:
                    true,

                default:
                    null,

                index:
                    true
            },

            campaignCode: {
                type:
                    String,

                immutable:
                    true,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    MAX_REFERENCE_LENGTH,

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * MONEY
             * -----------------------------------------------------------------
             */

            amount: {
                type:
                    Schema.Types.Decimal128,

                required:
                    true,

                immutable:
                    true,

                get:
                    decimalToString
            },

            baseAmount: {
                type:
                    Schema.Types.Decimal128,

                immutable:
                    true,

                default:
                    null,

                get:
                    decimalToString
            },

            adjustmentAmount: {
                type:
                    Schema.Types.Decimal128,

                immutable:
                    true,

                default:
                    null,

                get:
                    decimalToString
            },

            currency: {
                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                uppercase:
                    true,

                minlength:
                    3,

                maxlength:
                    MAX_CURRENCY_LENGTH,

                match:
                    /^[A-Z]{3,16}$/,

                index:
                    true
            },

            countryCode: {
                type:
                    String,

                immutable:
                    true,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    MAX_COUNTRY_LENGTH,

                match:
                    /^[A-Z]{2,8}$/,

                default:
                    null,

                index:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * LIFECYCLE
             * -----------------------------------------------------------------
             */

            status: {
                type:
                    String,

                required:
                    true,

                enum:
                    ALL_STATUSES,

                default:
                    STATUS.PENDING,

                uppercase:
                    true,

                index:
                    true
            },

            previousStatus: {
                type:
                    String,

                enum:
                    [
                        ...ALL_STATUSES,
                        null
                    ],

                default:
                    null
            },

            statusChangedAt: {
                type:
                    Date,

                required:
                    true,

                default:
                    Date.now,

                index:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * ELIGIBILITY
             * -----------------------------------------------------------------
             */

            eligibleAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            eligibilityReference: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                immutable:
                    true,

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * IDEMPOTENCY
             * -----------------------------------------------------------------
             */

            idempotencyKey: {
                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                minlength:
                    8,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH
            },

            idempotencyNamespace: {
                type:
                    String,

                required:
                    true,

                immutable:
                    true,

                trim:
                    true,

                lowercase:
                    true,

                default:
                    IDEMPOTENCY_NAMESPACE,

                maxlength:
                    128
            },

            /**
             * -----------------------------------------------------------------
             * AUTHORITATIVE FINANCIAL EVIDENCE
             * -----------------------------------------------------------------
             *
             * These are NOT immutable at schema level because they are assigned
             * when processing is finalized. State-machine predicates protect
             * them from arbitrary lifecycle mutation.
             */

            financialTransactionId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'FinancialTransaction',

                default:
                    null,

                index:
                    true
            },

            ledgerTransactionId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'LedgerTransaction',

                default:
                    null,

                index:
                    true
            },

            ledgerReference: {
                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            issuanceReference: {
                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            externalTransactionReference: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            externalProvider: {
                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    64,

                default:
                    null,

                index:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * PROCESSING LEASE
             * -----------------------------------------------------------------
             */

            processingStartedAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            leaseExpiresAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            workerId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_WORKER_ID_LENGTH,

                default:
                    null
            },

            processingAttempts: {
                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0,

                max:
                    100000
            },

            /**
             * Compatibility alias persisted for legacy callers.
             */
            attempts: {
                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0,

                max:
                    100000
            },

            /**
             * -----------------------------------------------------------------
             * RETRY
             * -----------------------------------------------------------------
             */

            retryCount: {
                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0,

                max:
                    100000
            },

            recoveryCount: {
                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0,

                max:
                    100000
            },

            recoverySuccessCount: {
                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0,

                max:
                    100000
            },

            nextAttemptAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            maxAttempts: {
                type:
                    Number,

                required:
                    true,

                default:
                    MAX_RETRY_ATTEMPTS,

                min:
                    1,

                max:
                    100000,

                immutable:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * FAILURE
             * -----------------------------------------------------------------
             */

            lastErrorCode: {
                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    MAX_ERROR_CODE_LENGTH,

                default:
                    null
            },

            lastErrorMessage: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_ERROR_MESSAGE_LENGTH,

                default:
                    null
            },

            lastFailedAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            permanentlyFailed: {
                type:
                    Boolean,

                default:
                    false,

                index:
                    true
            },

            permanentFailureCount: {
                type:
                    Number,

                required:
                    true,

                default:
                    0,

                min:
                    0,

                max:
                    100000
            },

            /**
             * -----------------------------------------------------------------
             * RECOVERY / RECONCILIATION
             * -----------------------------------------------------------------
             */

            recoveryRequired: {
                type:
                    Boolean,

                default:
                    false,

                index:
                    true
            },

            recoveryReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_REASON_LENGTH,

                default:
                    null
            },

            recoveryReconciled: {
                type:
                    Boolean,

                default:
                    false,

                index:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * FRAUD / RISK
             * -----------------------------------------------------------------
             */

            fraudReviewRequired: {
                type:
                    Boolean,

                default:
                    false,

                index:
                    true
            },

            fraudReviewReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_REASON_LENGTH,

                default:
                    null
            },

            fraudReviewAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            fraudCaseId: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'FraudCase',

                default:
                    null,

                index:
                    true
            },

            riskScore: {
                type:
                    Number,

                min:
                    0,

                max:
                    100,

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * ISSUANCE
             * -----------------------------------------------------------------
             */

            issuedAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            issuedBy: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * REVERSAL
             * -----------------------------------------------------------------
             */

            reversedAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            reversalReference: {
                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            reversalReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_REASON_LENGTH,

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * CANCELLATION
             * -----------------------------------------------------------------
             */

            cancelledAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            cancelledBy: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                default:
                    null
            },

            cancellationReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_REASON_LENGTH,

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * AUDIT / CORRELATION
             * -----------------------------------------------------------------
             */

            createdBy: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                immutable:
                    true,

                default:
                    null
            },

            approvedBy: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                default:
                    null
            },

            approvedAt: {
                type:
                    Date,

                default:
                    null
            },

            correlationId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            requestId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            traceId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_EXTERNAL_REFERENCE_LENGTH,

                default:
                    null,

                index:
                    true
            },

            source: {
                type:
                    String,

                trim:
                    true,

                uppercase:
                    true,

                maxlength:
                    64,

                default:
                    'REFERRAL_SYSTEM',

                immutable:
                    true
            },

            /**
             * -----------------------------------------------------------------
             * DEVICE / NETWORK AUDIT
             * -----------------------------------------------------------------
             */

            ipAddress: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_IP_LENGTH,

                default:
                    null
            },

            userAgent: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_USER_AGENT_LENGTH,

                default:
                    null
            },

            deviceId: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_DEVICE_ID_LENGTH,

                default:
                    null
            },

            /**
             * -----------------------------------------------------------------
             * OPERATIONAL METADATA
             * -----------------------------------------------------------------
             */

            metadata: {
                type:
                    Schema.Types.Mixed,

                default:
                    {},

                validate: {
                    validator:
                        validateMetadata,

                    message:
                        'ReferralReward metadata exceeds allowed size or nesting depth.'
                }
            },

            tags: {
                type: [
                    {
                        type:
                            String,

                        trim:
                            true,

                        uppercase:
                            true,

                        maxlength:
                            MAX_TAG_LENGTH
                    }
                ],

                default:
                    [],

                validate: {
                    validator(values) {
                        return (
                            Array.isArray(
                                values
                            ) &&
                            values.length <=
                                MAX_TAGS
                        );
                    },

                    message:
                        `Referral reward cannot contain more than ${MAX_TAGS} tags.`
                }
            },

            /**
             * -----------------------------------------------------------------
             * SOFT DELETE / LEGAL HOLD
             * -----------------------------------------------------------------
             */

            deletedAt: {
                type:
                    Date,

                default:
                    null,

                index:
                    true
            },

            deletedBy: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                default:
                    null
            },

            deletionReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_REASON_LENGTH,

                default:
                    null
            },

            legalHold: {
                type:
                    Boolean,

                default:
                    false,

                index:
                    true
            },

            legalHoldReason: {
                type:
                    String,

                trim:
                    true,

                maxlength:
                    MAX_REASON_LENGTH,

                default:
                    null
            },

            legalHoldAt: {
                type:
                    Date,

                default:
                    null
            },

            legalHoldBy: {
                type:
                    Schema.Types.ObjectId,

                ref:
                    'User',

                default:
                    null
            }
        },
        {
            collection:
                COLLECTION_NAME,

            timestamps:
                true,

            strict:
                true,

            minimize:
                false,

            versionKey:
                '__v',

            optimisticConcurrency:
                true,

            toJSON: {
                getters:
                    true,

                virtuals:
                    true,

                transform(
                    doc,
                    ret
                ) {
                    if (ret._id) {
                        ret.id =
                            String(
                                ret._id
                            );

                        delete ret._id;
                    }

                    delete ret.__v;

                    /**
                     * Worker ownership and raw provider/error information are
                     * internal operational details.
                     */
                    delete ret.workerId;
                    delete ret.lastErrorMessage;

                    return ret;
                }
            },

            toObject: {
                getters:
                    true,

                virtuals:
                    true
            }
        }
    );

/**
 * =============================================================================
 * INDEXES
 * =============================================================================
 */

/**
 * Reward reference may safely be globally unique because TITech itself creates
 * this opaque identifier.
 */
referralRewardSchema.index(
    {
        rewardReference: 1
    },
    {
        unique:
            true,

        name:
            'uq_titech_rr_reward_reference'
    }
);

/**
 * Idempotency keys MUST NOT be globally unique across unrelated tenants.
 *
 * Isolation identity:
 *
 *   tenantId + idempotencyNamespace + idempotencyKey
 */
referralRewardSchema.index(
    {
        tenantId: 1,
        idempotencyNamespace: 1,
        idempotencyKey: 1
    },
    {
        unique:
            true,

        name:
            'uq_titech_rr_tenant_namespace_idempotency'
    }
);

/**
 * Queue scanning.
 */
referralRewardSchema.index(
    {
        tenantId: 1,
        status: 1,
        nextAttemptAt: 1,
        createdAt: 1
    },
    {
        name:
            'idx_titech_rr_tenant_status_next_attempt'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        status: 1,
        leaseExpiresAt: 1
    },
    {
        name:
            'idx_titech_rr_tenant_processing_lease'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        referralId: 1,
        createdAt: -1
    },
    {
        name:
            'idx_titech_rr_tenant_referral'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        referrerUserId: 1,
        status: 1,
        createdAt: -1
    },
    {
        name:
            'idx_titech_rr_tenant_referrer_status'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        beneficiaryUserId: 1,
        status: 1,
        createdAt: -1
    },
    {
        name:
            'idx_titech_rr_tenant_beneficiary_status'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        rewardType: 1,
        campaignId: 1,
        createdAt: -1
    },
    {
        name:
            'idx_titech_rr_tenant_program'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        currency: 1,
        createdAt: -1
    },
    {
        name:
            'idx_titech_rr_tenant_currency'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        fraudReviewRequired: 1,
        fraudReviewAt: 1
    },
    {
        name:
            'idx_titech_rr_tenant_fraud_review'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        recoveryRequired: 1,
        recoveryReconciled: 1,
        updatedAt: 1
    },
    {
        name:
            'idx_titech_rr_tenant_recovery'
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        financialTransactionId: 1
    },
    {
        name:
            'idx_titech_rr_financial_transaction',

        partialFilterExpression: {
            financialTransactionId: {
                $type:
                    'objectId'
            }
        }
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        ledgerTransactionId: 1
    },
    {
        name:
            'idx_titech_rr_ledger_transaction',

        partialFilterExpression: {
            ledgerTransactionId: {
                $type:
                    'objectId'
            }
        }
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        ledgerReference: 1
    },
    {
        name:
            'idx_titech_rr_ledger_reference',

        partialFilterExpression: {
            ledgerReference: {
                $type:
                    'string'
            }
        }
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        externalProvider: 1,
        externalTransactionReference: 1
    },
    {
        name:
            'idx_titech_rr_external_transaction',

        partialFilterExpression: {
            externalTransactionReference: {
                $type:
                    'string'
            }
        }
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        issuanceReference: 1
    },
    {
        name:
            'idx_titech_rr_issuance_reference',

        partialFilterExpression: {
            issuanceReference: {
                $type:
                    'string'
            }
        }
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        correlationId: 1
    },
    {
        name:
            'idx_titech_rr_tenant_correlation'
    }
);

/**
 * Active retry/recovery queue.
 */
referralRewardSchema.index(
    {
        tenantId: 1,
        nextAttemptAt: 1,
        createdAt: 1
    },
    {
        name:
            'idx_titech_rr_active_recovery_queue',

        partialFilterExpression: {
            status: {
                $in: [
                    STATUS.PENDING,
                    STATUS.ELIGIBLE,
                    STATUS.RETRYING,
                    STATUS.FAILED
                ]
            },

            permanentlyFailed: {
                $ne:
                    true
            },

            deletedAt:
                null
        }
    }
);

referralRewardSchema.index(
    {
        tenantId: 1,
        fraudReviewAt: 1
    },
    {
        name:
            'idx_titech_rr_active_fraud_review',

        partialFilterExpression: {
            fraudReviewRequired:
                true,

            deletedAt:
                null
        }
    }
);

/**
 * =============================================================================
 * VIRTUALS
 * =============================================================================
 *
 * Virtual names intentionally do not collide with instance method names.
 */

referralRewardSchema
    .virtual('terminalState')
    .get(function terminalState() {
        return TERMINAL_STATUSES.includes(
            this.status
        );
    });

referralRewardSchema
    .virtual('processableState')
    .get(function processableState() {
        return WORKER_PROCESSABLE_STATUSES.includes(
            this.status
        );
    });

referralRewardSchema
    .virtual('processingState')
    .get(function processingState() {
        return (
            this.status ===
            STATUS.PROCESSING
        );
    });

referralRewardSchema
    .virtual('issuedState')
    .get(function issuedState() {
        return (
            this.status ===
            STATUS.ISSUED
        );
    });

referralRewardSchema
    .virtual('staleProcessingState')
    .get(function staleProcessingState() {
        if (
            this.status !==
            STATUS.PROCESSING
        ) {
            return false;
        }

        if (
            !this.leaseExpiresAt
        ) {
            return true;
        }

        return (
            this.leaseExpiresAt
                .getTime() <=
            Date.now()
        );
    });

referralRewardSchema
    .virtual('amountString')
    .get(function amountString() {
        return decimalToString(
            this.amount
        );
    });

/**
 * =============================================================================
 * PRE-VALIDATE
 * =============================================================================
 */

referralRewardSchema.pre(
    'validate',
    function referralRewardPreValidate(
        next
    ) {
        try {
            assertTenantId(
                this.tenantId
            );

            assertReferralId(
                this.referralId
            );

            assertObjectId(
                this.referrerUserId,
                'referrerUserId'
            );

            assertObjectId(
                this.beneficiaryUserId,
                'beneficiaryUserId'
            );

            if (
                !this.rewardReference
            ) {
                this.rewardReference =
                    createRewardReference();
            }

            if (
                !this.idempotencyNamespace
            ) {
                this.idempotencyNamespace =
                    IDEMPOTENCY_NAMESPACE;
            }

            if (
                !this.idempotencyKey
            ) {
                this.idempotencyKey =
                    createFallbackIdempotencyKey(
                        this
                    );
            }

            if (
                !this.rewardType
            ) {
                this.rewardType =
                    'REFERRAL_REWARD';
            }

            this.rewardType =
                normalizeString(
                    this.rewardType,
                    {
                        maxLength:
                            64,

                        uppercase:
                            true
                    }
                );

            this.currency =
                normalizeCurrency(
                    this.currency
                );

            if (
                this.countryCode
            ) {
                this.countryCode =
                    normalizeCountryCode(
                        this.countryCode
                    );
            }

            /**
             * Monetary validation.
             *
             * The primary reward obligation must be > 0.
             */
            if (
                this.amount !==
                    undefined &&
                this.amount !==
                    null
            ) {
                this.amount =
                    normalizeDecimal(
                        this.amount,
                        {
                            allowZero:
                                false
                        }
                    );
            }

            if (
                this.baseAmount !==
                    undefined &&
                this.baseAmount !==
                    null
            ) {
                this.baseAmount =
                    normalizeDecimal(
                        this.baseAmount
                    );
            }

            if (
                this.adjustmentAmount !==
                    undefined &&
                this.adjustmentAmount !==
                    null
            ) {
                this.adjustmentAmount =
                    normalizeDecimal(
                        this.adjustmentAmount
                    );
            }

            if (
                !ALL_STATUSES.includes(
                    this.status
                )
            ) {
                return next(
                    createReferralRewardError(
                        `Invalid referral reward status: ${this.status}.`,
                        'REFERRAL_REWARD_INVALID_STATUS'
                    )
                );
            }

            if (
                this.retryCount >
                this.maxAttempts
            ) {
                return next(
                    createReferralRewardError(
                        'retryCount cannot exceed maxAttempts.',
                        'REFERRAL_REWARD_INVALID_RETRY_STATE'
                    )
                );
            }

            if (
                this.status ===
                STATUS.PROCESSING
            ) {
                if (
                    !this.workerId
                ) {
                    return next(
                        createReferralRewardError(
                            'Processing referral rewards require workerId.',
                            'REFERRAL_REWARD_WORKER_REQUIRED'
                        )
                    );
                }

                if (
                    !this.processingStartedAt
                ) {
                    this.processingStartedAt =
                        new Date();
                }

                if (
                    !this.leaseExpiresAt
                ) {
                    this.leaseExpiresAt =
                        buildLeaseExpiry(
                            this.processingStartedAt
                        );
                }

                if (
                    this.leaseExpiresAt <=
                    this.processingStartedAt
                ) {
                    return next(
                        createReferralRewardError(
                            'Referral reward processing lease must expire after processingStartedAt.',
                            'REFERRAL_REWARD_INVALID_LEASE'
                        )
                    );
                }
            }

            if (
                this.status ===
                STATUS.ISSUED
            ) {
                if (
                    !this.issuedAt
                ) {
                    this.issuedAt =
                        new Date();
                }

                const hasEvidence =
                    Boolean(
                        this.issuanceReference ||
                        this.financialTransactionId ||
                        this.ledgerTransactionId ||
                        this.ledgerReference ||
                        this.externalTransactionReference
                    );

                if (!hasEvidence) {
                    return next(
                        createReferralRewardError(
                            'Issued referral rewards require authoritative financial or issuance evidence.',
                            'REFERRAL_REWARD_ISSUANCE_EVIDENCE_REQUIRED'
                        )
                    );
                }
            }

            if (
                this.status ===
                STATUS.REVERSED &&
                !this.reversalReference
            ) {
                return next(
                    createReferralRewardError(
                        'Reversed referral rewards require reversalReference.',
                        'REFERRAL_REWARD_REVERSAL_REFERENCE_REQUIRED'
                    )
                );
            }

            if (
                this.legalHold &&
                !this.legalHoldReason
            ) {
                return next(
                    createReferralRewardError(
                        'legalHoldReason is required when legalHold is enabled.',
                        'REFERRAL_REWARD_LEGAL_HOLD_REASON_REQUIRED'
                    )
                );
            }

            if (
                TERMINAL_STATUSES.includes(
                    this.status
                )
            ) {
                this.workerId =
                    null;

                this.leaseExpiresAt =
                    null;

                this.processingStartedAt =
                    null;

                this.nextAttemptAt =
                    null;
            }

            return next();
        } catch (error) {
            return next(error);
        }
    }
);

/**
 * =============================================================================
 * PRE-SAVE
 * =============================================================================
 */

referralRewardSchema.pre(
    'save',
    function referralRewardPreSave(
        next
    ) {
        try {
            if (
                this.isModified(
                    'status'
                )
            ) {
                this.statusChangedAt =
                    new Date();
            }

            if (
                this.isModified(
                    'processingAttempts'
                )
            ) {
                this.attempts =
                    this.processingAttempts;
            }

            if (
                this.isModified(
                    'tags'
                )
            ) {
                this.tags =
                    Array.from(
                        new Set(
                            (this.tags || [])
                                .map(
                                    value =>
                                        normalizeString(
                                            value,
                                            {
                                                maxLength:
                                                    MAX_TAG_LENGTH,

                                                uppercase:
                                                    true
                                            }
                                        )
                                )
                                .filter(
                                    Boolean
                                )
                        )
                    );
            }

            if (
                this.status ===
                STATUS.ISSUED
            ) {
                this.workerId =
                    null;

                this.leaseExpiresAt =
                    null;

                this.processingStartedAt =
                    null;

                this.nextAttemptAt =
                    null;
            }

            if (
                this.status ===
                STATUS.REVERSED &&
                !this.reversedAt
            ) {
                this.reversedAt =
                    new Date();
            }

            if (
                this.status ===
                STATUS.CANCELLED &&
                !this.cancelledAt
            ) {
                this.cancelledAt =
                    new Date();
            }

            return next();
        } catch (error) {
            return next(error);
        }
    }
);

/**
 * =============================================================================
 * INSTANCE METHODS
 * =============================================================================
 */

referralRewardSchema.methods.isTerminal =
    function isTerminal() {
        return TERMINAL_STATUSES.includes(
            this.status
        );
    };

referralRewardSchema.methods.isProcessable =
    function isProcessable() {
        return (
            WORKER_PROCESSABLE_STATUSES.includes(
                this.status
            ) &&
            this.permanentlyFailed !==
                true &&
            this.deletedAt ===
                null
        );
    };

referralRewardSchema.methods.isLeaseExpired =
    function isLeaseExpired(
        now = new Date()
    ) {
        if (
            this.status !==
            STATUS.PROCESSING
        ) {
            return false;
        }

        if (
            !this.leaseExpiresAt
        ) {
            return true;
        }

        return (
            this.leaseExpiresAt
                .getTime() <=
            normalizeDate(now)
                .getTime()
        );
    };

referralRewardSchema.methods.canRetry =
    function canRetry() {
        if (
            this.isTerminal()
        ) {
            return false;
        }

        if (
            this.permanentlyFailed
        ) {
            return false;
        }

        return (
            this.retryCount <
            this.maxAttempts
        );
    };

referralRewardSchema.methods.getFinancialSummary =
    function getFinancialSummary() {
        return {
            rewardReference:
                this.rewardReference,

            tenantId:
                this.tenantId,

            referralId:
                this.referralId,

            beneficiaryUserId:
                this.beneficiaryUserId,

            rewardType:
                this.rewardType,

            amount:
                decimalToString(
                    this.amount
                ),

            currency:
                this.currency,

            status:
                this.status,

            idempotencyNamespace:
                this.idempotencyNamespace,

            idempotencyKey:
                this.idempotencyKey,

            financialTransactionId:
                this.financialTransactionId,

            ledgerTransactionId:
                this.ledgerTransactionId,

            ledgerReference:
                this.ledgerReference,

            issuanceReference:
                this.issuanceReference,

            externalTransactionReference:
                this.externalTransactionReference,

            externalProvider:
                this.externalProvider,

            issuedAt:
                this.issuedAt,

            reversedAt:
                this.reversedAt
        };
    };

/**
 * General instance transitions are deliberately restricted.
 *
 * PROCESSING and financial finalization should use the static atomic methods
 * because document.save() cannot safely provide distributed worker claims.
 */
referralRewardSchema.methods.transitionTo =
    async function transitionTo(
        nextStatus,
        options = {}
    ) {
        const normalizedStatus =
            normalizeString(
                nextStatus,
                {
                    uppercase:
                        true,

                    maxLength:
                        64
                }
            );

        if (
            !ALL_STATUSES.includes(
                normalizedStatus
            )
        ) {
            throw createReferralRewardError(
                `Invalid referral reward status: ${normalizedStatus}.`,
                'REFERRAL_REWARD_INVALID_STATUS'
            );
        }

        if (
            !isAllowedTransition(
                this.status,
                normalizedStatus
            )
        ) {
            throw createReferralRewardError(
                `Invalid referral reward state transition: ${this.status} -> ${normalizedStatus}.`,
                'REFERRAL_REWARD_INVALID_TRANSITION'
            );
        }

        /**
         * Distributed worker lifecycle must remain atomic.
         */
        if (
            [
                STATUS.PROCESSING,
                STATUS.ISSUED,
                STATUS.RETRYING,
                STATUS.FAILED
            ].includes(
                normalizedStatus
            )
        ) {
            throw createReferralRewardError(
                `Transition to ${normalizedStatus} must use the atomic ReferralReward worker APIs.`,
                'REFERRAL_REWARD_ATOMIC_TRANSITION_REQUIRED'
            );
        }

        const previous =
            this.status;

        this.previousStatus =
            previous;

        this.status =
            normalizedStatus;

        this.statusChangedAt =
            normalizeDate(
                options.now
            );

        return this.save({
            session:
                options.session ||
                null
        });
    };

/**
 * =============================================================================
 * STATIC: CREATE IDEMPOTENT
 * =============================================================================
 *
 * This is the preferred reward creation primitive.
 *
 * It uses tenant-scoped idempotency rather than relying on a read-then-create
 * race.
 * =============================================================================
 */

referralRewardSchema.statics.createIdempotent =
    async function createIdempotent(
        payload,
        options = {}
    ) {
        const tenantId =
            payload?.tenantId;

        assertTenantId(
            tenantId
        );

        assertReferralId(
            payload?.referralId
        );

        assertObjectId(
            payload?.referrerUserId,
            'referrerUserId'
        );

        assertObjectId(
            payload?.beneficiaryUserId,
            'beneficiaryUserId'
        );

        const namespace =
            normalizeString(
                payload
                    .idempotencyNamespace ||
                    IDEMPOTENCY_NAMESPACE,
                {
                    maxLength:
                        128,

                    lowercase:
                        true
                }
            );

        const provisional =
            {
                ...payload,

                idempotencyNamespace:
                    namespace
            };

        const idempotencyKey =
            normalizeString(
                payload
                    .idempotencyKey,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH
                }
            ) ||
            createFallbackIdempotencyKey(
                provisional
            );

        const rewardReference =
            normalizeString(
                payload
                    .rewardReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            ) ||
            createRewardReference();

        const now =
            normalizeDate(
                options.now
            );

        const insertDocument = {
            ...payload,

            tenantId,

            idempotencyNamespace:
                namespace,

            idempotencyKey,

            rewardReference,

            amount:
                normalizeDecimal(
                    payload.amount,
                    {
                        allowZero:
                            false
                    }
                ),

            currency:
                normalizeCurrency(
                    payload.currency
                ),

            countryCode:
                payload.countryCode
                    ? normalizeCountryCode(
                        payload.countryCode
                    )
                    : null,

            rewardType:
                normalizeString(
                    payload.rewardType ||
                    'REFERRAL_REWARD',
                    {
                        uppercase:
                            true,

                        maxLength:
                            64
                    }
                ),

            status:
                payload.status ||
                STATUS.PENDING,

            createdAt:
                now,

            updatedAt:
                now
        };

        try {
            const reward =
                await this.findOneAndUpdate(
                    {
                        tenantId,

                        idempotencyNamespace:
                            namespace,

                        idempotencyKey
                    },
                    {
                        $setOnInsert:
                            insertDocument
                    },
                    {
                        new:
                            true,

                        upsert:
                            true,

                        runValidators:
                            true,

                        setDefaultsOnInsert:
                            true,

                        session:
                            options.session ||
                            null
                    }
                );

            return reward;
        } catch (error) {
            /**
             * Concurrent unique-key race: return the canonical record.
             */
            if (
                error?.code ===
                11000
            ) {
                const existing =
                    await this.findOne({
                        tenantId,

                        idempotencyNamespace:
                            namespace,

                        idempotencyKey
                    }).session(
                        options.session ||
                        null
                    );

                if (existing) {
                    return existing;
                }
            }

            throw error;
        }
    };

/**
 * =============================================================================
 * STATIC: FINDERS
 * =============================================================================
 */

referralRewardSchema.statics.findByIdempotencyKey =
    function findByIdempotencyKey(
        tenantId,
        idempotencyKey,
        namespace =
            IDEMPOTENCY_NAMESPACE
    ) {
        assertTenantId(
            tenantId
        );

        const normalizedKey =
            normalizeString(
                idempotencyKey,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH
                }
            );

        if (!normalizedKey) {
            throw createReferralRewardError(
                'idempotencyKey is required.',
                'REFERRAL_REWARD_IDEMPOTENCY_REQUIRED'
            );
        }

        return this.findOne({
            tenantId,

            idempotencyNamespace:
                normalizeString(
                    namespace,
                    {
                        maxLength:
                            128,

                        lowercase:
                            true
                    }
                ),

            idempotencyKey:
                normalizedKey,

            deletedAt:
                null
        });
    };

referralRewardSchema.statics.findByRewardReference =
    function findByRewardReference(
        tenantId,
        rewardReference
    ) {
        assertTenantId(
            tenantId
        );

        const normalized =
            normalizeString(
                rewardReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            );

        if (!normalized) {
            throw createReferralRewardError(
                'rewardReference is required.',
                'REFERRAL_REWARD_REFERENCE_REQUIRED'
            );
        }

        return this.findOne({
            tenantId,

            rewardReference:
                normalized,

            deletedAt:
                null
        });
    };

referralRewardSchema.statics.findForReferral =
    function findForReferral(
        tenantId,
        referralId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertReferralId(
            referralId
        );

        return this
            .find({
                tenantId,
                referralId,
                deletedAt:
                    null
            })
            .sort({
                createdAt:
                    -1
            })
            .limit(
                normalizeLimit(
                    options.limit,
                    100,
                    500
                )
            )
            .session(
                options.session ||
                null
            );
    };

referralRewardSchema.statics.findRecoverable =
    function findRecoverable(
        tenantId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        const now =
            normalizeDate(
                options.now
            );

        return this
            .find({
                tenantId,

                deletedAt:
                    null,

                status: {
                    $in:
                        RECOVERABLE_STATUSES
                },

                permanentlyFailed: {
                    $ne:
                        true
                },

                $expr: {
                    $lt: [
                        '$retryCount',
                        '$maxAttempts'
                    ]
                },

                $or: [
                    {
                        nextAttemptAt:
                            null
                    },
                    {
                        nextAttemptAt: {
                            $exists:
                                false
                        }
                    },
                    {
                        nextAttemptAt: {
                            $lte:
                                now
                        }
                    }
                ]
            })
            .sort({
                nextAttemptAt:
                    1,

                createdAt:
                    1
            })
            .limit(
                normalizeLimit(
                    options.limit,
                    50,
                    500
                )
            )
            .session(
                options.session ||
                null
            );
    };

referralRewardSchema.statics.findStaleProcessing =
    function findStaleProcessing(
        tenantId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        const now =
            normalizeDate(
                options.now
            );

        const staleBefore =
            new Date(
                now.getTime() -
                PROCESSING_LEASE_MINUTES *
                    60 *
                    1000
            );

        return this
            .find({
                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.PROCESSING,

                $or: [
                    {
                        leaseExpiresAt: {
                            $lte:
                                now
                        }
                    },
                    {
                        leaseExpiresAt:
                            null,

                        processingStartedAt: {
                            $lte:
                                staleBefore
                        }
                    }
                ]
            })
            .sort({
                leaseExpiresAt:
                    1,

                processingStartedAt:
                    1
            })
            .limit(
                normalizeLimit(
                    options.limit,
                    50,
                    500
                )
            )
            .session(
                options.session ||
                null
            );
    };

/**
 * =============================================================================
 * STATIC: ATOMIC CLAIM
 * =============================================================================
 */

referralRewardSchema.statics.claimForProcessing =
    async function claimForProcessing(
        tenantId,
        rewardId,
        workerId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const normalizedWorkerId =
            normalizeWorkerId(
                workerId
            );

        const now =
            normalizeDate(
                options.now
            );

        const leaseExpiresAt =
            buildLeaseExpiry(
                now,
                options.leaseMinutes
            );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status: {
                    $in:
                        WORKER_PROCESSABLE_STATUSES
                },

                fraudReviewRequired: {
                    $ne:
                        true
                },

                permanentlyFailed: {
                    $ne:
                        true
                },

                $expr: {
                    $lt: [
                        '$retryCount',
                        '$maxAttempts'
                    ]
                },

                $or: [
                    {
                        nextAttemptAt:
                            null
                    },
                    {
                        nextAttemptAt: {
                            $exists:
                                false
                        }
                    },
                    {
                        nextAttemptAt: {
                            $lte:
                                now
                        }
                    }
                ]
            },
            [
                {
                    $set: {
                        previousStatus:
                            '$status',

                        status:
                            STATUS.PROCESSING,

                        processingStartedAt:
                            now,

                        leaseExpiresAt,

                        workerId:
                            normalizedWorkerId,

                        statusChangedAt:
                            now,

                        nextAttemptAt:
                            null,

                        updatedAt:
                            now,

                        processingAttempts: {
                            $add: [
                                {
                                    $ifNull: [
                                        '$processingAttempts',
                                        0
                                    ]
                                },
                                1
                            ]
                        },

                        attempts: {
                            $add: [
                                {
                                    $ifNull: [
                                        '$attempts',
                                        0
                                    ]
                                },
                                1
                            ]
                        }
                    }
                }
            ],
            {
                new:
                    true,

                returnDocument:
                    'after',

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: RENEW LEASE
 * =============================================================================
 */

referralRewardSchema.statics.renewProcessingLease =
    async function renewProcessingLease(
        tenantId,
        rewardId,
        workerId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const normalizedWorkerId =
            normalizeWorkerId(
                workerId
            );

        const now =
            normalizeDate(
                options.now
            );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.PROCESSING,

                workerId:
                    normalizedWorkerId,

                leaseExpiresAt: {
                    $gt:
                        now
                }
            },
            {
                $set: {
                    leaseExpiresAt:
                        buildLeaseExpiry(
                            now,
                            options.leaseMinutes
                        ),

                    updatedAt:
                        now
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: RECOVER STALE PROCESSING
 * =============================================================================
 *
 * IMPORTANT:
 * retryCount is incremented ONCE.
 *
 * After the first pipeline stage increments retryCount, subsequent stages
 * evaluate the already-incremented value. This avoids the off-by-one/double
 * increment exhaustion calculation found in many naive aggregation pipelines.
 * =============================================================================
 */

referralRewardSchema.statics.recoverStaleProcessing =
    async function recoverStaleProcessing(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const staleBefore =
            new Date(
                now.getTime() -
                PROCESSING_LEASE_MINUTES *
                    60 *
                    1000
            );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.PROCESSING,

                $or: [
                    {
                        leaseExpiresAt: {
                            $lte:
                                now
                        }
                    },
                    {
                        leaseExpiresAt:
                            null,

                        processingStartedAt: {
                            $lte:
                                staleBefore
                        }
                    }
                ]
            },
            [
                {
                    $set: {
                        previousStatus:
                            '$status',

                        recoveryCount: {
                            $add: [
                                {
                                    $ifNull: [
                                        '$recoveryCount',
                                        0
                                    ]
                                },
                                1
                            ]
                        },

                        retryCount: {
                            $add: [
                                {
                                    $ifNull: [
                                        '$retryCount',
                                        0
                                    ]
                                },
                                1
                            ]
                        },

                        recoveryRequired:
                            true,

                        recoveryReconciled:
                            false,

                        recoveryReason:
                            'stale_processing_lease',

                        workerId:
                            null,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        lastFailedAt:
                            now,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now
                    }
                },
                {
                    $set: {
                        permanentlyFailed: {
                            $gte: [
                                '$retryCount',
                                '$maxAttempts'
                            ]
                        },

                        status: {
                            $cond: [
                                {
                                    $gte: [
                                        '$retryCount',
                                        '$maxAttempts'
                                    ]
                                },

                                STATUS.FAILED,

                                STATUS.RETRYING
                            ]
                        },

                        nextAttemptAt: {
                            $cond: [
                                {
                                    $gte: [
                                        '$retryCount',
                                        '$maxAttempts'
                                    ]
                                },

                                null,

                                now
                            ]
                        },

                        permanentFailureCount: {
                            $cond: [
                                {
                                    $gte: [
                                        '$retryCount',
                                        '$maxAttempts'
                                    ]
                                },

                                {
                                    $add: [
                                        {
                                            $ifNull: [
                                                '$permanentFailureCount',
                                                0
                                            ]
                                        },
                                        1
                                    ]
                                },

                                {
                                    $ifNull: [
                                        '$permanentFailureCount',
                                        0
                                    ]
                                }
                            ]
                        }
                    }
                }
            ],
            {
                new:
                    true,

                returnDocument:
                    'after',

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: MARK ISSUED
 * =============================================================================
 *
 * A live lease owner is required.
 *
 * If the reward was already issued, this method behaves idempotently.
 * =============================================================================
 */

referralRewardSchema.statics.markIssued =
    async function markIssued(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const workerId =
            normalizeWorkerId(
                options.workerId
            );

        const issuanceReference =
            normalizeString(
                options.issuanceReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            ) ||
            null;

        const ledgerReference =
            normalizeString(
                options.ledgerReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            ) ||
            null;

        const externalReference =
            normalizeString(
                options
                    .externalTransactionReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH
                }
            ) ||
            null;

        const externalProvider =
            normalizeString(
                options.externalProvider,
                {
                    maxLength:
                        64,

                    uppercase:
                        true
                }
            ) ||
            null;

        const financialTransactionId =
            options
                .financialTransactionId ||
            null;

        const ledgerTransactionId =
            options
                .ledgerTransactionId ||
            null;

        const hasEvidence =
            Boolean(
                issuanceReference ||
                financialTransactionId ||
                ledgerTransactionId ||
                ledgerReference ||
                externalReference
            );

        if (!hasEvidence) {
            throw createReferralRewardError(
                'Referral reward issuance requires authoritative financial or issuance evidence.',
                'REFERRAL_REWARD_ISSUANCE_EVIDENCE_REQUIRED'
            );
        }

        const updated =
            await this.findOneAndUpdate(
                {
                    _id:
                        rewardId,

                    tenantId,

                    deletedAt:
                        null,

                    status:
                        STATUS.PROCESSING,

                    workerId,

                    leaseExpiresAt: {
                        $gt:
                            now
                    }
                },
                {
                    $set: {
                        previousStatus:
                            STATUS.PROCESSING,

                        status:
                            STATUS.ISSUED,

                        issuedAt:
                            normalizeDate(
                                options.issuedAt,
                                now
                            ),

                        issuedBy:
                            options.issuedBy ||
                            null,

                        issuanceReference,

                        financialTransactionId,

                        ledgerTransactionId,

                        ledgerReference,

                        externalTransactionReference:
                            externalReference,

                        externalProvider,

                        workerId:
                            null,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        nextAttemptAt:
                            null,

                        recoveryRequired:
                            false,

                        recoveryReconciled:
                            options
                                .recoveryReconciled ===
                                true,

                        lastErrorCode:
                            null,

                        lastErrorMessage:
                            null,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now
                    }
                },
                {
                    new:
                        true,

                    runValidators:
                        true,

                    session:
                        options.session ||
                        null
                }
            );

        if (updated) {
            return updated;
        }

        /**
         * Idempotent retry after network timeout.
         */
        return this.findOne({
            _id:
                rewardId,

            tenantId,

            deletedAt:
                null,

            status:
                STATUS.ISSUED
        }).session(
            options.session ||
            null
        );
    };

/**
 * =============================================================================
 * STATIC: MARK RETRY
 * =============================================================================
 */

referralRewardSchema.statics.markRetry =
    async function markRetry(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const workerId =
            normalizeWorkerId(
                options.workerId
            );

        const nextAttemptAt =
            options.nextAttemptAt
                ? normalizeDate(
                    options.nextAttemptAt
                )
                : new Date(
                    now.getTime() +
                    60 *
                        1000
                );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.PROCESSING,

                workerId,

                leaseExpiresAt: {
                    $gt:
                        now
                },

                permanentlyFailed: {
                    $ne:
                        true
                }
            },
            [
                {
                    $set: {
                        previousStatus:
                            '$status',

                        retryCount: {
                            $add: [
                                {
                                    $ifNull: [
                                        '$retryCount',
                                        0
                                    ]
                                },
                                1
                            ]
                        },

                        lastErrorCode:
                            normalizeString(
                                options.errorCode,
                                {
                                    maxLength:
                                        MAX_ERROR_CODE_LENGTH,

                                    uppercase:
                                        true
                                }
                            ) ||
                            'REWARD_PROCESSING_FAILED',

                        lastErrorMessage:
                            normalizeString(
                                options.errorMessage,
                                {
                                    maxLength:
                                        MAX_ERROR_MESSAGE_LENGTH
                                }
                            ) ||
                            'Referral reward processing failed.',

                        lastFailedAt:
                            now,

                        workerId:
                            null,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now
                    }
                },
                {
                    $set: {
                        permanentlyFailed: {
                            $gte: [
                                '$retryCount',
                                '$maxAttempts'
                            ]
                        },

                        status: {
                            $cond: [
                                {
                                    $gte: [
                                        '$retryCount',
                                        '$maxAttempts'
                                    ]
                                },

                                STATUS.FAILED,

                                STATUS.RETRYING
                            ]
                        },

                        nextAttemptAt: {
                            $cond: [
                                {
                                    $gte: [
                                        '$retryCount',
                                        '$maxAttempts'
                                    ]
                                },

                                null,

                                nextAttemptAt
                            ]
                        },

                        permanentFailureCount: {
                            $cond: [
                                {
                                    $gte: [
                                        '$retryCount',
                                        '$maxAttempts'
                                    ]
                                },

                                {
                                    $add: [
                                        {
                                            $ifNull: [
                                                '$permanentFailureCount',
                                                0
                                            ]
                                        },
                                        1
                                    ]
                                },

                                {
                                    $ifNull: [
                                        '$permanentFailureCount',
                                        0
                                    ]
                                }
                            ]
                        }
                    }
                }
            ],
            {
                new:
                    true,

                returnDocument:
                    'after',

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: PERMANENT FAILURE
 * =============================================================================
 */

referralRewardSchema.statics.markPermanentFailure =
    async function markPermanentFailure(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const workerId =
            normalizeWorkerId(
                options.workerId
            );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.PROCESSING,

                workerId,

                leaseExpiresAt: {
                    $gt:
                        now
                }
            },
            {
                $set: {
                    previousStatus:
                        STATUS.PROCESSING,

                    status:
                        STATUS.FAILED,

                    permanentlyFailed:
                        true,

                    nextAttemptAt:
                        null,

                    workerId:
                        null,

                    leaseExpiresAt:
                        null,

                    processingStartedAt:
                        null,

                    lastErrorCode:
                        normalizeString(
                            options.errorCode,
                            {
                                maxLength:
                                    MAX_ERROR_CODE_LENGTH,

                                uppercase:
                                    true
                            }
                        ) ||
                        'PERMANENT_REWARD_FAILURE',

                    lastErrorMessage:
                        normalizeString(
                            options.errorMessage,
                            {
                                maxLength:
                                    MAX_ERROR_MESSAGE_LENGTH
                            }
                        ) ||
                        'Referral reward permanently failed.',

                    lastFailedAt:
                        now,

                    statusChangedAt:
                        now,

                    updatedAt:
                        now
                },

                $inc: {
                    permanentFailureCount:
                        1
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: FRAUD REVIEW
 * =============================================================================
 */

referralRewardSchema.statics.moveToFraudReview =
    async function moveToFraudReview(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const allowedStatuses = [
            STATUS.PENDING,
            STATUS.ELIGIBLE,
            STATUS.PROCESSING,
            STATUS.RETRYING,
            STATUS.FAILED
        ];

        const predicate = {
            _id:
                rewardId,

            tenantId,

            deletedAt:
                null,

            status: {
                $in:
                    allowedStatuses
            }
        };

        /**
         * If the reward is currently PROCESSING, only the live owner can move
         * it to fraud review unless an explicitly privileged recovery workflow
         * uses reconciliation outside this worker method.
         */
        if (
            options.workerId
        ) {
            predicate.$or = [
                {
                    status: {
                        $ne:
                            STATUS.PROCESSING
                    }
                },
                {
                    status:
                        STATUS.PROCESSING,

                    workerId:
                        normalizeWorkerId(
                            options.workerId
                        ),

                    leaseExpiresAt: {
                        $gt:
                            now
                    }
                }
            ];
        } else {
            /**
             * An unleased administrative request cannot steal a currently
             * processing reward.
             */
            predicate.status = {
                $in: [
                    STATUS.PENDING,
                    STATUS.ELIGIBLE,
                    STATUS.RETRYING,
                    STATUS.FAILED
                ]
            };
        }

        return this.findOneAndUpdate(
            predicate,
            {
                $set: {
                    previousStatus:
                        null,

                    status:
                        STATUS.FRAUD_REVIEW,

                    fraudReviewRequired:
                        true,

                    fraudReviewReason:
                        normalizeString(
                            options.reason,
                            {
                                maxLength:
                                    MAX_REASON_LENGTH
                            }
                        ) ||
                        'Manual fraud review required.',

                    fraudReviewAt:
                        now,

                    fraudCaseId:
                        options.fraudCaseId ||
                        null,

                    riskScore:
                        options.riskScore !==
                        undefined
                            ? options.riskScore
                            : null,

                    workerId:
                        null,

                    leaseExpiresAt:
                        null,

                    processingStartedAt:
                        null,

                    nextAttemptAt:
                        null,

                    statusChangedAt:
                        now,

                    updatedAt:
                        now
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: RELEASE FRAUD REVIEW
 * =============================================================================
 */

referralRewardSchema.statics.releaseFraudReview =
    async function releaseFraudReview(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.FRAUD_REVIEW,

                fraudReviewRequired:
                    true
            },
            {
                $set: {
                    previousStatus:
                        STATUS.FRAUD_REVIEW,

                    status:
                        STATUS.ELIGIBLE,

                    eligibleAt:
                        options.eligibleAt ||
                        now,

                    fraudReviewRequired:
                        false,

                    fraudReviewReason:
                        null,

                    nextAttemptAt:
                        now,

                    statusChangedAt:
                        now,

                    updatedAt:
                        now
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: RECONCILE AUTHORITATIVELY ISSUED REWARD
 * =============================================================================
 */

referralRewardSchema.statics.reconcileIssued =
    async function reconcileIssued(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const issuanceReference =
            normalizeString(
                options.issuanceReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            ) ||
            null;

        const ledgerReference =
            normalizeString(
                options.ledgerReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            ) ||
            null;

        const externalReference =
            normalizeString(
                options
                    .externalTransactionReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH
                }
            ) ||
            null;

        const financialTransactionId =
            options
                .financialTransactionId ||
            null;

        const ledgerTransactionId =
            options
                .ledgerTransactionId ||
            null;

        if (
            !financialTransactionId &&
            !ledgerTransactionId &&
            !issuanceReference &&
            !ledgerReference &&
            !externalReference
        ) {
            throw createReferralRewardError(
                'Authoritative financial evidence is required to reconcile a referral reward.',
                'REFERRAL_REWARD_RECONCILIATION_EVIDENCE_REQUIRED'
            );
        }

        const updated =
            await this.findOneAndUpdate(
                {
                    _id:
                        rewardId,

                    tenantId,

                    deletedAt:
                        null,

                    status: {
                        $in: [
                            STATUS.PROCESSING,
                            STATUS.RETRYING,
                            STATUS.FAILED,
                            STATUS.FRAUD_REVIEW
                        ]
                    }
                },
                {
                    $set: {
                        previousStatus:
                            null,

                        status:
                            STATUS.ISSUED,

                        issuedAt:
                            options.issuedAt ||
                            now,

                        issuedBy:
                            options.issuedBy ||
                            null,

                        issuanceReference,

                        financialTransactionId,

                        ledgerTransactionId,

                        ledgerReference,

                        externalTransactionReference:
                            externalReference,

                        externalProvider:
                            normalizeString(
                                options.externalProvider,
                                {
                                    maxLength:
                                        64,

                                    uppercase:
                                        true
                                }
                            ) ||
                            null,

                        recoveryRequired:
                            false,

                        recoveryReconciled:
                            true,

                        recoveryReason:
                            'financial_issuance_reconciled',

                        fraudReviewRequired:
                            false,

                        workerId:
                            null,

                        leaseExpiresAt:
                            null,

                        processingStartedAt:
                            null,

                        nextAttemptAt:
                            null,

                        lastErrorCode:
                            null,

                        lastErrorMessage:
                            null,

                        statusChangedAt:
                            now,

                        updatedAt:
                            now
                    },

                    $inc: {
                        recoverySuccessCount:
                            1
                    }
                },
                {
                    new:
                        true,

                    runValidators:
                        true,

                    session:
                        options.session ||
                        null
                }
            );

        if (updated) {
            return updated;
        }

        /**
         * Idempotent reconciliation.
         */
        return this.findOne({
            _id:
                rewardId,

            tenantId,

            deletedAt:
                null,

            status:
                STATUS.ISSUED
        }).session(
            options.session ||
            null
        );
    };

/**
 * =============================================================================
 * STATIC: REVERSE
 * =============================================================================
 *
 * This method records the reward-state transition only.
 *
 * It MUST be called only after the corresponding authoritative financial
 * reversal has been created by the financial/ledger service.
 * =============================================================================
 */

referralRewardSchema.statics.markReversed =
    async function markReversed(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        const reversalReference =
            normalizeString(
                options.reversalReference,
                {
                    maxLength:
                        MAX_EXTERNAL_REFERENCE_LENGTH,

                    uppercase:
                        true
                }
            );

        if (!reversalReference) {
            throw createReferralRewardError(
                'reversalReference is required when reversing a referral reward.',
                'REFERRAL_REWARD_REVERSAL_REFERENCE_REQUIRED'
            );
        }

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status:
                    STATUS.ISSUED
            },
            {
                $set: {
                    previousStatus:
                        STATUS.ISSUED,

                    status:
                        STATUS.REVERSED,

                    reversedAt:
                        options.reversedAt ||
                        now,

                    reversalReference,

                    reversalReason:
                        normalizeString(
                            options.reason,
                            {
                                maxLength:
                                    MAX_REASON_LENGTH
                            }
                        ) ||
                        'Referral reward reversed.',

                    statusChangedAt:
                        now,

                    updatedAt:
                        now
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: CANCEL
 * =============================================================================
 */

referralRewardSchema.statics.cancel =
    async function cancel(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const now =
            normalizeDate(
                options.now
            );

        /**
         * PROCESSING is deliberately excluded.
         *
         * A live financial operation must not be cancelled from underneath a
         * worker. Allow the worker to finish/fail or recover the stale lease.
         */
        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                status: {
                    $in: [
                        STATUS.PENDING,
                        STATUS.ELIGIBLE,
                        STATUS.RETRYING,
                        STATUS.FAILED,
                        STATUS.FRAUD_REVIEW
                    ]
                }
            },
            {
                $set: {
                    previousStatus:
                        null,

                    status:
                        STATUS.CANCELLED,

                    cancellationReason:
                        normalizeString(
                            options.reason,
                            {
                                maxLength:
                                    MAX_REASON_LENGTH
                            }
                        ) ||
                        'Referral reward cancelled.',

                    cancelledAt:
                        options.cancelledAt ||
                        now,

                    cancelledBy:
                        options.cancelledBy ||
                        null,

                    workerId:
                        null,

                    leaseExpiresAt:
                        null,

                    processingStartedAt:
                        null,

                    nextAttemptAt:
                        null,

                    statusChangedAt:
                        now,

                    updatedAt:
                        now
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: SOFT DELETE
 * =============================================================================
 *
 * ReferralReward records are financial/audit-sensitive.
 *
 * Issued/reversed records are intentionally excluded from soft deletion.
 * Legal-hold records can never be soft deleted.
 * =============================================================================
 */

referralRewardSchema.statics.softDelete =
    async function softDelete(
        tenantId,
        rewardId,
        deletedBy,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        if (
            deletedBy
        ) {
            assertObjectId(
                deletedBy,
                'deletedBy'
            );
        }

        const now =
            normalizeDate(
                options.now
            );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                deletedAt:
                    null,

                legalHold: {
                    $ne:
                        true
                },

                status: {
                    $in: [
                        STATUS.PENDING,
                        STATUS.ELIGIBLE,
                        STATUS.FAILED,
                        STATUS.CANCELLED,
                        STATUS.FRAUD_REVIEW
                    ]
                }
            },
            {
                $set: {
                    deletedAt:
                        now,

                    deletedBy:
                        deletedBy ||
                        null,

                    deletionReason:
                        normalizeString(
                            options.reason,
                            {
                                maxLength:
                                    MAX_REASON_LENGTH
                            }
                        ) ||
                        'Referral reward administratively soft deleted.',

                    updatedAt:
                        now
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * STATIC: LEGAL HOLD
 * =============================================================================
 */

referralRewardSchema.statics.placeLegalHold =
    async function placeLegalHold(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        const reason =
            normalizeString(
                options.reason,
                {
                    maxLength:
                        MAX_REASON_LENGTH
                }
            );

        if (!reason) {
            throw createReferralRewardError(
                'reason is required when placing a referral reward on legal hold.',
                'REFERRAL_REWARD_LEGAL_HOLD_REASON_REQUIRED'
            );
        }

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId
            },
            {
                $set: {
                    legalHold:
                        true,

                    legalHoldReason:
                        reason,

                    legalHoldAt:
                        normalizeDate(
                            options.now
                        ),

                    legalHoldBy:
                        options.actorId ||
                        null
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

referralRewardSchema.statics.releaseLegalHold =
    async function releaseLegalHold(
        tenantId,
        rewardId,
        options = {}
    ) {
        assertTenantId(
            tenantId
        );

        assertRewardId(
            rewardId
        );

        return this.findOneAndUpdate(
            {
                _id:
                    rewardId,

                tenantId,

                legalHold:
                    true
            },
            {
                $set: {
                    legalHold:
                        false,

                    legalHoldReason:
                        null,

                    legalHoldAt:
                        null,

                    legalHoldBy:
                        null,

                    updatedAt:
                        normalizeDate(
                            options.now
                        )
                }
            },
            {
                new:
                    true,

                runValidators:
                    true,

                session:
                    options.session ||
                    null
            }
        );
    };

/**
 * =============================================================================
 * PHYSICAL DELETE PROTECTION
 * =============================================================================
 *
 * This protects normal Mongoose deletion paths.
 *
 * Direct collection/database administration remains outside model middleware
 * and therefore must be governed by operational database permissions.
 * =============================================================================
 */

function physicalDeleteError() {
    return createReferralRewardError(
        `${SERVICE_NAME}: physical deletion of referral reward records is prohibited.`,
        'REFERRAL_REWARD_PHYSICAL_DELETE_PROHIBITED'
    );
}

referralRewardSchema.pre(
    'deleteOne',
    function preventDeleteOne(
        next
    ) {
        return next(
            physicalDeleteError()
        );
    }
);

referralRewardSchema.pre(
    'deleteMany',
    function preventDeleteMany(
        next
    ) {
        return next(
            physicalDeleteError()
        );
    }
);

referralRewardSchema.pre(
    'findOneAndDelete',
    function preventFindOneAndDelete(
        next
    ) {
        return next(
            physicalDeleteError()
        );
    }
);

referralRewardSchema.pre(
    'findOneAndRemove',
    function preventFindOneAndRemove(
        next
    ) {
        return next(
            physicalDeleteError()
        );
    }
);

/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

referralRewardSchema.query.active =
    function active() {
        return this.where({
            deletedAt:
                null
        });
    };

referralRewardSchema.query.forTenant =
    function forTenant(
        tenantId
    ) {
        assertTenantId(
            tenantId
        );

        return this.where({
            tenantId
        });
    };

referralRewardSchema.query.forReferral =
    function forReferral(
        referralId
    ) {
        assertReferralId(
            referralId
        );

        return this.where({
            referralId
        });
    };

referralRewardSchema.query.issued =
    function issued() {
        return this.where({
            deletedAt:
                null,

            status:
                STATUS.ISSUED
        });
    };

referralRewardSchema.query.processing =
    function processing() {
        return this.where({
            deletedAt:
                null,

            status:
                STATUS.PROCESSING
        });
    };

referralRewardSchema.query.pendingRecovery =
    function pendingRecovery() {
        return this.where({
            deletedAt:
                null,

            status: {
                $in:
                    RECOVERABLE_STATUSES
            },

            permanentlyFailed: {
                $ne:
                    true
            },

            $expr: {
                $lt: [
                    '$retryCount',
                    '$maxAttempts'
                ]
            }
        });
    };

referralRewardSchema.query.fraudReview =
    function fraudReview() {
        return this.where({
            deletedAt:
                null,

            status:
                STATUS.FRAUD_REVIEW,

            fraudReviewRequired:
                true
        });
    };

/**
 * =============================================================================
 * MODEL REGISTRATION
 * =============================================================================
 */

const ReferralReward =
    mongoose.models[
        MODEL_NAME
    ] ||
    mongoose.model(
        MODEL_NAME,
        referralRewardSchema
    );

/**
 * =============================================================================
 * PRIMARY EXPORT
 * =============================================================================
 */

module.exports =
    ReferralReward;

/**
 * =============================================================================
 * COMPATIBILITY / TEST EXPORTS
 * =============================================================================
 */

module.exports.STATUS =
    STATUS;

module.exports.ALL_STATUSES =
    ALL_STATUSES;

module.exports.TERMINAL_STATUSES =
    TERMINAL_STATUSES;

module.exports.PROCESSABLE_STATUSES =
    WORKER_PROCESSABLE_STATUSES;

module.exports.RECOVERABLE_STATUSES =
    RECOVERABLE_STATUSES;

module.exports.IDEMPOTENCY_NAMESPACE =
    IDEMPOTENCY_NAMESPACE;

module.exports.MODEL_VERSION =
    MODEL_VERSION;

module.exports.MAX_RETRY_ATTEMPTS =
    MAX_RETRY_ATTEMPTS;

module.exports.PROCESSING_LEASE_MINUTES =
    PROCESSING_LEASE_MINUTES;

module.exports.normalizeDecimal =
    normalizeDecimal;

module.exports.decimalToString =
    decimalToString;

module.exports.createRewardReference =
    createRewardReference;

module.exports.createFallbackIdempotencyKey =
    createFallbackIdempotencyKey;

module.exports.isAllowedTransition =
    isAllowedTransition;