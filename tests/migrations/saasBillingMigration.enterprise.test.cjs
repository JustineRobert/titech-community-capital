'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise SaaS Billing Migration Test Suite
 * =============================================================================
 *
 * File:
 *   tests/migrations/saasBillingMigration.enterprise.test.cjs
 *
 * Purpose:
 *   Enterprise regression and safety suite for Stage 01C TITech SaaS billing
 *   consolidation/backfill.
 *
 * Design:
 *   - Tests the migration through its public `up()` / `down()` API.
 *   - Uses an in-memory MongoDB-compatible test double.
 *   - Never connects to the developer's or production MongoDB instance.
 *   - Verifies migration safety invariants and relationship integrity.
 *   - Verifies runner/migration phase ownership separately.
 *
 * Coverage:
 *   1. Repository/migration artifact integrity
 *   2. Runner versus migration phase contract
 *   3. Public migration API
 *   4. Empty source behavior
 *   5. Known legacy source discovery
 *   6. Explicit source collection override
 *   7. Source-schema validation through migration behavior
 *   8. Canonical index conflict protection
 *   9. Canonical index creation
 *  10. Full plan/subscription/invoice/usage migration
 *  11. Canonical relationship integrity
 *  12. Rerun/idempotency
 *  13. Invalid invoice relationship protection
 *  14. Strict record-error threshold
 *  15. Dry-run no-write contract
 *  16. Logical rollback safety
 *  17. Financial-core non-mutation
 *  18. Migration-state persistence contract
 *  19. Ambiguous source discovery TODO
 *
 * Execute from repository root:
 *
 *   node --test tests/migrations/saasBillingMigration.enterprise.test.cjs
 *
 * =============================================================================
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

/**
 * Resolve Mongoose from the nested backend project.
 *
 * The repository root is ESM, while the backend migration stack is CommonJS.
 */
const mongoose = require(
    require.resolve(
        'mongoose',
        {
            paths: [
                path.resolve(
                    __dirname,
                    '../../community-savings-app-backend'
                ),
            ],
        }
    )
);

/**
 * =============================================================================
 * Repository paths
 * =============================================================================
 *
 * Repository:
 *
 *   society-community-savings-app/
 *   ├── package.json
 *   ├── tests/
 *   │   └── migrations/
 *   │       └── this-file.cjs
 *   └── community-savings-app-backend/
 *       ├── package.json
 *       ├── migrations/
 *       └── scripts/
 *           └── commercial/
 *
 * =============================================================================
 */

const backendRoot = path.resolve(
    __dirname,
    '../../community-savings-app-backend'
);

const migrationFile = path.resolve(
    backendRoot,
    'migrations',
    '20260830_120000_consolidate_titech_saas_billing.js'
);

const runnerFile = path.resolve(
    backendRoot,
    'scripts',
    'commercial',
    'runSaasBillingMigration.js'
);

/**
 * =============================================================================
 * Enterprise contract constants
 * =============================================================================
 */

const MIGRATION_NAME =
    '20260830_120000_consolidate_titech_saas_billing';

const MIGRATION_STAGE =
    '01C';

const EXPECTED_RUNNER_PHASES = [
    'PHASE_00_ENVIRONMENT_VALIDATION',
    'PHASE_01_DATABASE_CONNECTIVITY',
];

const EXPECTED_MIGRATION_PHASES = [
    'PHASE_02_SOURCE_DISCOVERY',
    'PHASE_03_SOURCE_SCHEMA_VALIDATION',
    'PHASE_04_DESTINATION_VALIDATION',
    'PHASE_05_INDEX_VALIDATION',
    'PHASE_06_RECORD_MIGRATION',
    'PHASE_07_RECONCILIATION',
    'PHASE_08_MIGRATION_STATE_COMMIT',
    'PHASE_09_FINAL_VERIFICATION',
];

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

const SOURCE_COLLECTIONS = Object.freeze({
    plans:
        'billingplans',

    subscriptions:
        'tenantsubscriptions',

    invoices:
        'invoices',

    usage:
        'usagerecords',
});

const SOURCE_ENV_KEYS = [
    'TITECH_LEGACY_BILLING_PLANS_COLLECTION',
    'TITECH_LEGACY_SUBSCRIPTIONS_COLLECTION',
    'TITECH_LEGACY_INVOICES_COLLECTION',
    'TITECH_LEGACY_USAGE_COLLECTION',

    'TITECH_SAAS_BILLING_MIGRATION_DRY_RUN',
    'TITECH_SAAS_BILLING_MIGRATION_BATCH_SIZE',
    'TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS',
    'TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS',
    'TITECH_SAAS_BILLING_MIGRATION_LOCK_LEASE_MS',
    'TITECH_SAAS_BILLING_MIGRATION_SCHEMA_SAMPLE_SIZE',

    'NODE_ENV',
];

/**
 * =============================================================================
 * General helpers
 * =============================================================================
 */

function objectId(seed) {
    return new mongoose.Types.ObjectId(
        String(seed)
            .padStart(
                24,
                '0'
            )
            .slice(-24)
    );
}

function cloneValue(value) {
    if (
        value === undefined
    ) {
        return undefined;
    }

    if (
        value instanceof Date
    ) {
        return new Date(
            value.getTime()
        );
    }

    if (
        value instanceof mongoose.Types.ObjectId
    ) {
        return new mongoose.Types.ObjectId(
            value.toHexString()
        );
    }

    if (
        value instanceof mongoose.Types.Decimal128
    ) {
        return mongoose.Types.Decimal128.fromString(
            value.toString()
        );
    }

    if (
        Array.isArray(value)
    ) {
        return value.map(
            cloneValue
        );
    }

    if (
        value &&
        typeof value === 'object'
    ) {
        return Object.fromEntries(
            Object.entries(
                value
            ).map(
                ([key, item]) => [
                    key,
                    cloneValue(
                        item
                    ),
                ]
            )
        );
    }

    return value;
}

function valuesEqual(
    left,
    right
) {
    if (
        left instanceof mongoose.Types.ObjectId
    ) {
        return (
            right instanceof mongoose.Types.ObjectId &&
            left.equals(
                right
            )
        );
    }

    if (
        right instanceof mongoose.Types.ObjectId
    ) {
        return false;
    }

    if (
        left instanceof mongoose.Types.Decimal128
    ) {
        return (
            right instanceof mongoose.Types.Decimal128 &&
            left.toString() ===
                right.toString()
        );
    }

    if (
        right instanceof mongoose.Types.Decimal128
    ) {
        return false;
    }

    if (
        left instanceof Date &&
        right instanceof Date
    ) {
        return (
            left.getTime() ===
            right.getTime()
        );
    }

    if (
        Array.isArray(left) &&
        Array.isArray(right)
    ) {
        return (
            left.length ===
                right.length &&
            left.every(
                (
                    item,
                    index
                ) =>
                    valuesEqual(
                        item,
                        right[
                            index
                        ]
                    )
            )
        );
    }

    if (
        left &&
        typeof left ===
            'object' &&
        right &&
        typeof right ===
            'object'
    ) {
        const leftKeys =
            Object.keys(
                left
            );

        const rightKeys =
            Object.keys(
                right
            );

        if (
            leftKeys.length !==
            rightKeys.length
        ) {
            return false;
        }

        return leftKeys.every(
            (key) =>
                Object.prototype.hasOwnProperty.call(
                    right,
                    key
                ) &&
                valuesEqual(
                    left[key],
                    right[key]
                )
        );
    }

    return left === right;
}

function getPathValue(
    document,
    pathExpression
) {
    const parts =
        String(
            pathExpression
        ).split('.');

    let current =
        document;

    for (
        const part of parts
    ) {
        if (
            current === null ||
            current === undefined
        ) {
            return undefined;
        }

        current =
            current[
                part
            ];
    }

    return current;
}

function setPathValue(
    document,
    pathExpression,
    value
) {
    const parts =
        String(
            pathExpression
        ).split('.');

    let current =
        document;

    for (
        let index = 0;
        index <
            parts.length - 1;
        index += 1
    ) {
        const part =
            parts[index];

        if (
            !current[part] ||
            typeof current[part] !==
                'object'
        ) {
            current[part] = {};
        }

        current =
            current[part];
    }

    current[
        parts[
            parts.length - 1
        ]
    ] = cloneValue(
        value
    );
}

function unsetPathValue(
    document,
    pathExpression
) {
    const parts =
        String(
            pathExpression
        ).split('.');

    let current =
        document;

    for (
        let index = 0;
        index <
            parts.length - 1;
        index += 1
    ) {
        current =
            current?.[
                parts[index]
            ];

        if (
            !current ||
            typeof current !==
                'object'
        ) {
            return;
        }
    }

    delete current[
        parts[
            parts.length - 1
        ]
    ];
}

/**
 * =============================================================================
 * Mongo query support for test double
 * =============================================================================
 */

function matchesOperator(
    actual,
    operator,
    expected
) {
    switch (
        operator
    ) {
        case '$exists':
            return expected
                ? actual !== undefined
                : actual === undefined;

        case '$lte':
            return (
                actual !== undefined &&
                actual <= expected
            );

        case '$in':
            return expected.some(
                (candidate) =>
                    valuesEqual(
                        actual,
                        candidate
                    )
            );

        case '$type':
            if (
                expected ===
                'string'
            ) {
                return (
                    typeof actual ===
                    'string'
                );
            }

            return true;

        default:
            throw new Error(
                `Unsupported mock Mongo operator: ${operator}`
            );
    }
}

function matchesQuery(
    document,
    query = {}
) {
    for (
        const [
            key,
            condition,
        ] of Object.entries(
            query
        )
    ) {
        if (
            key === '$or'
        ) {
            if (
                !condition.some(
                    (subQuery) =>
                        matchesQuery(
                            document,
                            subQuery
                        )
                )
            ) {
                return false;
            }

            continue;
        }

        const actual =
            getPathValue(
                document,
                key
            );

        if (
            condition &&
            typeof condition ===
                'object' &&
            !Array.isArray(
                condition
            ) &&
            !(condition instanceof Date) &&
            !(condition instanceof mongoose.Types.ObjectId) &&
            !(condition instanceof mongoose.Types.Decimal128)
        ) {
            const conditionKeys =
                Object.keys(
                    condition
                );

            const hasOperator =
                conditionKeys.some(
                    (operator) =>
                        operator.startsWith(
                            '$'
                        )
                );

            if (
                hasOperator
            ) {
                for (
                    const operator of
                    conditionKeys
                ) {
                    if (
                        !matchesOperator(
                            actual,
                            operator,
                            condition[
                                operator
                            ]
                        )
                    ) {
                        return false;
                    }
                }

                continue;
            }
        }

        if (
            !valuesEqual(
                actual,
                condition
            )
        ) {
            return false;
        }
    }

    return true;
}

function applyProjection(
    document,
    projection
) {
    if (
        !projection
    ) {
        return cloneValue(
            document
        );
    }

    const includeFields =
        Object.entries(
            projection
        )
            .filter(
                ([, value]) =>
                    value === 1
            )
            .map(
                ([key]) =>
                    key
            );

    if (
        includeFields.length ===
        0
    ) {
        return cloneValue(
            document
        );
    }

    const projected = {};

    for (
        const field of
        includeFields
    ) {
        const value =
            getPathValue(
                document,
                field
            );

        if (
            value === undefined
        ) {
            continue;
        }

        setPathValue(
            projected,
            field,
            value
        );
    }

    return projected;
}

/**
 * =============================================================================
 * Mock cursor
 * =============================================================================
 */

function createCursor(
    records,
    options = {}
) {
    let current =
        records.map(
            cloneValue
        );

    if (
        options.sort
    ) {
        const [
            [
                field,
                direction,
            ],
        ] =
            Object.entries(
                options.sort
            );

        current.sort(
            (
                left,
                right
            ) => {
                const a =
                    getPathValue(
                        left,
                        field
                    );

                const b =
                    getPathValue(
                        right,
                        field
                    );

                if (
                    valuesEqual(
                        a,
                        b
                    )
                ) {
                    return 0;
                }

                return a > b
                    ? direction
                    : -direction;
            }
        );
    }

    if (
        options.projection
    ) {
        current =
            current.map(
                (document) =>
                    applyProjection(
                        document,
                        options.projection
                    )
            );
    }

    const cursor = {
        index:
            0,

        async hasNext() {
            return (
                cursor.index <
                current.length
            );
        },

        async next() {
            if (
                cursor.index >=
                current.length
            ) {
                throw new Error(
                    'Mock cursor exhausted.'
                );
            }

            return cloneValue(
                current[
                    cursor.index++
                ]
            );
        },

        async toArray() {
            return current.map(
                cloneValue
            );
        },

        limit(
            limitValue
        ) {
            current =
                current.slice(
                    0,
                    limitValue
                );

            return cursor;
        },
    };

    return cursor;
}

/**
 * =============================================================================
 * Mock MongoDB collection
 * =============================================================================
 */

function createCollection({
    name,
    documents = [],
    indexes = [],
    failOn = {},
} = {}) {
    const records =
        documents.map(
            cloneValue
        );

    const indexMap =
        new Map(
            indexes.map(
                (index) => [
                    index.name,
                    cloneValue(
                        index
                    ),
                ]
            )
        );

    const operations = [];

    function failIfConfigured(
        operation
    ) {
        const configured =
            failOn[
                operation
            ];

        if (
            !configured
        ) {
            return;
        }

        if (
            configured instanceof
            Error
        ) {
            throw configured;
        }

        throw new Error(
            String(
                configured
            )
        );
    }

    function buildUpsertDocument(
        filter,
        update
    ) {
        const created = {};

        for (
            const [
                key,
                value,
            ] of Object.entries(
                filter
            )
        ) {
            if (
                key.startsWith(
                    '$'
                )
            ) {
                continue;
            }

            if (
                value &&
                typeof value ===
                    'object' &&
                !Array.isArray(
                    value
                ) &&
                !(value instanceof Date) &&
                !(value instanceof mongoose.Types.ObjectId) &&
                !(value instanceof mongoose.Types.Decimal128) &&
                Object.keys(
                    value
                ).some(
                    (operator) =>
                        operator.startsWith(
                            '$'
                        )
                )
            ) {
                continue;
            }

            setPathValue(
                created,
                key,
                value
            );
        }

        if (
            update.$setOnInsert
        ) {
            Object.assign(
                created,
                cloneValue(
                    update.$setOnInsert
                )
            );
        }

        if (
            update.$set
        ) {
            Object.assign(
                created,
                cloneValue(
                    update.$set
                )
            );
        }

        if (
            !created._id
        ) {
            created._id =
                new mongoose.Types.ObjectId();
        }

        return created;
    }

    return {
        operations,

        _records:
            records,

        _indexes:
            indexMap,

        async countDocuments(
            query = {}
        ) {
            failIfConfigured(
                'countDocuments'
            );

            return records.filter(
                (document) =>
                    matchesQuery(
                        document,
                        query
                    )
            ).length;
        },

        async estimatedDocumentCount() {
            failIfConfigured(
                'estimatedDocumentCount'
            );

            return records.length;
        },

        async findOne(
            query = {},
            options = {}
        ) {
            failIfConfigured(
                'findOne'
            );

            const document =
                records.find(
                    (candidate) =>
                        matchesQuery(
                            candidate,
                            query
                        )
                );

            return document
                ? applyProjection(
                    document,
                    options.projection
                )
                : null;
        },

        find(
            query = {},
            options = {}
        ) {
            const matched =
                records.filter(
                    (document) =>
                        matchesQuery(
                            document,
                            query
                        )
                );

            return createCursor(
                matched,
                options
            );
        },

        async indexes() {
            failIfConfigured(
                'indexes'
            );

            return [
                ...indexMap.values(),
            ].map(
                cloneValue
            );
        },

        async createIndex(
            key,
            options = {}
        ) {
            failIfConfigured(
                'createIndex'
            );

            const index = {
                name:
                    options.name,

                key:
                    cloneValue(
                        key
                    ),

                ...cloneValue(
                    options
                ),
            };

            indexMap.set(
                index.name,
                index
            );

            operations.push({
                type:
                    'createIndex',

                index:
                    cloneValue(
                        index
                    ),
            });

            return index.name;
        },

        async updateOne(
            filter,
            update,
            options = {}
        ) {
            failIfConfigured(
                'updateOne'
            );

            operations.push({
                type:
                    'updateOne',

                filter:
                    cloneValue(
                        filter
                    ),

                update:
                    cloneValue(
                        update
                    ),

                options:
                    cloneValue(
                        options
                    ),
            });

            const index =
                records.findIndex(
                    (document) =>
                        matchesQuery(
                            document,
                            filter
                        )
                );

            if (
                index < 0 &&
                options.upsert
            ) {
                const created =
                    buildUpsertDocument(
                        filter,
                        update
                    );

                records.push(
                    created
                );

                return {
                    acknowledged:
                        true,

                    matchedCount:
                        0,

                    modifiedCount:
                        0,

                    upsertedCount:
                        1,

                    upsertedId:
                        created._id,
                };
            }

            if (
                index >= 0
            ) {
                if (
                    update.$set
                ) {
                    for (
                        const [
                            key,
                            value,
                        ] of Object.entries(
                            update.$set
                        )
                    ) {
                        setPathValue(
                            records[
                                index
                            ],
                            key,
                            value
                        );
                    }
                }

                if (
                    update.$unset
                ) {
                    for (
                        const key of
                        Object.keys(
                            update.$unset
                        )
                    ) {
                        unsetPathValue(
                            records[
                                index
                            ],
                            key
                        );
                    }
                }

                return {
                    acknowledged:
                        true,

                    matchedCount:
                        1,

                    modifiedCount:
                        1,

                    upsertedCount:
                        0,
                };
            }

            return {
                acknowledged:
                    true,

                matchedCount:
                    0,

                modifiedCount:
                    0,

                upsertedCount:
                    0,
            };
        },

        async findOneAndUpdate(
            filter,
            update,
            options = {}
        ) {
            failIfConfigured(
                'findOneAndUpdate'
            );

            operations.push({
                type:
                    'findOneAndUpdate',

                filter:
                    cloneValue(
                        filter
                    ),

                update:
                    cloneValue(
                        update
                    ),

                options:
                    cloneValue(
                        options
                    ),
            });

            let index =
                records.findIndex(
                    (document) =>
                        matchesQuery(
                            document,
                            filter
                        )
                );

            if (
                index < 0 &&
                options.upsert
            ) {
                const created = {};

                for (
                    const [
                        key,
                        value,
                    ] of Object.entries(
                        filter
                    )
                ) {
                    if (
                        key.startsWith(
                            '$'
                        )
                    ) {
                        continue;
                    }

                    if (
                        value &&
                        typeof value ===
                            'object' &&
                        !Array.isArray(
                            value
                        ) &&
                        !(value instanceof Date) &&
                        !(value instanceof mongoose.Types.ObjectId) &&
                        !(value instanceof mongoose.Types.Decimal128) &&
                        Object.keys(
                            value
                        ).some(
                            (operator) =>
                                operator.startsWith(
                                    '$'
                                )
                        )
                    ) {
                        continue;
                    }

                    setPathValue(
                        created,
                        key,
                        value
                    );
                }

                if (
                    update.$set
                ) {
                    Object.assign(
                        created,
                        cloneValue(
                            update.$set
                        )
                    );
                }

                if (
                    !created._id
                ) {
                    created._id =
                        new mongoose.Types.ObjectId();
                }

                records.push(
                    created
                );

                index =
                    records.length - 1;
            } else if (
                index >= 0
            ) {
                if (
                    update.$set
                ) {
                    Object.assign(
                        records[
                            index
                        ],
                        cloneValue(
                            update.$set
                        )
                    );
                }

                if (
                    update.$unset
                ) {
                    for (
                        const key of
                        Object.keys(
                            update.$unset
                        )
                    ) {
                        unsetPathValue(
                            records[
                                index
                            ],
                            key
                        );
                    }
                }
            }

            return {
                value:
                    index >= 0
                        ? cloneValue(
                            records[
                                index
                            ]
                        )
                        : null,
            };
        },
    };
}

/**
 * =============================================================================
 * Mock MongoDB database
 * =============================================================================
 */

function createDb(
    definitions = {}
) {
    const collections =
        new Map();

    for (
        const [
            name,
            definition,
        ] of Object.entries(
            definitions
        )
    ) {
        collections.set(
            name,
            definition
        );
    }

    return {
        databaseName:
            'community_savings_test',

        collection(
            name
        ) {
            if (
                !collections.has(
                    name
                )
            ) {
                collections.set(
                    name,
                    createCollection({
                        name,
                    })
                );
            }

            return collections.get(
                name
            );
        },

        listCollections() {
            return {
                toArray:
                    async () =>
                        [
                            ...collections.keys(),
                        ].map(
                            (name) => ({
                                name,
                            })
                        ),
            };
        },

        async command() {
            return {
                ok:
                    1,
            };
        },

        _collections:
            collections,
    };
}

function createMongo(
    db
) {
    return {
        connection:
            {
                readyState:
                    1,

                db,
            },
    };
}

/**
 * =============================================================================
 * Environment helpers
 * =============================================================================
 */

function clearMigrationEnvironment() {
    for (
        const key of
        SOURCE_ENV_KEYS
    ) {
        delete process.env[
            key
        ];
    }
}

async function withEnvironment(
    values,
    callback
) {
    const previous =
        new Map();

    for (
        const key of
        Object.keys(
            values
        )
    ) {
        previous.set(
            key,
            process.env[key]
        );

        if (
            values[key] ===
            undefined
        ) {
            delete process.env[
                key
            ];
        } else {
            process.env[
                key
            ] =
                String(
                    values[key]
                );
        }
    }

    try {
        return await callback();
    } finally {
        for (
            const [
                key,
                value,
            ] of previous
        ) {
            if (
                value ===
                undefined
            ) {
                delete process.env[
                    key
                ];
            } else {
                process.env[
                    key
                ] = value;
            }
        }
    }
}

/**
 * =============================================================================
 * Fixture builders
 * =============================================================================
 */

function validTenantId() {
    return objectId(
        '1'
    );
}

function validPlan(
    overrides = {}
) {
    return {
        _id:
            objectId(
                '10'
            ),

        code:
            'STARTER',

        name:
            'Starter',

        tier:
            'STARTER',

        version:
            1,

        price:
            '10000',

        currency:
            'UGX',

        billingCycle:
            'MONTHLY',

        trialDays:
            14,

        isPublic:
            true,

        isActive:
            true,

        createdAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        updatedAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        ...overrides,
    };
}

function validSubscription(
    overrides = {}
) {
    return {
        _id:
            objectId(
                '20'
            ),

        tenantId:
            validTenantId(),

        planId:
            objectId(
                '10'
            ),

        planCode:
            'STARTER',

        planVersion:
            1,

        status:
            'active',

        billingInterval:
            'MONTHLY',

        currency:
            'UGX',

        unitAmount:
            '10000',

        quantity:
            1,

        currentPeriodStart:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        currentPeriodEnd:
            new Date(
                '2026-09-01T00:00:00.000Z'
            ),

        createdAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        updatedAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        ...overrides,
    };
}

function validInvoice(
    overrides = {}
) {
    return {
        _id:
            objectId(
                '30'
            ),

        tenantId:
            validTenantId(),

        subscriptionId:
            objectId(
                '20'
            ),

        invoiceNumber:
            'INV-0001',

        total:
            '10000',

        subtotal:
            '10000',

        discount:
            '0',

        tax:
            '0',

        amountPaid:
            '0',

        amountDue:
            '10000',

        currency:
            'UGX',

        status:
            'pending',

        periodStart:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        periodEnd:
            new Date(
                '2026-09-01T00:00:00.000Z'
            ),

        dueDate:
            new Date(
                '2026-09-01T00:00:00.000Z'
            ),

        createdAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        updatedAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        ...overrides,
    };
}

function validUsage(
    overrides = {}
) {
    return {
        _id:
            objectId(
                '40'
            ),

        tenantId:
            validTenantId(),

        subscriptionId:
            objectId(
                '20'
            ),

        meterType:
            'API_CALL',

        meterCode:
            'API_CALL',

        quantity:
            '3',

        source:
            'legacy',

        sourceReference:
            'usage-1',

        periodStart:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        periodEnd:
            new Date(
                '2026-09-01T00:00:00.000Z'
            ),

        recordedAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        createdAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        updatedAt:
            new Date(
                '2026-08-01T00:00:00.000Z'
            ),

        ...overrides,
    };
}

function fullSourceDb() {
    return createDb({
        [SOURCE_COLLECTIONS.plans]:
            createCollection({
                name:
                    SOURCE_COLLECTIONS.plans,

                documents:
                    [
                        validPlan(),
                    ],
            }),

        [SOURCE_COLLECTIONS.subscriptions]:
            createCollection({
                name:
                    SOURCE_COLLECTIONS.subscriptions,

                documents:
                    [
                        validSubscription(),
                    ],
            }),

        [SOURCE_COLLECTIONS.invoices]:
            createCollection({
                name:
                    SOURCE_COLLECTIONS.invoices,

                documents:
                    [
                        validInvoice(),
                    ],
            }),

        [SOURCE_COLLECTIONS.usage]:
            createCollection({
                name:
                    SOURCE_COLLECTIONS.usage,

                documents:
                    [
                        validUsage(),
                    ],
            }),
    });
}

function loadMigrationFresh() {
    delete require.cache[
        require.resolve(
            migrationFile
        )
    ];

    return require(
        migrationFile
    );
}

/**
 * =============================================================================
 * Test setup
 * =============================================================================
 */

test.beforeEach(
    () => {
        clearMigrationEnvironment();
    }
);

test.afterEach(
    () => {
        clearMigrationEnvironment();
    }
);

/**
 * =============================================================================
 * 01 — Artifact and phase contract
 * =============================================================================
 */

test(
    'migration and runner contain their respective enterprise phase contracts',
    () => {
        assert.equal(
            fs.existsSync(
                migrationFile
            ),
            true,
            `Missing migration file: ${migrationFile}`
        );

        assert.equal(
            fs.existsSync(
                runnerFile
            ),
            true,
            `Missing migration runner: ${runnerFile}`
        );

        const migrationSource =
            fs.readFileSync(
                migrationFile,
                'utf8'
            );

        const runnerSource =
            fs.readFileSync(
                runnerFile,
                'utf8'
            );

        /**
         * Bootstrap/environment/database connectivity belongs to the runner.
         */
        for (
            const phase of
            EXPECTED_RUNNER_PHASES
        ) {
            assert.match(
                runnerSource,
                new RegExp(
                    phase
                ),
                `Runner missing ${phase}`
            );
        }

        /**
         * Source discovery through final verification belongs to the migration.
         */
        for (
            const phase of
            EXPECTED_MIGRATION_PHASES
        ) {
            assert.match(
                migrationSource,
                new RegExp(
                    phase
                ),
                `Migration missing ${phase}`
            );
        }

        const migration =
            loadMigrationFresh();

        assert.equal(
            migration.name,
            MIGRATION_NAME
        );

        assert.equal(
            migration.stage,
            MIGRATION_STAGE
        );
    }
);

/**
 * =============================================================================
 * 02 — Public migration API
 * =============================================================================
 */

test(
    'migration exposes the expected public up/down API',
    () => {
        const migration =
            loadMigrationFresh();

        assert.equal(
            typeof migration.up,
            'function'
        );

        assert.equal(
            typeof migration.down,
            'function'
        );

        assert.equal(
            migration.name,
            MIGRATION_NAME
        );

        assert.equal(
            migration.stage,
            MIGRATION_STAGE
        );
    }
);

/**
 * =============================================================================
 * 03 — Empty source
 * =============================================================================
 */

test(
    'empty-source migration is explicit and scans zero source records',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            createDb();

        const result =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    false,
            });

        assert.equal(
            result.sources.plans,
            null
        );

        assert.equal(
            result.sources.subscriptions,
            null
        );

        assert.equal(
            result.sources.invoices,
            null
        );

        assert.equal(
            result.sources.usage,
            null
        );

        for (
            const category of
            [
                'plans',
                'subscriptions',
                'invoices',
                'usage',
            ]
        ) {
            assert.equal(
                result.results[
                    category
                ].scanned,
                0
            );

            assert.equal(
                result.results[
                    category
                ].inserted,
                0
            );

            assert.equal(
                result.results[
                    category
                ].existing,
                0
            );

            assert.equal(
                result.results[
                    category
                ].errors,
                0
            );
        }
    }
);

/**
 * =============================================================================
 * 04 — Known source discovery
 * =============================================================================
 */

test(
    'known legacy SaaS billing collections are discovered',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        const result =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    true,
            });

        assert.equal(
            result.sources.plans,
            SOURCE_COLLECTIONS.plans
        );

        assert.equal(
            result.sources.subscriptions,
            SOURCE_COLLECTIONS.subscriptions
        );

        assert.equal(
            result.sources.invoices,
            SOURCE_COLLECTIONS.invoices
        );

        assert.equal(
            result.sources.usage,
            SOURCE_COLLECTIONS.usage
        );

        assert.equal(
            result.results.plans.scanned,
            1
        );

        assert.equal(
            result.results.subscriptions.scanned,
            1
        );

        assert.equal(
            result.results.invoices.scanned,
            1
        );

        assert.equal(
            result.results.usage.scanned,
            1
        );
    }
);

/**
 * =============================================================================
 * 05 — Explicit source override
 * =============================================================================
 */

test(
    'explicit source collection configuration overrides default candidates',
    async () => {
        await withEnvironment(
            {
                TITECH_LEGACY_BILLING_PLANS_COLLECTION:
                    'custom_plan_catalog',
            },
            async () => {
                const migration =
                    loadMigrationFresh();

                const db =
                    createDb({
                        billingplans:
                            createCollection({
                                name:
                                    'billingplans',

                                documents:
                                    [
                                        validPlan(),
                                    ],
                            }),

                        custom_plan_catalog:
                            createCollection({
                                name:
                                    'custom_plan_catalog',

                                documents:
                                    [
                                        validPlan({
                                            _id:
                                                objectId(
                                                    '11'
                                                ),
                                        }),
                                    ],
                            }),
                    });

                const result =
                    await migration.up({
                        mongoose:
                            createMongo(
                                db
                            ),

                        dryRun:
                            true,
                    });

                assert.equal(
                    result.sources.plans,
                    'custom_plan_catalog'
                );

                assert.equal(
                    result.results.plans.scanned,
                    1
                );
            }
        );
    }
);

/**
 * =============================================================================
 * 06 — Source schema validation through migration behavior
 * =============================================================================
 */

test(
    'subscription missing tenantId is rejected under strict record-error mode',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            createDb({
                billingplans:
                    createCollection({
                        name:
                            'billingplans',

                        documents:
                            [
                                validPlan(),
                            ],
                    }),

                tenantsubscriptions:
                    createCollection({
                        name:
                            'tenantsubscriptions',

                        documents:
                            [
                                validSubscription({
                                    tenantId:
                                        undefined,
                                }),
                            ],
                    }),
            });

        await withEnvironment(
            {
                TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS:
                    'true',

                TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS:
                    '1',
            },
            async () => {
                await assert.rejects(
                    () =>
                        migration.up({
                            mongoose:
                                createMongo(
                                    db
                                ),

                            dryRun:
                                false,
                        }),
                    /Subscription tenantId is required|record-error threshold/i
                );
            }
        );
    }
);

/**
 * =============================================================================
 * 07 — Canonical index conflict
 * =============================================================================
 */

test(
    'conflicting canonical index definitions are never silently replaced',
    async () => {
        const migration =
            loadMigrationFresh();

        const conflictingIndex =
            {
                name:
                    'uniq_titech_billing_plan_code_version',

                key:
                    {
                        code:
                            1,

                        version:
                            -1,
                    },

                unique:
                    true,
            };

        const plans =
            createCollection({
                name:
                    CANONICAL.plans,

                indexes:
                    [
                        conflictingIndex,
                    ],
            });

        const db =
            createDb({
                [CANONICAL.plans]:
                    plans,
            });

        await assert.rejects(
            () =>
                migration.up({
                    mongoose:
                        createMongo(
                            db
                        ),

                    dryRun:
                        false,
                }),
            /conflicting index|index validation|will not replace|will not modify/i
        );

        assert.equal(
            plans.operations.some(
                (operation) =>
                    operation.type ===
                    'createIndex'
            ),
            false
        );
    }
);

/**
 * =============================================================================
 * 08 — Canonical index creation
 * =============================================================================
 */

test(
    'apply mode creates the canonical billing indexes',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        const result =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    false,
            });

        assert.ok(
            result.indexes,
            'Migration must return index reconciliation results'
        );

        for (
            const category of
            [
                'plans',
                'subscriptions',
                'invoices',
                'usage',
            ]
        ) {
            assert.ok(
                Array.isArray(
                    result.indexes[
                        category
                    ]
                ),
                `${category} index result must be an array`
            );
        }

        assert.ok(
            db.collection(
                CANONICAL.plans
            )._indexes.size >=
                2
        );

        assert.ok(
            db.collection(
                CANONICAL.subscriptions
            )._indexes.size >=
                2
        );

        assert.ok(
            db.collection(
                CANONICAL.invoices
            )._indexes.size >=
                3
        );

        assert.ok(
            db.collection(
                CANONICAL.usage
            )._indexes.size >=
                2
        );
    }
);

/**
 * =============================================================================
 * 09 — Full migration
 * =============================================================================
 */

test(
    'full migration creates canonical plans, subscriptions, invoices and usage',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        const result =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    false,
            });

        assert.equal(
            result.status,
            'COMPLETED'
        );

        assert.equal(
            result.recordErrors,
            0
        );

        assert.equal(
            result.results.plans.inserted,
            1
        );

        assert.equal(
            result.results.subscriptions.inserted,
            1
        );

        assert.equal(
            result.results.invoices.inserted,
            1
        );

        assert.equal(
            result.results.usage.inserted,
            1
        );

        assert.equal(
            db.collection(
                CANONICAL.plans
            )._records.length,
            1
        );

        assert.equal(
            db.collection(
                CANONICAL.subscriptions
            )._records.length,
            1
        );

        assert.equal(
            db.collection(
                CANONICAL.invoices
            )._records.length,
            1
        );

        assert.equal(
            db.collection(
                CANONICAL.usage
            )._records.length,
            1
        );
    }
);

/**
 * =============================================================================
 * 10 — Canonical relationship integrity
 * =============================================================================
 */

test(
    'canonical relationships never leak legacy parent ObjectIds',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        await migration.up({
            mongoose:
                createMongo(
                    db
                ),

            dryRun:
                false,
        });

        const canonicalPlan =
            db.collection(
                CANONICAL.plans
            )._records[0];

        const canonicalSubscription =
            db.collection(
                CANONICAL.subscriptions
            )._records[0];

        const canonicalInvoice =
            db.collection(
                CANONICAL.invoices
            )._records[0];

        const canonicalUsage =
            db.collection(
                CANONICAL.usage
            )._records[0];

        assert.ok(
            canonicalPlan
        );

        assert.ok(
            canonicalSubscription
        );

        assert.ok(
            canonicalInvoice
        );

        assert.ok(
            canonicalUsage
        );

        /**
         * Subscription → plan must resolve to canonical plan.
         */
        assert.ok(
            canonicalSubscription.planId
        );

        assert.equal(
            canonicalSubscription.planId.toString(),
            canonicalPlan._id.toString()
        );

        assert.notEqual(
            canonicalSubscription.planId.toString(),
            validPlan()._id.toString()
        );

        /**
         * Invoice → subscription must resolve to canonical subscription.
         */
        assert.ok(
            canonicalInvoice.subscriptionId
        );

        assert.equal(
            canonicalInvoice.subscriptionId.toString(),
            canonicalSubscription._id.toString()
        );

        assert.notEqual(
            canonicalInvoice.subscriptionId.toString(),
            validSubscription()
                ._id
                .toString()
        );

        /**
         * Usage → subscription must resolve to canonical subscription.
         */
        assert.ok(
            canonicalUsage.subscriptionId
        );

        assert.equal(
            canonicalUsage.subscriptionId.toString(),
            canonicalSubscription._id.toString()
        );

        assert.notEqual(
            canonicalUsage.subscriptionId.toString(),
            validSubscription()
                ._id
                .toString()
        );

        /**
         * Provenance remains preserved.
         */
        assert.equal(
            canonicalSubscription.metadata
                ?.migration
                ?.source,
            'legacy'
        );

        assert.equal(
            canonicalInvoice.metadata
                ?.migration
                ?.source,
            'legacy'
        );

        assert.equal(
            canonicalUsage.metadata
                ?.migration
                ?.source,
            'legacy'
        );
    }
);

/**
 * =============================================================================
 * 11 — Rerun / idempotency
 * =============================================================================
 */

test(
    'rerunning Stage 01C does not duplicate canonical records',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        const first =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    false,
            });

        const firstCounts =
            {
                plans:
                    db.collection(
                        CANONICAL.plans
                    )._records.length,

                subscriptions:
                    db.collection(
                        CANONICAL.subscriptions
                    )._records.length,

                invoices:
                    db.collection(
                        CANONICAL.invoices
                    )._records.length,

                usage:
                    db.collection(
                        CANONICAL.usage
                    )._records.length,
            };

        const second =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    false,
            });

        assert.equal(
            first.status,
            'COMPLETED'
        );

        assert.equal(
            second.status,
            'COMPLETED'
        );

        assert.equal(
            second.results.plans.inserted,
            0
        );

        assert.equal(
            second.results.subscriptions.inserted,
            0
        );

        assert.equal(
            second.results.invoices.inserted,
            0
        );

        assert.equal(
            second.results.usage.inserted,
            0
        );

        assert.equal(
            db.collection(
                CANONICAL.plans
            )._records.length,
            firstCounts.plans
        );

        assert.equal(
            db.collection(
                CANONICAL.subscriptions
            )._records.length,
            firstCounts.subscriptions
        );

        assert.equal(
            db.collection(
                CANONICAL.invoices
            )._records.length,
            firstCounts.invoices
        );

        assert.equal(
            db.collection(
                CANONICAL.usage
            )._records.length,
            firstCounts.usage
        );
    }
);

/**
 * =============================================================================
 * 12 — Invalid invoice relationship
 * =============================================================================
 */

test(
    'invoice with unknown legacy subscription is rejected and never copied',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            createDb({
                billingplans:
                    createCollection({
                        name:
                            'billingplans',

                        documents:
                            [
                                validPlan(),
                            ],
                    }),

                tenantsubscriptions:
                    createCollection({
                        name:
                            'tenantsubscriptions',

                        documents:
                            [
                                validSubscription(),
                            ],
                    }),

                invoices:
                    createCollection({
                        name:
                            'invoices',

                        documents:
                            [
                                validInvoice({
                                    subscriptionId:
                                        objectId(
                                            '99'
                                        ),
                                }),
                            ],
                    }),
            });

        await withEnvironment(
            {
                TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS:
                    'true',

                TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS:
                    '1',
            },
            async () => {
                await assert.rejects(
                    () =>
                        migration.up({
                            mongoose:
                                createMongo(
                                    db
                                ),

                            dryRun:
                                false,
                        }),
                    /Canonical subscription not found|record-error threshold/i
                );
            }
        );

        assert.equal(
            db.collection(
                CANONICAL.invoices
            )._records.length,
            0
        );
    }
);

/**
 * =============================================================================
 * 13 — Strict record error threshold
 * =============================================================================
 */

test(
    'strict mode stops at the configured record-error threshold',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            createDb({
                billingplans:
                    createCollection({
                        name:
                            'billingplans',

                        documents:
                            [
                                validPlan({
                                    price:
                                        '-1',
                                }),
                            ],
                    }),
            });

        await withEnvironment(
            {
                TITECH_SAAS_BILLING_MIGRATION_FAIL_ON_RECORD_ERRORS:
                    'true',

                TITECH_SAAS_BILLING_MIGRATION_MAX_RECORD_ERRORS:
                    '1',
            },
            async () => {
                await assert.rejects(
                    () =>
                        migration.up({
                            mongoose:
                                createMongo(
                                    db
                                ),

                            dryRun:
                                false,
                        }),
                    /record-error threshold.*1/i
                );
            }
        );

        const migrationStates =
            db.collection(
                CANONICAL.migrationState
            )._records;

        assert.ok(
            migrationStates.length >= 1
        );

        const state =
            migrationStates[
                migrationStates.length -
                1
            ];

        assert.equal(
            state.status,
            'FAILED'
        );
    }
);

/**
 * =============================================================================
 * 14 — Dry-run
 * =============================================================================
 */

test(
    'dry-run does not write canonical billing data or migration state',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        const result =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    true,
            });

        assert.equal(
            result.dryRun,
            true
        );

        assert.equal(
            db.collection(
                CANONICAL.plans
            )._records.length,
            0
        );

        assert.equal(
            db.collection(
                CANONICAL.subscriptions
            )._records.length,
            0
        );

        assert.equal(
            db.collection(
                CANONICAL.invoices
            )._records.length,
            0
        );

        assert.equal(
            db.collection(
                CANONICAL.usage
            )._records.length,
            0
        );

        assert.equal(
            db.collection(
                CANONICAL.migrationState
            )._records.length,
            0
        );

        /**
         * Source collections must remain untouched.
         */
        assert.equal(
            db.collection(
                SOURCE_COLLECTIONS.plans
            )._records.length,
            1
        );

        assert.equal(
            db.collection(
                SOURCE_COLLECTIONS.subscriptions
            )._records.length,
            1
        );

        assert.equal(
            db.collection(
                SOURCE_COLLECTIONS.invoices
            )._records.length,
            1
        );

        assert.equal(
            db.collection(
                SOURCE_COLLECTIONS.usage
            )._records.length,
            1
        );
    }
);

/**
 * =============================================================================
 * 15 — Logical rollback
 * =============================================================================
 */

test(
    'logical rollback preserves canonical records and records RELEASED state',
    async () => {
        const migration =
            loadMigrationFresh();

        const canonicalPlan =
            {
                _id:
                    objectId(
                        '50'
                    ),

                code:
                    'STARTER',

                version:
                    1,

                metadata:
                    {
                        migration:
                            {
                                sourceCollection:
                                    SOURCE_COLLECTIONS.plans,

                                sourceId:
                                    objectId(
                                        '10'
                                    ).toString(),
                            },
                    },
            };

        const db =
            createDb({
                [CANONICAL.plans]:
                    createCollection({
                        name:
                            CANONICAL.plans,

                        documents:
                            [
                                canonicalPlan,
                            ],
                    }),
            });

        const result =
            await migration.down({
                mongoose:
                    createMongo(
                        db
                    ),
            });

        assert.equal(
            result.status,
            'LOGICAL_ROLLBACK_ONLY'
        );

        assert.equal(
            result.rollbackMode,
            'LOGICAL_ONLY'
        );

        assert.equal(
            result.canonicalCollectionsRetained,
            true
        );

        assert.equal(
            result.destructiveDataDeletion,
            false
        );

        assert.equal(
            result.customerFinancialBalancesChanged,
            false
        );

        assert.equal(
            result.financialLedgerChanged,
            false
        );

        assert.equal(
            db.collection(
                CANONICAL.plans
            )._records.length,
            1
        );

        const state =
            db.collection(
                CANONICAL.migrationState
            )._records[0];

        assert.equal(
            state.status,
            'RELEASED'
        );

        assert.equal(
            state.rollbackMode,
            'LOGICAL_ONLY'
        );
    }
);

/**
 * =============================================================================
 * 16 — Financial-core protection
 * =============================================================================
 */

test(
    'Stage 01C does not mutate wallets, balances, ledgers, transactions or payments',
    async () => {
        const migration =
            loadMigrationFresh();

        const protectedCollections = [
            'wallets',
            'balances',
            'ledger',
            'transactions',
            'financial_transactions',
            'payments',
            'payment_transactions',
        ];

        const db =
            fullSourceDb();

        for (
            const name of
            protectedCollections
        ) {
            db.collection(
                name
            );
        }

        await migration.up({
            mongoose:
                createMongo(
                    db
                ),

            dryRun:
                false,
        });

        for (
            const name of
            protectedCollections
        ) {
            assert.equal(
                db.collection(
                    name
                ).operations.length,
                0,
                `${name} must not be mutated by Stage 01C`
            );

            assert.equal(
                db.collection(
                    name
                )._records.length,
                0,
                `${name} must not receive records during Stage 01C`
            );
        }
    }
);

/**
 * =============================================================================
 * 17 — Migration-state contract
 * =============================================================================
 */

test(
    'completed migration persists authoritative state, results and reconciliation evidence',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        const result =
            await migration.up({
                mongoose:
                    createMongo(
                        db
                    ),

                dryRun:
                    false,
            });

        assert.equal(
            result.status,
            'COMPLETED'
        );

        assert.equal(
            result.stage,
            MIGRATION_STAGE
        );

        assert.equal(
            result.recordErrors,
            0
        );

        assert.ok(
            result.startedAt
        );

        assert.ok(
            result.completedAt
        );

        assert.ok(
            result.sources
        );

        assert.ok(
            result.results
        );

        assert.ok(
            result.indexes
        );

        assert.ok(
            result.reconciliation
        );

        const states =
            db.collection(
                CANONICAL.migrationState
            )._records;

        assert.ok(
            states.length >= 1,
            'Migration state must be persisted'
        );

        const state =
            states[
                states.length - 1
            ];

        assert.equal(
            state.status,
            'COMPLETED'
        );

        assert.equal(
            state.stage,
            MIGRATION_STAGE
        );

        assert.ok(
            state.summary,
            'Persisted migration state must include summary'
        );

        assert.ok(
            state.summary.results,
            'Persisted summary must contain category results'
        );

        assert.ok(
            state.summary.reconciliation,
            'Persisted summary must contain reconciliation'
        );

        assert.equal(
            state.summary.recordErrors,
            0
        );
    }
);

/**
 * =============================================================================
 * 18 — No legacy identifiers copied into canonical foreign keys
 * =============================================================================
 */

test(
    'canonical foreign-key fields contain only canonical identifiers after migration',
    async () => {
        const migration =
            loadMigrationFresh();

        const db =
            fullSourceDb();

        await migration.up({
            mongoose:
                createMongo(
                    db
                ),

            dryRun:
                false,
        });

        const sourcePlanId =
            validPlan()
                ._id
                .toString();

        const sourceSubscriptionId =
            validSubscription()
                ._id
                .toString();

        const canonicalPlan =
            db.collection(
                CANONICAL.plans
            )._records[0];

        const canonicalSubscription =
            db.collection(
                CANONICAL.subscriptions
            )._records[0];

        const canonicalInvoice =
            db.collection(
                CANONICAL.invoices
            )._records[0];

        const canonicalUsage =
            db.collection(
                CANONICAL.usage
            )._records[0];

        assert.notEqual(
            canonicalSubscription.planId.toString(),
            sourcePlanId
        );

        assert.notEqual(
            canonicalInvoice.subscriptionId.toString(),
            sourceSubscriptionId
        );

        assert.notEqual(
            canonicalUsage.subscriptionId.toString(),
            sourceSubscriptionId
        );

        assert.equal(
            canonicalSubscription.planId.toString(),
            canonicalPlan._id.toString()
        );

        assert.equal(
            canonicalInvoice.subscriptionId.toString(),
            canonicalSubscription._id.toString()
        );

        assert.equal(
            canonicalUsage.subscriptionId.toString(),
            canonicalSubscription._id.toString()
        );
    }
);

/**
 * =============================================================================
 * 19 — Ambiguous source discovery
 * =============================================================================
 *
 * Intentionally TODO until the migration exposes an explicit public
 * AMBIGUOUS discovery state and refuses to guess between multiple plausible
 * sources.
 */

test.todo(
    'source discovery returns AMBIGUOUS and refuses to guess when multiple plausible legacy collections exist'
);