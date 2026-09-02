'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Stage 01C — Canonical SaaS Billing Consolidation / Backfill
 * =============================================================================
 *
 * File:
 *   backend/migrations/20260830_120000_consolidate_titech_saas_billing.js
 *
 * Purpose:
 *   Safely consolidate legacy TITech SaaS/tenant billing data into the
 *   canonical Commercial Billing collections.
 *
 * Safety contract:
 *   - ADDITIVE
 *   - RERUNNABLE
 *   - DETERMINISTIC
 *   - DUPLICATE-AWARE
 *   - TENANT-AWARE
 *   - LEGACY-PRESERVING
 *   - NON-DESTRUCTIVE
 *   - NO WALLET MUTATION
 *   - NO LEDGER MUTATION
 *   - NO FINANCIAL TRANSACTION MUTATION
 *   - NO PAYMENT SETTLEMENT
 *   - NO CUSTOMER BALANCE MODIFICATION
 *
 * IMPORTANT:
 *   This migration owns source discovery, normalization, canonical upserts,
 *   relationship validation, locking, migration state and reconciliation.
 *
 * =============================================================================
 */

const mongooseDefault = require('mongoose');

const MIGRATION_NAME =
    '20260830_120000_consolidate_titech_saas_billing';

const MIGRATION_STAGE = '01C';

const MIGRATION_SOURCE = 'legacy';

const SOURCE_CATEGORIES = Object.freeze([
    'plans',
    'subscriptions',
    'invoices',
    'usage',
]);

const DEFAULTS = Object.freeze({
    plans: Object.freeze([
        'billingplans',
        'billing_plans',
        'tenantbillingplans',
        'billingPlans',
        'tenantBillingPlans',
        'saasplans',
        'saas_plans',
        'titechbillingplans',
    ]),

    subscriptions: Object.freeze([
        'tenantsubscriptions',
        'tenant_subscriptions',
        'subscriptions',
        'tenantSubscriptions',
        'saas_subscriptions',
        'saasSubscriptions',
        'billing_subscriptions',
    ]),

    invoices: Object.freeze([
        'invoices',
        'billinginvoices',
        'billing_invoices',
        'tenantinvoices',
        'tenantInvoices',
        'saas_invoices',
        'saasInvoices',
    ]),

    usage: Object.freeze([
        'usagerecords',
        'usage_records',
        'usageRecords',
        'meterusage',
        'meter_usage',
        'billing_usage',
        'billingUsage',
        'saas_usage',
    ]),

    batchSize: 500,

    maxRecordErrors: 25,

    lockLeaseMs:
        15 * 60 * 1000,

    sourceDiscoverySampleSize: 1,

    maxSourceDiscoveryMatches: 10,
});

const CANONICAL = Object.freeze({
    plans:
        'titech_billing_plans',

    subscriptions:
        'titech_subscriptions',

    invoices:
        'titech_billing_invoices',

    usage:
        'titech_usage_records',

    migrationState:
        'titech_billing_migration_state',
});

const CANONICAL_COLLECTIONS =
    new Set(
        Object.values(CANONICAL)
    );

const SOURCE_ENVIRONMENT_VARIABLES = Object.freeze({
    plans:
        'TITECH_LEGACY_BILLING_PLANS_COLLECTION',

    subscriptions:
        'TITECH_LEGACY_SUBSCRIPTIONS_COLLECTION',

    invoices:
        'TITECH_LEGACY_INVOICES_COLLECTION',

    usage:
        'TITECH_LEGACY_USAGE_COLLECTION',
});

const SOURCE_NAME_PATTERNS = Object.freeze({
    plans:
        Object.freeze([
            /\bplan(s)?\b/i,
            /\bbilling.?plan(s)?\b/i,
            /\bsaas.?plan(s)?\b/i,
            /\btier(s)?\b/i,
        ]),

    subscriptions:
        Object.freeze([
            /\bsubscription(s)?\b/i,
            /\bsubscriber(s)?\b/i,
            /\btenant.?subscription(s)?\b/i,
            /\bsaas.?subscription(s)?\b/i,
        ]),

    invoices:
        Object.freeze([
            /\binvoice(s)?\b/i,
            /\bbilling.?invoice(s)?\b/i,
            /\btenant.?invoice(s)?\b/i,
            /\bsaas.?invoice(s)?\b/i,
        ]),

    usage:
        Object.freeze([
            /\busage\b/i,
            /\busagerecord(s)?\b/i,
            /\bmeter.?usage\b/i,
            /\busage.?record(s)?\b/i,
            /\bbilling.?usage\b/i,
            /\bsaas.?usage\b/i,
        ]),
});

const SOURCE_FIELD_PATTERNS = Object.freeze({
    plans:
        Object.freeze([
            'code',
            'planCode',
            'name',
            'tier',
            'price',
            'prices',
            'billingCycle',
            'interval',
            'trialDays',
        ]),

    subscriptions:
        Object.freeze([
            'tenantId',
            'planId',
            'planCode',
            'status',
            'billingInterval',
            'billingCycle',
            'currentPeriodStart',
            'currentPeriodEnd',
        ]),

    invoices:
        Object.freeze([
            'tenantId',
            'invoiceNumber',
            'subscriptionId',
            'total',
            'amount',
            'amountDue',
            'amountPaid',
            'status',
            'dueDate',
        ]),

    usage:
        Object.freeze([
            'tenantId',
            'meterCode',
            'meterType',
            'quantity',
            'periodStart',
            'periodEnd',
            'sourceReference',
        ]),
});

const SAFE_COLLECTION_NAME =
    /^[A-Za-z0-9_.$-]{1,120}$/;

const INDEXES = Object.freeze({
    plans:
        Object.freeze([
            {
                name:
                    'uniq_titech_billing_plan_code_version',

                key:
                    {
                        code:
                            1,

                        version:
                            1,
                    },

                options:
                    {
                        unique:
                            true,
                    },
            },

            {
                name:
                    'idx_titech_billing_plan_tier_active_public_effective',

                key:
                    {
                        tier:
                            1,

                        isActive:
                            1,

                        isPublic:
                            1,

                        effectiveFrom:
                            -1,
                    },

                options:
                    {},
            },
        ]),

    subscriptions:
        Object.freeze([
            {
                name:
                    'uniq_titech_subscription_tenant_idempotency',

                key:
                    {
                        tenantId:
                            1,

                        idempotencyKey:
                            1,
                    },

                options:
                    {
                        unique:
                            true,

                        partialFilterExpression:
                            {
                                idempotencyKey:
                                    {
                                        $type:
                                            'string',
                                    },
                            },
                    },
            },

            {
                name:
                    'idx_titech_subscription_tenant_status_period_end',

                key:
                    {
                        tenantId:
                            1,

                        status:
                            1,

                        currentPeriodEnd:
                            1,
                    },

                options:
                    {},
            },
        ]),

    invoices:
        Object.freeze([
            {
                name:
                    'uniq_titech_billing_invoice_generation_key',

                key:
                    {
                        generationKey:
                            1,
                    },

                options:
                    {
                        unique:
                            true,
                    },
            },

            {
                name:
                    'uniq_titech_billing_invoice_tenant_idempotency',

                key:
                    {
                        tenantId:
                            1,

                        idempotencyKey:
                            1,
                    },

                options:
                    {
                        unique:
                            true,

                        partialFilterExpression:
                            {
                                idempotencyKey:
                                    {
                                        $type:
                                            'string',
                                    },
                            },
                    },
            },

            {
                name:
                    'idx_titech_billing_invoice_tenant_status_due',

                key:
                    {
                        tenantId:
                            1,

                        status:
                            1,

                        dueDate:
                            1,
                    },

                options:
                    {},
            },
        ]),

    usage:
        Object.freeze([
            {
                name:
                    'idx_titech_usage_tenant_meter_period',

                key:
                    {
                        tenantId:
                            1,

                        meterCode:
                            1,

                        periodStart:
                            1,

                        periodEnd:
                            1,
                    },

                options:
                    {},
            },

            {
                name:
                    'idx_titech_usage_source_reference',

                key:
                    {
                        source:
                            1,

                        sourceReference:
                            1,
                    },

                options:
                    {
                        sparse:
                            true,
                    },
            },
        ]),
});

/**
 * =============================================================================
 * Domain maps
 * =============================================================================
 */

const BILLING_INTERVAL_MAP = Object.freeze({
    MONTH:
        'MONTHLY',

    MONTHLY:
        'MONTHLY',

    QUARTER:
        'QUARTERLY',

    QUARTERLY:
        'QUARTERLY',

    YEAR:
        'ANNUAL',

    YEARLY:
        'ANNUAL',

    ANNUAL:
        'ANNUAL',
});

const SUBSCRIPTION_STATUS_MAP = Object.freeze({
    trial:
        'TRIALING',

    trialing:
        'TRIALING',

    active:
        'ACTIVE',

    past_due:
        'PAST_DUE',

    'past-due':
        'PAST_DUE',

    grace:
        'GRACE',

    suspended:
        'SUSPENDED',

    cancelled:
        'CANCELLED',

    canceled:
        'CANCELLED',

    expired:
        'EXPIRED',
});

const INVOICE_STATUS_MAP = Object.freeze({
    draft:
        'DRAFT',

    pending:
        'PENDING',

    open:
        'PENDING',

    processing:
        'PROCESSING',

    paid:
        'PAID',

    partially_paid:
        'PARTIALLY_PAID',

    'partially-paid':
        'PARTIALLY_PAID',

    past_due:
        'PAST_DUE',

    'past-due':
        'PAST_DUE',

    failed:
        'FAILED',

    void:
        'VOID',

    uncollectible:
        'UNCOLLECTIBLE',

    refunded:
        'REFUNDED',
});

const SUPPORTED_CURRENCIES =
    new Set([
        'UGX',
        'USD',
        'KES',
        'TZS',
        'RWF',
        'NGN',
        'ZAR',
    ]);

const SUPPORTED_SUBSCRIPTION_STATUSES =
    new Set([
        'TRIALING',
        'ACTIVE',
        'PAST_DUE',
        'GRACE',
        'SUSPENDED',
        'CANCELLED',
        'EXPIRED',
    ]);

const SUPPORTED_INVOICE_STATUSES =
    new Set([
        'DRAFT',
        'PENDING',
        'PROCESSING',
        'PAID',
        'PARTIALLY_PAID',
        'PAST_DUE',
        'FAILED',
        'VOID',
        'UNCOLLECTIBLE',
        'REFUNDED',
    ]);

const SUPPORTED_METER_TYPES =
    new Set([
        'MEMBER',
        'GROUP',
        'LOAN',
        'TRANSACTION',
        'API_CALL',
        'STORAGE',
        'CUSTOM',
    ]);

/**
 * =============================================================================
 * Environment helpers
 * =============================================================================
 */

function envBoolean(
    name,
    fallback = false
) {
    const value =
        String(
            process.env[name] ?? ''
        )
            .trim()
            .toLowerCase();

    if (!value) {
        return fallback;
    }

    return [
        '1',
        'true',
        'yes',
        'on',
    ].includes(value);
}

function envPositiveInteger(
    name,
    fallback,
    maximum =
        Number.MAX_SAFE_INTEGER
) {
    const raw =
        String(
            process.env[name] ?? ''
        )
            .trim();

    if (!raw) {
        return fallback;
    }

    const parsed =
        Number.parseInt(
            raw,
            10
        );

    if (
        !Number.isSafeInteger(parsed) ||
        parsed <= 0
    ) {
        return fallback;
    }

    return Math.min(
        parsed,
        maximum
    );
}

function configuredCandidates(
    environmentKey,
    fallback
) {
    const configured =
        String(
            process.env[environmentKey] ||
            ''
        )
            .split(',')
            .map(
                (value) =>
                    value.trim()
            )
            .filter(Boolean);

    const values =
        configured.length > 0
            ? configured
            : fallback;

    for (
        const collectionName of
        values
    ) {
        if (
            !SAFE_COLLECTION_NAME.test(
                collectionName
            )
        ) {
            throw new Error(
                `[TITech][SaaS Migration] Invalid MongoDB collection name supplied through ${environmentKey}: ${collectionName}`
            );
        }
    }

    return values;
}

function resolveOptions({
    dryRun,
} = {}) {
    return {
        dryRun:
            dryRun === undefined
                ? envBoolean(
                    'TITECH_SAAS_BILLING_MIGRATION_DRY_RUN',
                    false
                )
                : Boolean(dryRun),

        batchSize:
            envPositiveInteger(
                'TITECH_SAAS_BILLING_MIGRATION_BATCH_SIZE',
                DEFAULTS.batchSize,
                5000
            ),

        failOnRecordErrors:
            envBoolean(
                'TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS',
                false
            ),

        maxRecordErrors:
            envPositiveInteger(
                'TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS',
                DEFAULTS.maxRecordErrors,
                10000
            ),

        lockLeaseMs:
            envPositiveInteger(
                'TITECH_SAAS_BILLING_MIGRATION_LOCK_LEASE_MS',
                DEFAULTS.lockLeaseMs,
                24 * 60 * 60 * 1000
            ),

        requireSourceData:
            envBoolean(
                'TITECH_SAAS_BILLING_MIGRATION_REQUIRE_SOURCE_DATA',
                false
            ),

        allowHeuristicSourceDiscovery:
            envBoolean(
                'TITECH_SAAS_BILLING_MIGRATION_ALLOW_HEURISTIC_SOURCE_DISCOVERY',
                true
            ),
    };
}

/**
 * =============================================================================
 * General helpers
 * =============================================================================
 */

function safeDate(
    value,
    fallback = null
) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return fallback
            ? new Date(fallback)
            : null;
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
        return fallback
            ? new Date(fallback)
            : null;
    }

    return date;
}

function safeObjectId(
    value,
    fieldName
) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    if (
        value instanceof
        mongooseDefault.Types.ObjectId
    ) {
        return value;
    }

    const normalized =
        String(value).trim();

    if (
        !mongooseDefault.isValidObjectId(
            normalized
        )
    ) {
        throw new Error(
            `Invalid ${fieldName}: ${normalized}`
        );
    }

    return new mongooseDefault.Types.ObjectId(
        normalized
    );
}

function normalizeCode(
    value,
    fallback = 'LEGACY'
) {
    const result =
        String(
            value ?? fallback
        )
            .trim()
            .toUpperCase();

    return result || fallback;
}

function normalizeCurrency(
    value,
    fallback = 'UGX'
) {
    const currency =
        String(
            value ?? fallback
        )
            .trim()
            .toUpperCase();

    if (
        !SUPPORTED_CURRENCIES.has(
            currency
        )
    ) {
        throw new Error(
            `Unsupported TITech billing currency: ${currency}`
        );
    }

    return currency;
}

function normalizeInterval(
    value,
    fallback = 'MONTHLY'
) {
    const normalized =
        String(
            value ?? fallback
        )
            .trim()
            .toUpperCase();

    const interval =
        BILLING_INTERVAL_MAP[
            normalized
        ] ||
        normalized;

    if (
        !Object.values(
            BILLING_INTERVAL_MAP
        ).includes(
            interval
        )
    ) {
        throw new Error(
            `Unsupported TITech billing interval: ${normalized}`
        );
    }

    return interval;
}

function normalizeStatus(
    value,
    map,
    fallback
) {
    const normalized =
        String(
            value ?? fallback
        )
            .trim()
            .toLowerCase();

    return (
        map[normalized] ||
        String(
            value ?? fallback
        )
            .trim()
            .toUpperCase()
    );
}

function sourceId(
    source
) {
    return String(
        source?._id ??
        source?.id ??
        'unknown'
    );
}

function migrationKey(
    sourceCollection,
    source
) {
    return `${MIGRATION_NAME}:${sourceCollection}:${sourceId(source)}`;
}

function migrationMetadata(
    sourceCollection,
    source,
    extra = {}
) {
    return {
        source:
            MIGRATION_SOURCE,

        stage:
            MIGRATION_STAGE,

        sourceCollection:
            sourceCollection,

        sourceId:
            sourceId(source),

        migratedAt:
            new Date(),

        ...extra,
    };
}

function withMigrationMetadata(
    sourceCollection,
    source,
    extra = {}
) {
    const existing =
        source &&
        source.metadata &&
        typeof source.metadata ===
            'object' &&
        !Array.isArray(
            source.metadata
        )
            ? {
                ...source.metadata,
            }
            : {};

    return {
        ...existing,

        migration:
            migrationMetadata(
                sourceCollection,
                source,
                extra
            ),
    };
}

function errorMessage(
    error
) {
    return String(
        error?.message ||
        error ||
        'Unknown error'
    )
        .replace(
            /\s+/g,
            ' '
        )
        .trim()
        .slice(
            0,
            2000
        );
}

/**
 * =============================================================================
 * Exact decimal handling
 * =============================================================================
 */

function parseDecimal(
    value
) {
    const raw =
        String(
            value?.toString?.() ??
            value ??
            ''
        )
            .trim();

    if (!raw) {
        throw new Error(
            'Decimal value is empty.'
        );
    }

    if (
        !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(
            raw
        )
    ) {
        throw new Error(
            `Invalid decimal value: ${raw}`
        );
    }

    const pieces =
        raw
            .toLowerCase()
            .split('e');

    const mantissa =
        pieces[0];

    const exponent =
        pieces[1]
            ? Number.parseInt(
                pieces[1],
                10
            )
            : 0;

    if (
        !Number.isSafeInteger(
            exponent
        ) ||
        Math.abs(exponent) > 1000
    ) {
        throw new Error(
            `Unsupported decimal exponent: ${raw}`
        );
    }

    const negative =
        mantissa.startsWith('-');

    const unsigned =
        mantissa.replace(
            /^[+-]/,
            ''
        );

    const parts =
        unsigned.split('.');

    const whole =
        parts[0] || '0';

    const fraction =
        parts[1] || '';

    let digits =
        `${whole}${fraction}`
            .replace(
                /^0+(?=\d)/,
                ''
            ) || '0';

    let scale =
        fraction.length -
        exponent;

    if (
        scale < 0
    ) {
        digits =
            `${digits}${'0'.repeat(
                Math.abs(scale)
            )}`;

        scale = 0;
    }

    return {
        negative,
        digits,
        scale,
    };
}

function normalizeDecimal(
    value
) {
    const parsed =
        parseDecimal(value);

    let {
        digits,
        scale,
    } = parsed;

    if (
        digits === '0'
    ) {
        return '0';
    }

    while (
        scale > 0 &&
        digits.endsWith('0')
    ) {
        digits =
            digits.slice(
                0,
                -1
            );

        scale -= 1;
    }

    const padded =
        scale > 0
            ? digits.padStart(
                scale + 1,
                '0'
            )
            : digits;

    const split =
        padded.length -
        scale;

    const whole =
        scale > 0
            ? padded.slice(
                0,
                split
            )
            : padded;

    const fraction =
        scale > 0
            ? padded
                .slice(split)
                .padStart(
                    scale,
                    '0'
                )
            : '';

    const normalized =
        fraction
            ? `${whole}.${fraction}`
            : whole;

    return parsed.negative
        ? `-${normalized}`
        : normalized;
}

function compareUnsigned(
    left,
    right
) {
    const a =
        left.replace(
            /^0+(?=\d)/,
            ''
        ) || '0';

    const b =
        right.replace(
            /^0+(?=\d)/,
            ''
        ) || '0';

    if (
        a.length !==
        b.length
    ) {
        return a.length > b.length
            ? 1
            : -1;
    }

    if (
        a === b
    ) {
        return 0;
    }

    return a > b
        ? 1
        : -1;
}

function addUnsigned(
    left,
    right
) {
    let i =
        left.length - 1;

    let j =
        right.length - 1;

    let carry =
        0;

    let output =
        '';

    while (
        i >= 0 ||
        j >= 0 ||
        carry
    ) {
        const a =
            i >= 0
                ? left.charCodeAt(i) - 48
                : 0;

        const b =
            j >= 0
                ? right.charCodeAt(j) - 48
                : 0;

        const sum =
            a +
            b +
            carry;

        output =
            `${sum % 10}${output}`;

        carry =
            Math.floor(
                sum / 10
            );

        i -= 1;
        j -= 1;
    }

    return (
        output.replace(
            /^0+(?=\d)/,
            ''
        ) || '0'
    );
}

function subtractUnsigned(
    left,
    right
) {
    if (
        compareUnsigned(
            left,
            right
        ) < 0
    ) {
        throw new Error(
            'Decimal subtraction would produce a negative unsigned value.'
        );
    }

    let i =
        left.length - 1;

    let j =
        right.length - 1;

    let borrow =
        0;

    let output =
        '';

    while (
        i >= 0
    ) {
        let digit =
            left.charCodeAt(i) -
            48 -
            borrow;

        const rightDigit =
            j >= 0
                ? right.charCodeAt(j) - 48
                : 0;

        if (
            digit <
            rightDigit
        ) {
            digit += 10;
            borrow = 1;
        } else {
            borrow = 0;
        }

        output =
            `${digit - rightDigit}${output}`;

        i -= 1;
        j -= 1;
    }

    return (
        output.replace(
            /^0+(?=\d)/,
            ''
        ) || '0'
    );
}

function alignDecimals(
    left,
    right
) {
    const a =
        parseDecimal(left);

    const b =
        parseDecimal(right);

    const scale =
        Math.max(
            a.scale,
            b.scale
        );

    const aDigits =
        `${a.digits}${'0'.repeat(
            scale - a.scale
        )}`;

    const bDigits =
        `${b.digits}${'0'.repeat(
            scale - b.scale
        )}`;

    return {
        a:
            a.negative
                ? `-${aDigits}`
                : aDigits,

        b:
            b.negative
                ? `-${bDigits}`
                : bDigits,

        scale,
    };
}

function decimalAdd(
    left,
    right
) {
    const aligned =
        alignDecimals(
            left,
            right
        );

    const negativeLeft =
        aligned.a.startsWith('-');

    const negativeRight =
        aligned.b.startsWith('-');

    const absoluteLeft =
        negativeLeft
            ? aligned.a.slice(1)
            : aligned.a;

    const absoluteRight =
        negativeRight
            ? aligned.b.slice(1)
            : aligned.b;

    let digits;
    let negative;

    if (
        negativeLeft ===
        negativeRight
    ) {
        digits =
            addUnsigned(
                absoluteLeft,
                absoluteRight
            );

        negative =
            negativeLeft;
    } else {
        const comparison =
            compareUnsigned(
                absoluteLeft,
                absoluteRight
            );

        if (
            comparison === 0
        ) {
            return '0';
        }

        if (
            comparison > 0
        ) {
            digits =
                subtractUnsigned(
                    absoluteLeft,
                    absoluteRight
                );

            negative =
                negativeLeft;
        } else {
            digits =
                subtractUnsigned(
                    absoluteRight,
                    absoluteLeft
                );

            negative =
                negativeRight;
        }
    }

    const scale =
        aligned.scale;

    const padded =
        scale > 0
            ? digits.padStart(
                scale + 1,
                '0'
            )
            : digits;

    const split =
        padded.length -
        scale;

    const whole =
        scale > 0
            ? padded.slice(
                0,
                split
            )
            : padded;

    const fraction =
        scale > 0
            ? padded.slice(split)
            : '';

    const result =
        fraction
            ? `${whole}.${fraction}`
            : whole;

    return normalizeDecimal(
        negative &&
        result !== '0'
            ? `-${result}`
            : result
    );
}

function decimalSubtract(
    left,
    right
) {
    return decimalAdd(
        left,
        `-${normalizeDecimal(
            right
        )}`
    );
}

function nonNegativeDecimal(
    value,
    fieldName
) {
    const normalized =
        normalizeDecimal(
            value ?? '0'
        );

    if (
        normalized.startsWith('-')
    ) {
        throw new Error(
            `${fieldName} cannot be negative.`
        );
    }

    return normalized;
}

function toDecimal128(
    value
) {
    return mongooseDefault
        .Types
        .Decimal128
        .fromString(
            normalizeDecimal(
                value
            )
        );
}

/**
 * =============================================================================
 * Collection discovery
 * =============================================================================
 */

async function listCollectionNames(
    db
) {
    return (
        await db
            .listCollections(
                {},
                {
                    nameOnly:
                        true,
                }
            )
            .toArray()
    )
        .map(
            (entry) =>
                entry.name
        )
        .filter(Boolean);
}

function normalizeCollectionName(
    value
) {
    return String(
        value
    )
        .trim()
        .toLowerCase();
}

function scoreSourceCollection(
    category,
    collectionName,
    sampleDocument
) {
    let score = 0;

    const normalizedName =
        normalizeCollectionName(
            collectionName
        );

    const namePatterns =
        SOURCE_NAME_PATTERNS[
            category
        ] || [];

    for (
        const pattern of
        namePatterns
    ) {
        if (
            pattern.test(
                normalizedName
            )
        ) {
            score += 3;
        }
    }

    const fieldPatterns =
        SOURCE_FIELD_PATTERNS[
            category
        ] || [];

    if (
        sampleDocument &&
        typeof sampleDocument ===
            'object'
    ) {
        for (
            const field of
            fieldPatterns
        ) {
            if (
                Object.prototype.hasOwnProperty.call(
                    sampleDocument,
                    field
                )
            ) {
                score += 2;
            }
        }
    }

    return score;
}

async function sampleCollection(
    db,
    collectionName
) {
    return db
        .collection(
            collectionName
        )
        .findOne(
            {},
            {
                projection:
                    {
                        _id:
                            1,
                    },
                maxTimeMS:
                    5000,
            }
        );
}

async function countCollection(
    db,
    collectionName
) {
    return db
        .collection(
            collectionName
        )
        .estimatedDocumentCount();
}

async function discoverSourceCollection({
    db,
    category,
    candidates,
    availableNames,
    allowHeuristic,
}) {
    const result = {
        category,
        status: 'NOT_FOUND',
        collectionName: null,
        matchedBy: null,
        candidatesChecked: candidates,
        ambiguousCandidates: [],
        documentCount: 0,
    };

    const availableByLowercase =
        new Map(
            availableNames.map(
                (name) => [
                    normalizeCollectionName(
                        name
                    ),
                    name,
                ]
            )
        );

    /**
     * -------------------------------------------------------------------------
     * 1. Explicit / configured / known exact candidates.
     * -------------------------------------------------------------------------
     */

    for (
        const candidate of candidates
    ) {
        if (
            availableNames.includes(
                candidate
            ) &&
            !CANONICAL_COLLECTIONS.has(
                candidate
            )
        ) {
            result.status =
                'FOUND';

            result.collectionName =
                candidate;

            result.matchedBy =
                'EXACT';

            result.documentCount =
                await countCollection(
                    db,
                    candidate
                );

            return result;
        }

        const caseInsensitiveMatch =
            availableByLowercase.get(
                normalizeCollectionName(
                    candidate
                )
            );

        if (
            caseInsensitiveMatch &&
            !CANONICAL_COLLECTIONS.has(
                caseInsensitiveMatch
            )
        ) {
            result.status =
                'FOUND';

            result.collectionName =
                caseInsensitiveMatch;

            result.matchedBy =
                'CASE_INSENSITIVE';

            result.documentCount =
                await countCollection(
                    db,
                    caseInsensitiveMatch
                );

            return result;
        }
    }

    if (
        !allowHeuristic
    ) {
        return result;
    }

    /**
     * -------------------------------------------------------------------------
     * 2. Semantic discovery.
     *
     * NEVER guess when there are multiple high-confidence matches.
     * -------------------------------------------------------------------------
     */

    const scored =
        [];

    for (
        const name of
        availableNames
    ) {
        if (
            CANONICAL_COLLECTIONS.has(
                name
            )
        ) {
            continue;
        }

        const sample =
            await sampleCollection(
                db,
                name
            );

        const score =
            scoreSourceCollection(
                category,
                name,
                sample
            );

        if (
            score <= 0
        ) {
            continue;
        }

        const documentCount =
            await countCollection(
                db,
                name
            );

        scored.push({
            name,
            score,
            documentCount,
        });
    }

    scored.sort(
        (left, right) =>
            right.score -
            left.score
    );

    const highConfidence =
        scored.filter(
            (entry) =>
                entry.score >= 6
        );

    if (
        highConfidence.length === 1
    ) {
        result.status =
            'FOUND';

        result.collectionName =
            highConfidence[0].name;

        result.matchedBy =
            'HEURISTIC';

        result.documentCount =
            highConfidence[0]
                .documentCount;

        return result;
    }

    if (
        highConfidence.length > 1
    ) {
        result.status =
            'AMBIGUOUS';

        result.ambiguousCandidates =
            highConfidence
                .slice(
                    0,
                    DEFAULTS
                        .maxSourceDiscoveryMatches
                )
                .map(
                    (entry) => ({
                        collectionName:
                            entry.name,
                        score:
                            entry.score,
                        documentCount:
                            entry.documentCount,
                    })
                );

        return result;
    }

    /**
     * Medium-confidence result:
     * only accept it when it is the sole candidate.
     */
    if (
        scored.length === 1 &&
        scored[0].score >= 3
    ) {
        result.status =
            'FOUND';

        result.collectionName =
            scored[0].name;

        result.matchedBy =
            'HEURISTIC_LOW_CONFIDENCE_SINGLE';

        result.documentCount =
            scored[0].documentCount;

        return result;
    }

    return result;
}

async function discoverSources(
    db,
    options
) {
    const availableNames =
        await listCollectionNames(
            db
        );

    const discovery = {};

    for (
        const category of
        SOURCE_CATEGORIES
    ) {
        const envName =
            SOURCE_ENVIRONMENT_VARIABLES[
                category
            ];

        const candidates =
            configuredCandidates(
                envName,
                DEFAULTS[category]
            );

        discovery[category] =
            await discoverSourceCollection({
                db,
                category,
                candidates,
                availableNames,
                allowHeuristic:
                    options.allowHeuristicSourceDiscovery,
            });
    }

    return {
        availableNames,
        categories:
            discovery,
    };
}

function assertSourceDiscoverySafe(
    discovery,
    options
) {
    for (
        const category of
        SOURCE_CATEGORIES
    ) {
        const item =
            discovery.categories[
                category
            ];

        if (
            item.status ===
            'AMBIGUOUS'
        ) {
            const candidates =
                item.ambiguousCandidates
                    .map(
                        (entry) =>
                            `${entry.collectionName} (score=${entry.score}, documents=${entry.documentCount})`
                    )
                    .join(', ');

            throw new Error(
                `[TITech][SaaS Migration] Ambiguous legacy ${category} source discovery. Candidates: ${candidates}. Configure ${SOURCE_ENVIRONMENT_VARIABLES[category]} explicitly rather than allowing the migration to guess.`
            );
        }
    }

    if (
        options.requireSourceData &&
        !options.dryRun
    ) {
        const totalSourceDocuments =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        discovery
                            .categories[
                                category
                            ]
                            .documentCount ||
                        0
                    ),
                0
            );

        if (
            totalSourceDocuments ===
            0
        ) {
            throw new Error(
                '[TITech][SaaS Migration] Source-data requirement is enabled, but no legacy SaaS billing source documents were detected.'
            );
        }
    }
}

function buildSourceSummary(
    discovery
) {
    const sources = {};
    const sourceDetails = {};

    for (
        const category of
        SOURCE_CATEGORIES
    ) {
        const item =
            discovery.categories[
                category
            ];

        sources[category] =
            item.collectionName;

        sourceDetails[category] = {
            status:
                item.status,

            collectionName:
                item.collectionName,

            matchedBy:
                item.matchedBy,

            documentCount:
                item.documentCount,

            ambiguousCandidates:
                item.ambiguousCandidates,
        };
    }

    return {
        sources,
        sourceDetails,
    };
}

/**
 * =============================================================================
 * Index reconciliation
 * =============================================================================
 */

async function getIndexes(
    collection
) {
    try {
        return new Map(
            (
                await collection.indexes()
            ).map(
                (index) => [
                    index.name,
                    index,
                ]
            )
        );
    } catch (error) {
        if (
            error?.code === 26 ||
            error?.codeName ===
                'NamespaceNotFound'
        ) {
            return new Map();
        }

        throw error;
    }
}

function indexesEquivalent(
    existing,
    expected
) {
    const stringify =
        (value) =>
            JSON.stringify(
                value || {}
            );

    return (
        stringify(
            existing.key
        ) ===
        stringify(
            expected.key
        ) &&
        Boolean(
            existing.unique
        ) ===
        Boolean(
            expected.options?.unique
        ) &&
        Boolean(
            existing.sparse
        ) ===
        Boolean(
            expected.options?.sparse
        ) &&
        stringify(
            existing.partialFilterExpression
        ) ===
        stringify(
            expected.options
                ?.partialFilterExpression
        )
    );
}

async function ensureIndexes(
    db,
    collectionName,
    definitions
) {
    const collection =
        db.collection(
            collectionName
        );

    const existing =
        await getIndexes(
            collection
        );

    const results = [];

    for (
        const definition of
        definitions
    ) {
        const current =
            existing.get(
                definition.name
            );

        if (
            current
        ) {
            if (
                !indexesEquivalent(
                    current,
                    definition
                )
            ) {
                throw new Error(
                    `[TITech][SaaS Migration] Conflicting index ${definition.name} exists on ${collectionName}. The migration will not replace or drop the existing index.`
                );
            }

            results.push({
                name:
                    definition.name,

                action:
                    'already-present',
            });

            continue;
        }

        await collection.createIndex(
            definition.key,
            {
                name:
                    definition.name,

                ...definition.options,
            }
        );

        results.push({
            name:
                definition.name,

            action:
                'created',
        });
    }

    return results;
}

/**
 * =============================================================================
 * Migration lock
 * =============================================================================
 */

async function acquireLock(
    db,
    options
) {
    if (
        options.dryRun
    ) {
        return {
            acquired:
                false,

            lockToken:
                null,

            dryRun:
                true,
        };
    }

    const stateCollection =
        db.collection(
            CANONICAL.migrationState
        );

    const lockToken =
        `${process.pid}:${Date.now()}:${Math.random()
            .toString(36)
            .slice(2)}`;

    const now =
        new Date();

    const expiration =
        new Date(
            now.getTime() +
            options.lockLeaseMs
        );

    await stateCollection.createIndex(
        {
            lockExpiresAt:
                1,
        },
        {
            name:
                'idx_titech_billing_migration_lock_expiry',
        }
    );

    try {
        const result =
            await stateCollection.findOneAndUpdate(
                {
                    _id:
                        MIGRATION_NAME,

                    $or:
                        [
                            {
                                lockExpiresAt:
                                    {
                                        $lte:
                                            now,
                                    },
                            },

                            {
                                lockExpiresAt:
                                    {
                                        $exists:
                                            false,
                                    },
                            },

                            {
                                status:
                                    {
                                        $in:
                                            [
                                                'COMPLETED',
                                                'COMPLETED_NO_SOURCE_DATA',
                                                'FAILED',
                                                'RELEASED',
                                            ],
                                    },
                            },
                        ],
                },
                {
                    $set:
                        {
                            stage:
                                MIGRATION_STAGE,

                            status:
                                'RUNNING',

                            lockToken,

                            lockAcquiredAt:
                                now,

                            lockExpiresAt:
                                expiration,

                            startedAt:
                                now,

                            dryRun:
                                false,

                            updatedAt:
                                now,
                        },
                },
                {
                    upsert:
                        true,

                    returnDocument:
                        'after',
                }
            );

        const document =
            result?.value ??
            result;

        if (
            !document ||
            document.lockToken !==
                lockToken
        ) {
            throw new Error(
                '[TITech][SaaS Migration] Another process currently owns the migration lock.'
            );
        }

        return {
            acquired:
                true,

            lockToken,

            dryRun:
                false,
        };
    } catch (error) {
        if (
            error?.code ===
            11000
        ) {
            throw new Error(
                '[TITech][SaaS Migration] Another process acquired the consolidation lock concurrently. Retry after that process completes.'
            );
        }

        throw error;
    }
}

async function releaseLock(
    db,
    lockToken,
    status,
    summary
) {
    if (
        !lockToken
    ) {
        return;
    }

    await db
        .collection(
            CANONICAL.migrationState
        )
        .updateOne(
            {
                _id:
                    MIGRATION_NAME,

                lockToken,
            },
            {
                $set:
                    {
                        status,

                        summary,

                        lockReleasedAt:
                            new Date(),

                        lockExpiresAt:
                            new Date(),

                        updatedAt:
                            new Date(),
                    },

                $unset:
                    {
                        lockToken:
                            '',
                    },
            }
        );
}

/**
 * =============================================================================
 * Normalizers
 * =============================================================================
 */

function normalizePlan(
    source,
    sourceCollection
) {
    const sourceKey =
        migrationKey(
            sourceCollection,
            source
        );

    const code =
        normalizeCode(
            source.code ||
            source.planCode ||
            source.tier ||
            source.name ||
            'STARTER'
        );

    const version =
        Math.max(
            1,
            Number.parseInt(
                String(
                    source.version ??
                    1
                ),
                10
            ) || 1
        );

    const currency =
        normalizeCurrency(
            source.currency ||
            source.prices?.monthly?.currency ||
            'UGX'
        );

    const monthlyAmount =
        source.prices?.monthly?.amount ??
        source.price ??
        source.monthlyPrice ??
        source.monthlyAmount ??
        0;

    const quarterlyAmount =
        source.prices?.quarterly?.amount ??
        source.quarterlyPrice ??
        source.quarterlyAmount ??
        null;

    const annualAmount =
        source.prices?.annual?.amount ??
        source.annualPrice ??
        source.yearlyPrice ??
        source.annualAmount ??
        null;

    const effectiveFrom =
        safeDate(
            source.effectiveFrom ||
            source.createdAt
        ) ||
        new Date();

    const effectiveTo =
        safeDate(
            source.effectiveTo
        );

    if (
        effectiveTo &&
        effectiveTo <=
            effectiveFrom
    ) {
        throw new Error(
            'Plan effectiveTo must be later than effectiveFrom.'
        );
    }

    const tier =
        (() => {
            const provided =
                String(
                    source.tier ||
                    ''
                )
                    .trim()
                    .toUpperCase();

            if (
                [
                    'STARTER',
                    'PROFESSIONAL',
                    'INSTITUTION',
                    'ENTERPRISE',
                ].includes(
                    provided
                )
            ) {
                return provided;
            }

            if (
                code ===
                'ENTERPRISE'
            ) {
                return 'ENTERPRISE';
            }

            if (
                code ===
                'INSTITUTION'
            ) {
                return 'INSTITUTION';
            }

            if (
                [
                    'PROFESSIONAL',
                    'GROWTH',
                    'BUSINESS',
                ].includes(
                    code
                )
            ) {
                return 'PROFESSIONAL';
            }

            return 'STARTER';
        })();

    return {
        filter:
            {
                code,
                version,
            },

        document:
            {
                code,

                name:
                    String(
                        source.name ||
                        code
                    )
                        .trim()
                        .slice(
                            0,
                            120
                        ),

                description:
                    String(
                        source.description ||
                        'Migrated TITech SaaS billing plan'
                    )
                        .slice(
                            0,
                            2000
                        ),

                tier,

                version,

                prices:
                    {
                        monthly:
                            {
                                currency,

                                amount:
                                    toDecimal128(
                                        nonNegativeDecimal(
                                            monthlyAmount,
                                            'Plan monthly price'
                                        )
                                    ),
                            },

                        quarterly:
                            quarterlyAmount ===
                            null
                                ? null
                                : {
                                    currency,

                                    amount:
                                        toDecimal128(
                                            nonNegativeDecimal(
                                                quarterlyAmount,
                                                'Plan quarterly price'
                                            )
                                        ),
                                },

                        annual:
                            annualAmount ===
                            null
                                ? null
                                : {
                                    currency,

                                    amount:
                                        toDecimal128(
                                            nonNegativeDecimal(
                                                annualAmount,
                                                'Plan annual price'
                                            )
                                        ),
                                },
                    },

                defaultInterval:
                    normalizeInterval(
                        source.defaultInterval ||
                        source.billingCycle ||
                        source.interval ||
                        'MONTHLY'
                    ),

                features:
                    Array.isArray(
                        source.features
                    )
                        ? source.features
                            .map(
                                (feature) =>
                                    String(
                                        feature
                                    )
                                        .trim()
                            )
                            .filter(Boolean)
                        : [],

                limits:
                    source.limits &&
                    typeof source.limits ===
                        'object' &&
                    !Array.isArray(
                        source.limits
                    )
                        ? source.limits
                        : {},

                trialDays:
                    Math.max(
                        0,
                        Math.min(
                            365,
                            Number.parseInt(
                                String(
                                    source.trialDays ??
                                    0
                                ),
                                10
                            ) || 0
                        )
                    ),

                isPublic:
                    source.isPublic !==
                    false,

                isActive:
                    source.isActive !==
                        false &&
                    source.active !==
                        false,

                effectiveFrom,

                effectiveTo,

                metadata:
                    withMigrationMetadata(
                        sourceCollection,
                        source,
                        {
                            migrationKey:
                                sourceKey,
                        }
                    ),

                createdBy:
                    safeObjectId(
                        source.createdBy,
                        'plan.createdBy'
                    ),

                updatedBy:
                    safeObjectId(
                        source.updatedBy,
                        'plan.updatedBy'
                    ),

                createdAt:
                    safeDate(
                        source.createdAt
                    ) ||
                    effectiveFrom,

                updatedAt:
                    safeDate(
                        source.updatedAt
                    ) ||
                    effectiveFrom,
            },
    };
}

function normalizeSubscription(
    source,
    sourceCollection,
    canonicalPlan
) {
    const tenantId =
        safeObjectId(
            source.tenantId,
            'subscription.tenantId'
        );

    if (!tenantId) {
        throw new Error(
            'Subscription tenantId is required.'
        );
    }

    /**
     * Never allow a legacy plan ObjectId to survive into the canonical
     * subscription when a plan relationship is present.
     */
    if (
        (
            source.planId ||
            source.plan ||
            source.planCode ||
            source.plan?.code
        ) &&
        !canonicalPlan
    ) {
        throw new Error(
            `Canonical billing plan mapping is required for subscription ${sourceId(source)}.`
        );
    }

    const currentPeriodStart =
        safeDate(
            source.currentPeriodStart ||
            source.startedAt ||
            source.periodStart ||
            source.createdAt
        ) ||
        new Date();

    let currentPeriodEnd =
        safeDate(
            source.currentPeriodEnd ||
            source.renewalDate ||
            source.periodEnd
        );

    if (!currentPeriodEnd) {
        currentPeriodEnd =
            new Date(
                currentPeriodStart.getTime() +
                31 *
                24 *
                60 *
                60 *
                1000
            );
    }

    if (
        currentPeriodEnd <=
        currentPeriodStart
    ) {
        throw new Error(
            'Subscription currentPeriodEnd must be later than currentPeriodStart.'
        );
    }

    const status =
        normalizeStatus(
            source.status,
            SUBSCRIPTION_STATUS_MAP,
            'ACTIVE'
        );

    const safeStatus =
        SUPPORTED_SUBSCRIPTION_STATUSES.has(
            status
        )
            ? status
            : 'ACTIVE';

    const billingInterval =
        normalizeInterval(
            source.billingInterval ||
            source.billingCycle ||
            source.interval ||
            'MONTHLY'
        );

    const currency =
        normalizeCurrency(
            source.currency ||
            source.priceCurrency ||
            canonicalPlan?.prices?.monthly?.currency ||
            'UGX'
        );

    const unitAmount =
        source.unitAmount ??
        source.amount ??
        source.price ??
        canonicalPlan?.prices?.monthly?.amount ??
        0;

    const idempotencyKey =
        String(
            source.idempotencyKey ||
            migrationKey(
                sourceCollection,
                source
            )
        )
            .trim()
            .slice(
                0,
                255
            );

    const trialStartsAt =
        safeDate(
            source.trialStartsAt
        );

    const trialEndsAt =
        safeDate(
            source.trialEndsAt
        );

    if (
        trialStartsAt &&
        trialEndsAt &&
        trialEndsAt <=
            trialStartsAt
    ) {
        throw new Error(
            'Subscription trialEndsAt must be later than trialStartsAt.'
        );
    }

    return {
        filter:
            {
                tenantId,
                idempotencyKey,
            },

        document:
            {
                tenantId,

                planId:
                    canonicalPlan?._id ||
                    null,

                planVersion:
                    Math.max(
                        1,
                        Number.parseInt(
                            String(
                                source.planVersion ||
                                source.plan?.version ||
                                canonicalPlan?.version ||
                                1
                            ),
                            10
                        ) || 1
                    ),

                status:
                    safeStatus,

                billingInterval,

                currency,

                unitAmount:
                    toDecimal128(
                        nonNegativeDecimal(
                            unitAmount,
                            'Subscription unitAmount'
                        )
                    ),

                quantity:
                    Math.max(
                        1,
                        Number.parseInt(
                            String(
                                source.quantity ??
                                1
                            ),
                            10
                        ) || 1
                    ),

                trialStartsAt,

                trialEndsAt,

                currentPeriodStart,

                currentPeriodEnd,

                cancelAtPeriodEnd:
                    Boolean(
                        source.cancelAtPeriodEnd
                    ),

                cancelledAt:
                    safeDate(
                        source.cancelledAt
                    ),

                cancellationReason:
                    source.cancellationReason
                        ? String(
                            source.cancellationReason
                        ).slice(
                            0,
                            1000
                        )
                        : null,

                pastDueAt:
                    safeDate(
                        source.pastDueAt
                    ),

                graceStartedAt:
                    safeDate(
                        source.graceStartedAt
                    ),

                suspendedAt:
                    safeDate(
                        source.suspendedAt
                    ),

                lastInvoiceId:
                    null,

                idempotencyKey,

                lifecycleVersion:
                    Math.max(
                        0,
                        Number.parseInt(
                            String(
                                source.lifecycleVersion ??
                                source.version ??
                                0
                            ),
                            10
                        ) || 0
                    ),

                metadata:
                    withMigrationMetadata(
                        sourceCollection,
                        source,
                        {
                            migrationKey:
                                migrationKey(
                                    sourceCollection,
                                    source
                                ),

                            legacyPlanId:
                                source.planId !=
                                null
                                    ? String(
                                        source.planId
                                    )
                                    : null,
                        }
                    ),

                createdBy:
                    safeObjectId(
                        source.createdBy,
                        'subscription.createdBy'
                    ),

                updatedBy:
                    safeObjectId(
                        source.updatedBy,
                        'subscription.updatedBy'
                    ),

                createdAt:
                    safeDate(
                        source.createdAt
                    ) ||
                    currentPeriodStart,

                updatedAt:
                    safeDate(
                        source.updatedAt
                    ) ||
                    currentPeriodStart,
            },
    };
}

function normalizeInvoice(
    source,
    sourceCollection,
    canonicalSubscriptionId
) {
    const tenantId =
        safeObjectId(
            source.tenantId,
            'invoice.tenantId'
        );

    if (!tenantId) {
        throw new Error(
            'Invoice tenantId is required.'
        );
    }

    if (
        source.subscriptionId &&
        !canonicalSubscriptionId
    ) {
        throw new Error(
            `Canonical subscription mapping is required for invoice ${sourceId(source)}.`
        );
    }

    const periodStart =
        safeDate(
            source.periodStart ||
            source.billingPeriodStart ||
            source.createdAt
        ) ||
        new Date();

    const periodEnd =
        safeDate(
            source.periodEnd ||
            source.billingPeriodEnd ||
            source.dueDate
        ) ||
        new Date(
            periodStart.getTime() +
            24 *
            60 *
            60 *
            1000
        );

    if (
        periodEnd <=
        periodStart
    ) {
        throw new Error(
            'Invoice periodEnd must be later than periodStart.'
        );
    }

    const total =
        nonNegativeDecimal(
            source.total ??
            source.amount ??
            0,
            'Invoice total'
        );

    const subtotal =
        nonNegativeDecimal(
            source.subtotal ??
            total,
            'Invoice subtotal'
        );

    const discount =
        nonNegativeDecimal(
            source.discount ??
            0,
            'Invoice discount'
        );

    const tax =
        nonNegativeDecimal(
            source.tax ??
            0,
            'Invoice tax'
        );

    const amountPaid =
        nonNegativeDecimal(
            source.amountPaid ??
            source.paidAmount ??
            0,
            'Invoice amountPaid'
        );

    let amountDue =
        source.amountDue != null
            ? nonNegativeDecimal(
                source.amountDue,
                'Invoice amountDue'
            )
            : decimalSubtract(
                total,
                amountPaid
            );

    if (
        amountDue.startsWith('-')
    ) {
        amountDue = '0';
    }

    const status =
        normalizeStatus(
            source.status,
            INVOICE_STATUS_MAP,
            'PENDING'
        );

    const safeStatus =
        SUPPORTED_INVOICE_STATUSES.has(
            status
        )
            ? status
            : 'PENDING';

    const invoiceNumber =
        String(
            source.invoiceNumber ||
            source.reference ||
            `LEGACY-${sourceId(source)}`
        )
            .trim()
            .toUpperCase()
            .slice(
                0,
                120
            );

    const generationKey =
        String(
            source.generationKey ||
            migrationKey(
                sourceCollection,
                source
            )
        )
            .trim()
            .slice(
                0,
                255
            );

    const idempotencyKey =
        String(
            source.idempotencyKey ||
            migrationKey(
                sourceCollection,
                source
            )
        )
            .trim()
            .slice(
                0,
                255
            );

    return {
        filter:
            {
                generationKey,
            },

        document:
            {
                tenantId,

                subscriptionId:
                    canonicalSubscriptionId ||
                    null,

                invoiceNumber,

                status:
                    safeStatus,

                currency:
                    normalizeCurrency(
                        source.currency ||
                        'UGX'
                    ),

                subtotal:
                    toDecimal128(
                        subtotal
                    ),

                discount:
                    toDecimal128(
                        discount
                    ),

                tax:
                    toDecimal128(
                        tax
                    ),

                total:
                    toDecimal128(
                        total
                    ),

                amountPaid:
                    toDecimal128(
                        amountPaid
                    ),

                amountDue:
                    toDecimal128(
                        amountDue
                    ),

                periodStart,

                periodEnd,

                issuedAt:
                    safeDate(
                        source.issuedAt
                    ) ||
                    safeDate(
                        source.createdAt
                    ) ||
                    periodStart,

                dueDate:
                    safeDate(
                        source.dueDate
                    ) ||
                    periodEnd,

                paidAt:
                    safeDate(
                        source.paidAt
                    ),

                voidedAt:
                    safeDate(
                        source.voidedAt
                    ),

                overdueAt:
                    safeDate(
                        source.overdueAt
                    ),

                paymentAttempts:
                    Math.max(
                        0,
                        Number.parseInt(
                            String(
                                source.paymentAttempts ??
                                0
                            ),
                            10
                        ) || 0
                    ),

                retryCount:
                    Math.max(
                        0,
                        Number.parseInt(
                            String(
                                source.retryCount ??
                                0
                            ),
                            10
                        ) || 0
                    ),

                lastPaymentAttemptAt:
                    safeDate(
                        source.lastPaymentAttemptAt
                    ),

                paymentReference:
                    source.paymentReference
                        ? String(
                            source.paymentReference
                        )
                            .trim()
                            .slice(
                                0,
                                255
                            )
                        : null,

                idempotencyKey,

                generationKey,

                metadata:
                    withMigrationMetadata(
                        sourceCollection,
                        source,
                        {
                            migrationKey:
                                migrationKey(
                                    sourceCollection,
                                    source
                                ),

                            legacySubscriptionId:
                                source.subscriptionId !=
                                null
                                    ? String(
                                        source.subscriptionId
                                    )
                                    : null,
                        }
                    ),

                createdBy:
                    safeObjectId(
                        source.createdBy,
                        'invoice.createdBy'
                    ),

                updatedBy:
                    safeObjectId(
                        source.updatedBy,
                        'invoice.updatedBy'
                    ),

                createdAt:
                    safeDate(
                        source.createdAt
                    ) ||
                    periodStart,

                updatedAt:
                    safeDate(
                        source.updatedAt
                    ) ||
                    periodStart,
            },
    };
}

function normalizeUsage(
    source,
    sourceCollection,
    canonicalSubscriptionId
) {
    const tenantId =
        safeObjectId(
            source.tenantId,
            'usage.tenantId'
        );

    if (!tenantId) {
        throw new Error(
            'Usage tenantId is required.'
        );
    }

    if (
        source.subscriptionId &&
        !canonicalSubscriptionId
    ) {
        throw new Error(
            `Canonical subscription mapping is required for usage record ${sourceId(source)}.`
        );
    }

    const periodStart =
        safeDate(
            source.periodStart ||
            source.createdAt
        ) ||
        new Date();

    const periodEnd =
        safeDate(
            source.periodEnd
        ) ||
        new Date(
            periodStart.getTime() +
            24 *
            60 *
            60 *
            1000
        );

    if (
        periodEnd <=
        periodStart
    ) {
        throw new Error(
            'Usage periodEnd must be later than periodStart.'
        );
    }

    const meterTypeCandidate =
        normalizeCode(
            source.meterType ||
            source.type ||
            'CUSTOM'
        );

    const meterType =
        SUPPORTED_METER_TYPES.has(
            meterTypeCandidate
        )
            ? meterTypeCandidate
            : 'CUSTOM';

    const sourceReference =
        String(
            source.sourceReference ||
            source._id ||
            source.id ||
            ''
        )
            .trim()
            .slice(
                0,
                255
            );

    if (!sourceReference) {
        throw new Error(
            'Usage sourceReference is required.'
        );
    }

    return {
        filter:
            {
                tenantId,

                sourceReference,
            },

        document:
            {
                tenantId,

                subscriptionId:
                    canonicalSubscriptionId ||
                    null,

                meterType,

                meterCode:
                    normalizeCode(
                        source.meterCode ||
                        source.type ||
                        'LEGACY'
                    )
                        .slice(
                            0,
                            120
                        ),

                periodStart,

                periodEnd,

                quantity:
                    toDecimal128(
                        nonNegativeDecimal(
                            source.quantity ??
                            source.amount ??
                            0,
                            'Usage quantity'
                        )
                    ),

                source:
                    String(
                        source.source ||
                        'legacy-migration'
                    )
                        .trim()
                        .slice(
                            0,
                            120
                        ),

                sourceReference,

                recordedAt:
                    safeDate(
                        source.recordedAt
                    ) ||
                    safeDate(
                        source.createdAt
                    ) ||
                    periodStart,

                metadata:
                    withMigrationMetadata(
                        sourceCollection,
                        source,
                        {
                            migrationKey:
                                migrationKey(
                                    sourceCollection,
                                    source
                                ),
                        }
                    ),

                createdAt:
                    safeDate(
                        source.createdAt
                    ) ||
                    periodStart,

                updatedAt:
                    safeDate(
                        source.updatedAt
                    ) ||
                    periodStart,
            },
    };
}

/**
 * =============================================================================
 * Canonical indexes + idempotent writes
 * =============================================================================
 */

async function upsertDocument(
    db,
    collectionName,
    normalized,
    dryRun
) {
    const collection =
        db.collection(
            collectionName
        );

    if (
        dryRun
    ) {
        const existing =
            await collection.findOne(
                normalized.filter,
                {
                    projection:
                        {
                            _id:
                                1,
                        },
                }
            );

        return {
            action:
                existing
                    ? 'existing'
                    : 'would-insert',

            inserted:
                0,

            existing:
                existing
                    ? 1
                    : 0,
        };
    }

    const result =
        await collection.updateOne(
            normalized.filter,
            {
                $setOnInsert:
                    normalized.document,
            },
            {
                upsert:
                    true,
            }
        );

    if (
        result.upsertedCount >
        0
    ) {
        return {
            action:
                'inserted',

            inserted:
                1,

            existing:
                0,
        };
    }

    return {
        action:
            'existing',

        inserted:
            0,

        existing:
            1,
    };
}

/**
 * =============================================================================
 * Canonical relationship maps
 * =============================================================================
 */

async function collectCanonicalPlans(
    db
) {
    const byMigrationKey =
        new Map();

    const byCodeVersion =
        new Map();

    const cursor =
        db
            .collection(
                CANONICAL.plans
            )
            .find(
                {},
                {
                    projection:
                        {
                            _id:
                                1,

                            code:
                                1,

                            version:
                                1,

                            prices:
                                1,

                            metadata:
                                1,
                        },
                }
            );

    while (
        await cursor.hasNext()
    ) {
        const plan =
            await cursor.next();

        const migration =
            plan.metadata?.migration;

        if (
            migration?.sourceCollection &&
            migration?.sourceId
        ) {
            byMigrationKey.set(
                migrationKey(
                    migration.sourceCollection,
                    {
                        _id:
                            migration.sourceId,
                    }
                ),
                plan
            );
        }

        byCodeVersion.set(
            `${plan.code}:${plan.version}`,
            plan
        );
    }

    return {
        byMigrationKey,
        byCodeVersion,
    };
}

async function collectCanonicalSubscriptions(
    db
) {
    const byMigrationKey =
        new Map();

    const cursor =
        db
            .collection(
                CANONICAL.subscriptions
            )
            .find(
                {},
                {
                    projection:
                        {
                            _id:
                                1,

                            tenantId:
                                1,

                            metadata:
                                1,
                        },
                }
            );

    while (
        await cursor.hasNext()
    ) {
        const subscription =
            await cursor.next();

        const migration =
            subscription.metadata?.migration;

        if (
            migration?.sourceCollection &&
            migration?.sourceId
        ) {
            byMigrationKey.set(
                migrationKey(
                    migration.sourceCollection,
                    {
                        _id:
                            migration.sourceId,
                    }
                ),
                subscription
            );
        }
    }

    return byMigrationKey;
}

/**
 * =============================================================================
 * Category migration
 * =============================================================================
 */

async function migrateCategory({
    db,
    sourceCollection,
    canonicalCollection,
    normalizer,
    category,
    options,
}) {
    const summary = {
        category,

        sourceCollection,

        canonicalCollection,

        scanned:
            0,

        inserted:
            0,

        existing:
            0,

        skipped:
            0,

        errors:
            0,

        errorsSample:
            [],

        reconciliation:
            null,
    };

    if (
        !sourceCollection
    ) {
        return summary;
    }

    const sourceCollectionHandle =
        db.collection(
            sourceCollection
        );

    const sourceCount =
        await sourceCollectionHandle
            .estimatedDocumentCount();

    summary.sourceCount =
        sourceCount;

    if (
        sourceCount === 0
    ) {
        return summary;
    }

    const cursor =
        sourceCollectionHandle
            .find(
                {},
                {
                    batchSize:
                        options.batchSize,
                }
            );

    while (
        await cursor.hasNext()
    ) {
        const source =
            await cursor.next();

        summary.scanned +=
            1;

        try {
            const normalized =
                await normalizer(
                    source
                );

            if (
                !normalized
            ) {
                summary.skipped +=
                    1;

                continue;
            }

            const result =
                await upsertDocument(
                    db,
                    canonicalCollection,
                    normalized,
                    options.dryRun
                );

            if (
                result.inserted
            ) {
                summary.inserted +=
                    1;
            } else {
                summary.existing +=
                    1;
            }
        } catch (error) {
            summary.errors +=
                1;

            summary.skipped +=
                1;

            if (
                summary.errorsSample.length <
                10
            ) {
                summary.errorsSample.push(
                    {
                        sourceId:
                            sourceId(
                                source
                            ),

                        error:
                            errorMessage(
                                error
                            ),
                    }
                );
            }

            console.warn(
                `[TITech][SaaS Migration] ${category} record ${sourceId(
                    source
                )} skipped: ${errorMessage(error)}`
            );

            if (
                options.failOnRecordErrors &&
                summary.errors >=
                    options.maxRecordErrors
            ) {
                throw new Error(
                    `[TITech][SaaS Migration] ${category} reached the configured record-error threshold of ${options.maxRecordErrors}.`
                );
            }
        }
    }

    summary.reconciliation = {
        sourceDocuments:
            sourceCount,

        processed:
            summary.scanned,

        inserted:
            summary.inserted,

        existing:
            summary.existing,

        skipped:
            summary.skipped,

        errors:
            summary.errors,

        balanced:
            summary.scanned ===
            (
                summary.inserted +
                summary.existing +
                summary.skipped
            ),
    };

    if (
        !summary.reconciliation.balanced
    ) {
        throw new Error(
            `[TITech][SaaS Migration] ${category} reconciliation failed: scanned=${summary.scanned}, inserted=${summary.inserted}, existing=${summary.existing}, skipped=${summary.skipped}.`
        );
    }

    return summary;
}

/**
 * =============================================================================
 * Main migration
 * =============================================================================
 */

async function migrate({
    mongoose,
    dryRun,
} = {}) {
    const mongo =
        mongoose ||
        mongooseDefault;

    const db =
        mongo.connection?.db;

    if (!db) {
        throw new Error(
            '[TITech][SaaS Migration] An active MongoDB connection is required.'
        );
    }

    const options =
        resolveOptions({
            dryRun,
        });

    /**
     * -------------------------------------------------------------------------
     * 0. Source discovery BEFORE mutation.
     * -------------------------------------------------------------------------
     */

    const discovery =
        await discoverSources(
            db,
            options
        );

    assertSourceDiscoverySafe(
        discovery,
        options
    );

    const {
        sources,
        sourceDetails,
    } =
        buildSourceSummary(
            discovery
        );

    console.log(
        '\n[TITech][SaaS Migration] Source discovery'
    );

    for (
        const category of
        SOURCE_CATEGORIES
    ) {
        const item =
            sourceDetails[
                category
            ];

        console.log(
            `  ${category}: status=${item.status} collection=${
                item.collectionName || 'NONE'
            } matchedBy=${
                item.matchedBy || 'NONE'
            } documents=${
                item.documentCount
            }`
        );
    }

    const lock =
        await acquireLock(
            db,
            options
        );

    const summary = {
        migration:
            MIGRATION_NAME,

        stage:
            MIGRATION_STAGE,

        dryRun:
            options.dryRun,

        startedAt:
            new Date(),

        sources,

        sourceDetails,

        canonical:
            CANONICAL,

        results:
            {},

        indexes:
            {},

        recordErrors:
            0,

        recordWarnings:
            0,
    };

    try {
        /**
         * ---------------------------------------------------------------------
         * 1. Canonical indexes.
         * ---------------------------------------------------------------------
         */

        if (
            !options.dryRun
        ) {
            summary.indexes.plans =
                await ensureIndexes(
                    db,
                    CANONICAL.plans,
                    INDEXES.plans
                );

            summary.indexes.subscriptions =
                await ensureIndexes(
                    db,
                    CANONICAL.subscriptions,
                    INDEXES.subscriptions
                );

            summary.indexes.invoices =
                await ensureIndexes(
                    db,
                    CANONICAL.invoices,
                    INDEXES.invoices
                );

            summary.indexes.usage =
                await ensureIndexes(
                    db,
                    CANONICAL.usage,
                    INDEXES.usage
                );
        }

        /**
         * ---------------------------------------------------------------------
         * 2. Plans.
         * ---------------------------------------------------------------------
         */

        summary.results.plans =
            await migrateCategory({
                db,

                sourceCollection:
                    sources.plans,

                canonicalCollection:
                    CANONICAL.plans,

                category:
                    'plans',

                options,

                normalizer:
                    async (
                        source
                    ) =>
                        normalizePlan(
                            source,
                            sources.plans
                        ),
            });

        /**
         * ---------------------------------------------------------------------
         * 3. Canonical plan maps.
         * ---------------------------------------------------------------------
         */

        const planMaps =
            options.dryRun
                ? {
                    byMigrationKey:
                        new Map(),

                    byCodeVersion:
                        new Map(),
                }
                : await collectCanonicalPlans(
                    db
                );

        /**
         * ---------------------------------------------------------------------
         * 4. Subscriptions.
         * ---------------------------------------------------------------------
         */

        summary.results.subscriptions =
            await migrateCategory({
                db,

                sourceCollection:
                    sources.subscriptions,

                canonicalCollection:
                    CANONICAL.subscriptions,

                category:
                    'subscriptions',

                options,

                normalizer:
                    async (
                        source
                    ) => {
                        const sourcePlanId =
                            source.planId;

                        const code =
                            normalizeCode(
                                source.planCode ||
                                source.plan?.code ||
                                'STARTER'
                            );

                        const version =
                            Math.max(
                                1,
                                Number.parseInt(
                                    String(
                                        source.planVersion ||
                                        source.plan?.version ||
                                        1
                                    ),
                                    10
                                ) || 1
                            );

                        let plan =
                            null;

                        if (
                            sourcePlanId
                        ) {
                            const sourcePlanKey =
                                migrationKey(
                                    sources.plans,
                                    {
                                        _id:
                                            sourcePlanId,
                                    }
                                );

                            plan =
                                planMaps
                                    .byMigrationKey
                                    .get(
                                        sourcePlanKey
                                    ) ||
                                    null;
                        }

                        if (
                            !plan &&
                            source.planCode
                        ) {
                            plan =
                                planMaps
                                    .byCodeVersion
                                    .get(
                                        `${code}:${version}`
                                    ) ||
                                    null;
                        }

                        if (
                            !options.dryRun &&
                            (
                                sourcePlanId ||
                                source.plan ||
                                source.planCode
                            ) &&
                            !plan
                        ) {
                            throw new Error(
                                `Canonical billing plan not found for subscription ${sourceId(
                                    source
                                )} (${code} v${version}). Legacy plan reference will not be copied into the canonical subscription.`
                            );
                        }

                        return normalizeSubscription(
                            source,
                            sources.subscriptions,
                            plan
                        );
                    },
            });

        /**
         * ---------------------------------------------------------------------
         * 5. Canonical subscription map.
         * ---------------------------------------------------------------------
         */

        const subscriptionMap =
            options.dryRun
                ? new Map()
                : await collectCanonicalSubscriptions(
                    db
                );

        /**
         * ---------------------------------------------------------------------
         * 6. Invoices.
         * ---------------------------------------------------------------------
         */

        summary.results.invoices =
            await migrateCategory({
                db,

                sourceCollection:
                    sources.invoices,

                canonicalCollection:
                    CANONICAL.invoices,

                category:
                    'invoices',

                options,

                normalizer:
                    async (
                        source
                    ) => {
                        let canonicalSubscription =
                            null;

                        if (
                            source.subscriptionId
                        ) {
                            canonicalSubscription =
                                subscriptionMap.get(
                                    migrationKey(
                                        sources.subscriptions,
                                        {
                                            _id:
                                                source.subscriptionId,
                                        }
                                    )
                                ) ||
                                null;

                            if (
                                !options.dryRun &&
                                !canonicalSubscription
                            ) {
                                throw new Error(
                                    `Canonical subscription not found for invoice ${sourceId(
                                        source
                                    )}. Legacy subscriptionId will not be copied into canonical billing data.`
                                );
                            }
                        }

                        return normalizeInvoice(
                            source,
                            sources.invoices,
                            canonicalSubscription?._id ||
                                null
                        );
                    },
            });

        /**
         * ---------------------------------------------------------------------
         * 7. Usage.
         * ---------------------------------------------------------------------
         */

        summary.results.usage =
            await migrateCategory({
                db,

                sourceCollection:
                    sources.usage,

                canonicalCollection:
                    CANONICAL.usage,

                category:
                    'usage',

                options,

                normalizer:
                    async (
                        source
                    ) => {
                        let canonicalSubscription =
                            null;

                        if (
                            source.subscriptionId
                        ) {
                            canonicalSubscription =
                                subscriptionMap.get(
                                    migrationKey(
                                        sources.subscriptions,
                                        {
                                            _id:
                                                source.subscriptionId,
                                        }
                                    )
                                ) ||
                                null;

                            if (
                                !options.dryRun &&
                                !canonicalSubscription
                            ) {
                                throw new Error(
                                    `Canonical subscription not found for usage record ${sourceId(
                                        source
                                    )}. Legacy subscriptionId will not be copied into canonical billing data.`
                                );
                            }
                        }

                        return normalizeUsage(
                            source,
                            sources.usage,
                            canonicalSubscription?._id ||
                                null
                        );
                    },
            });

        /**
         * ---------------------------------------------------------------------
         * 8. Restore subscription.lastInvoiceId.
         * ---------------------------------------------------------------------
         */

        if (
            !options.dryRun &&
            sources.invoices
        ) {
            const invoiceCursor =
                db
                    .collection(
                        CANONICAL.invoices
                    )
                    .find(
                        {
                            'metadata.migration.sourceCollection':
                                sources.invoices,
                        },
                        {
                            projection:
                                {
                                    _id:
                                        1,

                                    subscriptionId:
                                        1,

                                    createdAt:
                                        1,
                                },

                            sort:
                                {
                                    createdAt:
                                        -1,
                                },
                        }
                    );

            const updatedSubscriptions =
                new Set();

            while (
                await invoiceCursor.hasNext()
            ) {
                const invoice =
                    await invoiceCursor.next();

                if (
                    !invoice.subscriptionId
                ) {
                    continue;
                }

                const subscriptionKey =
                    String(
                        invoice.subscriptionId
                    );

                if (
                    updatedSubscriptions.has(
                        subscriptionKey
                    )
                ) {
                    continue;
                }

                updatedSubscriptions.add(
                    subscriptionKey
                );

                await db
                    .collection(
                        CANONICAL.subscriptions
                    )
                    .updateOne(
                        {
                            _id:
                                invoice.subscriptionId,

                            'metadata.migration.source':
                                MIGRATION_SOURCE,
                        },
                        {
                            $set:
                                {
                                    lastInvoiceId:
                                        invoice._id,

                                    updatedAt:
                                        new Date(),
                                },
                        }
                    );
            }
        }

        /**
         * ---------------------------------------------------------------------
         * 9. Aggregate errors.
         * ---------------------------------------------------------------------
         */

        summary.recordErrors =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .results[
                                category
                            ]
                            ?.errors ||
                        0
                    ),
                0
            );

        summary.recordWarnings =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .results[
                                category
                            ]
                            ?.skipped ||
                        0
                    ),
                0
            );

        /**
         * ---------------------------------------------------------------------
         * 10. Global reconciliation.
         * ---------------------------------------------------------------------
         */

        summary.totalScanned =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .results[
                                category
                            ]
                            ?.scanned ||
                        0
                    ),
                0
            );

        summary.totalInserted =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .results[
                                category
                            ]
                            ?.inserted ||
                        0
                    ),
                0
            );

        summary.totalExisting =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .results[
                                category
                            ]
                            ?.existing ||
                        0
                    ),
                0
            );

        summary.totalSkipped =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .results[
                                category
                            ]
                            ?.skipped ||
                        0
                    ),
                0
            );

        summary.reconciliation = {
            balanced:
                summary.totalScanned ===
                (
                    summary.totalInserted +
                    summary.totalExisting +
                    summary.totalSkipped
                ),

            scanned:
                summary.totalScanned,

            inserted:
                summary.totalInserted,

            existing:
                summary.totalExisting,

            skipped:
                summary.totalSkipped,

            recordErrors:
                summary.recordErrors,
        };

        if (
            !summary.reconciliation.balanced
        ) {
            throw new Error(
                '[TITech][SaaS Migration] Global reconciliation failed.'
            );
        }

        /**
         * ---------------------------------------------------------------------
         * 11. Final status.
         * ---------------------------------------------------------------------
         */

        summary.completedAt =
            new Date();

        const totalSourceDocuments =
            SOURCE_CATEGORIES.reduce(
                (
                    total,
                    category
                ) =>
                    total +
                    Number(
                        summary
                            .sourceDetails[
                                category
                            ]
                            ?.documentCount ||
                        0
                    ),
                0
            );

        if (
            totalSourceDocuments === 0
        ) {
            summary.status =
                'COMPLETED_NO_SOURCE_DATA';
        } else if (
            summary.recordErrors > 0
        ) {
            summary.status =
                options.failOnRecordErrors
                    ? 'FAILED'
                    : 'COMPLETED_WITH_RECORD_ERRORS';
        } else {
            summary.status =
                'COMPLETED';
        }

        if (
            summary.status ===
            'FAILED'
        ) {
            throw new Error(
                `[TITech][SaaS Migration] Migration completed with ${summary.recordErrors} record-level errors while FAIL_ON_RECORD_ERRORS=true.`
            );
        }

        await releaseLock(
            db,
            lock.lockToken,
            summary.status,
            summary
        );

        return summary;
    } catch (error) {
        summary.completedAt =
            new Date();

        summary.status =
            'FAILED';

        summary.error =
            errorMessage(
                error
            );

        await releaseLock(
            db,
            lock.lockToken,
            'FAILED',
            summary
        ).catch(
            (
                releaseError
            ) => {
                console.error(
                    '[TITech][SaaS Migration] Failed to release migration lock:',
                    errorMessage(
                        releaseError
                    )
                );
            }
        );

        throw error;
    }
}

/**
 * =============================================================================
 * Public Migration API
 * =============================================================================
 */

module.exports = {
    name:
        MIGRATION_NAME,

    description:
        'Additive TITech SaaS billing consolidation/backfill into canonical Commercial Billing collections.',

    up:
        async ({
            mongoose,
            dryRun,
        } = {}) =>
            migrate({
                mongoose:
                    mongoose ||
                    mongooseDefault,

                dryRun,
            }),

    down:
        async ({
            mongoose,
        } = {}) => {
            const mongo =
                mongoose ||
                mongooseDefault;

            const db =
                mongo.connection?.db;

            if (!db) {
                throw new Error(
                    '[TITech][SaaS Migration] An active MongoDB connection is required for logical rollback.'
                );
            }

            const rollbackTimestamp =
                new Date();

            await db
                .collection(
                    CANONICAL.migrationState
                )
                .updateOne(
                    {
                        _id:
                            MIGRATION_NAME,
                    },
                    {
                        $set:
                            {
                                stage:
                                    MIGRATION_STAGE,

                                status:
                                    'RELEASED',

                                rollbackMode:
                                    'LOGICAL_ONLY',

                                rolledBackAt:
                                    rollbackTimestamp,

                                updatedAt:
                                    rollbackTimestamp,

                                destructiveDataDeletion:
                                    false,

                                customerFinancialBalancesChanged:
                                    false,

                                financialLedgerChanged:
                                    false,

                                canonicalCollectionsRetained:
                                    true,
                            },

                        $unset:
                            {
                                lockToken:
                                    '',
                            },
                    },
                    {
                        upsert:
                            true,
                    }
                );

            return {
                migration:
                    MIGRATION_NAME,

                stage:
                    MIGRATION_STAGE,

                status:
                    'LOGICAL_ROLLBACK_ONLY',

                rollbackMode:
                    'LOGICAL_ONLY',

                destructiveDataDeletion:
                    false,

                customerFinancialBalancesChanged:
                    false,

                financialLedgerChanged:
                    false,

                canonicalCollectionsRetained:
                    true,

                recommendedOperationalAction:
                    'Return TITech SaaS billing to legacy/shadow mode using the established billing cut-over controls. Retain canonical records for audit/reconciliation until formal cleanup approval.',
            };
        },
};