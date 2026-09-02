'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/config/performanceOptimization.js
 *
 * Purpose:
 *   Enterprise production-grade database performance and optimization policy.
 *
 * Responsibilities:
 *   - Define authoritative database indexing policy.
 *   - Initialize indexes safely and idempotently.
 *   - Provide reusable query optimization helpers.
 *   - Provide bounded pagination utilities.
 *   - Provide optimized aggregation helpers.
 *   - Define Redis/cache policy without making cache authoritative.
 *   - Define connection-pool defaults.
 *   - Define query/operation timeout policy.
 *   - Provide safe performance diagnostics.
 *   - Support TITech financial-system safety boundaries.
 *
 * IMPORTANT:
 *
 *   This module is PERFORMANCE POLICY.
 *
 *   It does NOT:
 *     - own MongoDB connection lifecycle.
 *     - own Redis connection lifecycle.
 *     - implement business logic.
 *     - execute financial transactions.
 *     - implement ledger operations.
 *     - replace application-level validation.
 *     - make cached financial state authoritative.
 *
 * Canonical infrastructure ownership remains with:
 *
 *   backend/config/db.js
 *   backend/bootstrap/infrastructure.js
 *   backend/config/cache.js
 *
 * =============================================================================
 *
 * Architectural position:
 *
 *   configuration
 *       ↓
 *   performanceOptimization.js
 *       ↓
 *   database / repositories / services
 *       ↓
 *   application
 *
 * =============================================================================
 */

const mongoose =
    require('mongoose');

const crypto =
    require('node:crypto');

/**
 * =============================================================================
 * Optional logger
 * =============================================================================
 */

let loggerModule =
    null;

try {

    // eslint-disable-next-line global-require
    loggerModule =
        require('../utils/logger');

} catch {

    loggerModule =
        null;

}

/**
 * =============================================================================
 * Optional configuration provider
 * =============================================================================
 */

let configProvider =
    null;

try {

    // eslint-disable-next-line global-require
    configProvider =
        require('./configProvider');

} catch {

    configProvider =
        null;

}

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const COMPONENT =
    'performance-optimization';

const SERVICE_NAME =
    process.env.OTEL_SERVICE_NAME ||
    process.env.SERVICE_NAME ||
    'titech-backend';

const APPLICATION_NAME =
    process.env.APP_NAME ||
    'titech-community-capital';

const DEFAULT_PAGE =
    1;

const DEFAULT_PAGE_SIZE =
    25;

const MAX_PAGE_SIZE =
    100;

const DEFAULT_CACHE_NAMESPACE =
    'titech';

const INDEX_BUILD_MODE =
    'managed';

const PERFORMANCE_STATES =
    Object.freeze({
        CREATED:
            'created',

        INITIALIZING:
            'initializing',

        READY:
            'ready',

        DEGRADED:
            'degraded',

        FAILED:
            'failed',

        STOPPED:
            'stopped',
    });

/**
 * =============================================================================
 * Defaults
 * =============================================================================
 */

const DEFAULTS =
    Object.freeze({

        /**
         * ---------------------------------------------------------------------
         * Index lifecycle
         * ---------------------------------------------------------------------
         */

        indexes:
            {
                enabled:
                    true,

                required:
                    true,

                failFast:
                    false,

                continueOnOptionalModelFailure:
                    true,

                useModelSync:
                    false,

                createIndexesConcurrently:
                    false,
            },

        /**
         * ---------------------------------------------------------------------
         * Query behavior
         * ---------------------------------------------------------------------
         */

        queries:
            {
                lean:
                    true,

                maxPageSize:
                    MAX_PAGE_SIZE,

                defaultPageSize:
                    DEFAULT_PAGE_SIZE,

                maxIdsPerBatch:
                    1_000,

                maxAggregationDocuments:
                    100_000,

                allowDiskUse:
                    false,

                defaultSortField:
                    'createdAt',

                defaultSortOrder:
                    -1,
            },

        /**
         * ---------------------------------------------------------------------
         * Cache behavior
         * ---------------------------------------------------------------------
         *
         * Cache is never authoritative for financial state.
         * ---------------------------------------------------------------------
         */

        cache:
            {
                enabled:
                    true,

                namespace:
                    DEFAULT_CACHE_NAMESPACE,

                provider:
                    'redis',

                failurePolicy:
                    'fail_open',

                financialFailurePolicy:
                    'fail_open',

                authoritativeFinancialState:
                    false,

                invalidateOnWrite:
                    true,

                versionedKeys:
                    true,

                hashLongKeys:
                    true,

                maxKeyLength:
                    512,

                maxParameterLength:
                    256,
            },

        /**
         * ---------------------------------------------------------------------
         * Connection pool
         * ---------------------------------------------------------------------
         */

        pool:
            {
                maxPoolSize:
                    10,

                minPoolSize:
                    2,

                maxIdleTimeMS:
                    45_000,

                waitQueueTimeoutMS:
                    10_000,

                maxConnecting:
                    2,
            },

        /**
         * ---------------------------------------------------------------------
         * Timeouts
         * ---------------------------------------------------------------------
         */

        timeouts:
            {
                default:
                    30_000,

                aggregation:
                    60_000,

                transaction:
                    120_000,

                bulkOperation:
                    180_000,

                count:
                    30_000,

                healthCheck:
                    5_000,
            },

        /**
         * ---------------------------------------------------------------------
         * Observability
         * ---------------------------------------------------------------------
         */

        observability:
            {
                logSlowQueries:
                    true,

                slowQueryThresholdMs:
                    1_000,

                includeQueryText:
                    false,

                includeQueryParameters:
                    false,

                metricsEnabled:
                    true,

                diagnosticsEnabled:
                    true,
            },
    });

/**
 * =============================================================================
 * Logger helpers
 * =============================================================================
 */

function getLogger() {

    try {

        return (
            loggerModule?.getLogger?.() ||
            loggerModule?.logger ||
            loggerModule ||
            console
        );

    } catch {

        return console;

    }

}

function log(
    level,
    metadata,
    message,
) {

    try {

        const logger =
            getLogger();

        if (
            logger &&
            typeof logger[level] ===
                'function'
        ) {

            logger[level](
                {
                    component:
                        COMPONENT,

                    service:
                        SERVICE_NAME,

                    application:
                        APPLICATION_NAME,

                    ...metadata,
                },
                message,
            );

            return;

        }

    } catch {

        // Best effort.

    }

}

/**
 * =============================================================================
 * Configuration helpers
 * =============================================================================
 */

function getConfig(
    path,
    fallback,
) {

    try {

        if (
            typeof configProvider?.get ===
                'function'
        ) {

            return configProvider.get(
                path,
                fallback,
            );

        }

    } catch {

        // Fall through.

    }

    return fallback;

}

function getBooleanConfig(
    path,
    fallback,
) {

    const value =
        getConfig(
            path,
            fallback,
        );

    if (
        typeof value ===
        'boolean'
    ) {

        return value;

    }

    const normalized =
        String(
            value,
        )
            .trim()
            .toLowerCase();

    if (
        [
            'true',
            '1',
            'yes',
            'on',
        ].includes(
            normalized,
        )
    ) {

        return true;

    }

    if (
        [
            'false',
            '0',
            'no',
            'off',
        ].includes(
            normalized,
        )
    ) {

        return false;

    }

    return fallback;

}

function getIntegerConfig(
    path,
    fallback,
) {

    const value =
        Number(
            getConfig(
                path,
                fallback,
            ),
        );

    return Number.isInteger(
        value,
    )
        ? value
        : fallback;

}

function isProduction() {

    return (
        getConfig(
            'app.environment',
            process.env.NODE_ENV ||
                'development',
        ) ===
        'production'
    );

}

/**
 * =============================================================================
 * Index strategy
 * =============================================================================
 *
 * NOTE:
 *
 * Index definitions should correspond to actual schema fields in the deployed
 * application. Invalid model/field assumptions should be surfaced during
 * startup rather than silently ignored.
 *
 * =============================================================================
 */

const indexingStrategy =
    Object.freeze({

        userIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            email:
                                1,
                        },

                    options:
                        {
                            unique:
                                true,

                            sparse:
                                true,

                            name:
                                'users_email_unique',
                        },
                },

                {
                    spec:
                        {
                            phone:
                                1,
                        },

                    options:
                        {
                            unique:
                                true,

                            sparse:
                                true,

                            name:
                                'users_phone_unique',
                        },
                },

                {
                    spec:
                        {
                            role:
                                1,
                        },

                    options:
                        {
                            name:
                                'users_role',
                        },
                },

                {
                    spec:
                        {
                            isVerified:
                                1,
                        },

                    options:
                        {
                            name:
                                'users_is_verified',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'users_created_at_desc',
                        },
                },
            ]),

        groupIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            admin:
                                1,
                        },

                    options:
                        {
                            name:
                                'groups_admin',
                        },
                },

                {
                    spec:
                        {
                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'groups_status',
                        },
                },

                {
                    spec:
                        {
                            members:
                                1,
                        },

                    options:
                        {
                            name:
                                'groups_members',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'groups_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            admin:
                                1,

                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'groups_admin_status',
                        },
                },
            ]),

        loanIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            user:
                                1,

                            group:
                                1,
                        },

                    options:
                        {
                            name:
                                'loans_user_group',
                        },
                },

                {
                    spec:
                        {
                            group:
                                1,

                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'loans_group_status',
                        },
                },

                {
                    spec:
                        {
                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'loans_status',
                        },
                },

                {
                    spec:
                        {
                            user:
                                1,

                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'loans_user_status',
                        },
                },

                {
                    spec:
                        {
                            approvedBy:
                                1,
                        },

                    options:
                        {
                            name:
                                'loans_approved_by',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loans_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            group:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loans_group_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            user:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loans_user_created_at_desc',
                        },
                },
            ]),

        contributionIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            user:
                                1,

                            group:
                                1,
                        },

                    options:
                        {
                            name:
                                'contributions_user_group',
                        },
                },

                {
                    spec:
                        {
                            group:
                                1,
                        },

                    options:
                        {
                            name:
                                'contributions_group',
                        },
                },

                {
                    spec:
                        {
                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'contributions_status',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'contributions_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            user:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'contributions_user_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            group:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'contributions_group_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            group:
                                1,

                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'contributions_group_status',
                        },
                },
            ]),

        repaymentScheduleIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            loan:
                                1,
                        },

                    options:
                        {
                            unique:
                                true,

                            name:
                                'repayment_schedules_loan_unique',
                        },
                },

                {
                    spec:
                        {
                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'repayment_schedules_status',
                        },
                },

                {
                    spec:
                        {
                            'installments.dueDate':
                                1,
                        },

                    options:
                        {
                            name:
                                'repayment_schedules_installments_due_date',
                        },
                },

                {
                    spec:
                        {
                            'installments.paid':
                                1,
                        },

                    options:
                        {
                            name:
                                'repayment_schedules_installments_paid',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'repayment_schedules_created_at_desc',
                        },
                },
            ]),

        loanEligibilityIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            user:
                                1,

                            group:
                                1,
                        },

                    options:
                        {
                            name:
                                'loan_eligibility_user_group',
                        },
                },

                {
                    spec:
                        {
                            user:
                                1,

                            expiresAt:
                                1,
                        },

                    options:
                        {
                            expireAfterSeconds:
                                0,

                            name:
                                'loan_eligibility_user_expires_at_ttl',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loan_eligibility_created_at_desc',
                        },
                },
            ]),

        loanAuditIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            user:
                                1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_user',
                        },
                },

                {
                    spec:
                        {
                            loan:
                                1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_loan',
                        },
                },

                {
                    spec:
                        {
                            action:
                                1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_action',
                        },
                },

                {
                    spec:
                        {
                            actor:
                                1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_actor',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            user:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_user_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            action:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'loan_audits_action_created_at_desc',
                        },
                },
            ]),

        chatIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            group:
                                1,

                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'chats_group_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            sender:
                                1,
                        },

                    options:
                        {
                            name:
                                'chats_sender',
                        },
                },

                {
                    spec:
                        {
                            recipients:
                                1,
                        },

                    options:
                        {
                            name:
                                'chats_recipients',
                        },
                },

                {
                    spec:
                        {
                            read:
                                1,
                        },

                    options:
                        {
                            name:
                                'chats_read',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'chats_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            group:
                                1,

                            sender:
                                1,
                        },

                    options:
                        {
                            name:
                                'chats_group_sender',
                        },
                },
            ]),

        referralIndexes:
            Object.freeze([
                {
                    spec:
                        {
                            referrer:
                                1,
                        },

                    options:
                        {
                            name:
                                'referrals_referrer',
                        },
                },

                {
                    spec:
                        {
                            referee:
                                1,
                        },

                    options:
                        {
                            name:
                                'referrals_referee',
                        },
                },

                {
                    spec:
                        {
                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'referrals_status',
                        },
                },

                {
                    spec:
                        {
                            createdAt:
                                -1,
                        },

                    options:
                        {
                            name:
                                'referrals_created_at_desc',
                        },
                },

                {
                    spec:
                        {
                            referrer:
                                1,

                            status:
                                1,
                        },

                    options:
                        {
                            name:
                                'referrals_referrer_status',
                        },
                },
            ]),

    });

/**
 * =============================================================================
 * Model registry
 * =============================================================================
 *
 * Lazy resolution prevents module loading during configuration import.
 * =============================================================================
 */

const MODEL_PATHS =
    Object.freeze({

        User:
            '../models/User',

        Group:
            '../models/Group',

        Loan:
            '../models/Loan',

        Contribution:
            '../models/Contribution',

        LoanRepaymentSchedule:
            '../models/LoanRepaymentSchedule',

        LoanEligibility:
            '../models/LoanEligibility',

        LoanAudit:
            '../models/LoanAudit',

        Chat:
            '../models/Chat',

        Referral:
            '../models/Referral',
    });

function resolveModel(
    modelName,
) {

    const modulePath =
        MODEL_PATHS[
            modelName
        ];

    if (
        !modulePath
    ) {

        throw new Error(
            `Unknown TITech performance model "${modelName}".`,
        );

    }

    try {

        // eslint-disable-next-line global-require, import/no-dynamic-require
        const loaded =
            require(
                modulePath,
            );

        return (
            loaded?.default ||
            loaded
        );

    } catch (
        error
    ) {

        const normalized =
            new Error(
                `Unable to load TITech model "${modelName}": ${error.message}`,
            );

        normalized.code =
            'PERFORMANCE_MODEL_LOAD_FAILED';

        normalized.cause =
            error;

        throw normalized;

    }

}

/**
 * =============================================================================
 * Index helpers
 * =============================================================================
 */

function normalizeIndexOptions(
    options = {},
) {

    const normalized = {
        ...options,
    };

    /**
     * MongoDB/Mongoose now handles index creation without the old "background"
     * option being required. Remove it from externally supplied definitions to
     * avoid carrying obsolete behavior forward.
     */
    delete normalized.background;

    return normalized;

}

function getIndexDefinitions() {

    return indexingStrategy;

}

function flattenIndexDefinitions() {

    const result =
        [];

    for (
        const [
            groupName,
            indexes,
        ] of Object.entries(
            indexingStrategy,
        )
    ) {

        const modelName =
            groupName.replace(
                /Indexes$/,
                '',
            );

        for (
            const definition of
            indexes
        ) {

            result.push({
                modelName:
                    modelName
                        .charAt(0)
                        .toUpperCase() +
                    modelName.slice(
                        1,
                    ),

                group:
                    groupName,

                spec:
                    {
                        ...definition.spec,
                    },

                options:
                    normalizeIndexOptions(
                        definition.options,
                    ),
            });

        }

    }

    return result;

}

async function initializeModelIndexes(
    model,
    definitions,
    options = {},
) {

    if (
        !model?.collection
    ) {

        throw new TypeError(
            'A valid Mongoose model is required for index initialization.',
        );

    }

    const results =
        [];

    for (
        const definition of
        definitions
    ) {

        const startedAt =
            process.hrtime.bigint();

        try {

            const indexName =
                await model.collection.createIndex(
                    definition.spec,
                    normalizeIndexOptions(
                        definition.options,
                    ),
                );

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                        startedAt,
                ) / 1e6;

            results.push({
                model:
                    model.modelName,

                indexName,

                spec:
                    {
                        ...definition.spec,
                    },

                durationMs:
                    Number(
                        durationMs.toFixed(
                            3,
                        ),
                    ),

                created:
                    true,

                skipped:
                    false,
            });

        } catch (
            error
        ) {

            const duplicateDefinition =
                isRecoverableIndexConflict(
                    error,
                );

            if (
                duplicateDefinition &&
                options.ignoreConflicts !==
                    false
            ) {

                results.push({
                    model:
                        model.modelName,

                    indexName:
                        definition.options?.name ||
                        null,

                    spec:
                        {
                            ...definition.spec,
                        },

                    durationMs:
                        Number(
                            (
                                Number(
                                    process.hrtime.bigint() -
                                        startedAt,
                                ) / 1e6
                            ).toFixed(
                                3,
                            ),
                        ),

                    created:
                        false,

                    skipped:
                        true,

                    reason:
                        'INDEX_CONFLICT',
                });

                continue;

            }

            const wrapped =
                new Error(
                    `Failed to create index for ${model.modelName}: ${error.message}`,
                );

            wrapped.code =
                'PERFORMANCE_INDEX_CREATION_FAILED';

            wrapped.cause =
                error;

            wrapped.model =
                model.modelName;

            wrapped.spec =
                definition.spec;

            throw wrapped;

        }

    }

    return results;

}

function isRecoverableIndexConflict(
    error,
) {

    const message =
        String(
            error?.message ||
                '',
        );

    return (
        /already exists|IndexKeySpecsConflict|index.*equivalent/i.test(
            message,
        )
    );

}

/**
 * =============================================================================
 * Initialize all indexes
 * =============================================================================
 */

let indexInitializationPromise =
    null;

async function initializeIndexes(
    options = {},
) {

    if (
        indexInitializationPromise
    ) {

        return indexInitializationPromise;

    }

    if (
        !getBooleanConfig(
            'performance.indexes.enabled',
            DEFAULTS.indexes.enabled,
        )
    ) {

        return {
            state:
                PERFORMANCE_STATES
                    .DEGRADED,

            enabled:
                false,

            models:
                [],
        };

    }

    indexInitializationPromise =
        (async () => {

            const startedAt =
                process.hrtime.bigint();

            const modelConfigurations = [
                {
                    modelName:
                        'User',

                    definitions:
                        indexingStrategy
                            .userIndexes,
                },

                {
                    modelName:
                        'Group',

                    definitions:
                        indexingStrategy
                            .groupIndexes,
                },

                {
                    modelName:
                        'Loan',

                    definitions:
                        indexingStrategy
                            .loanIndexes,
                },

                {
                    modelName:
                        'Contribution',

                    definitions:
                        indexingStrategy
                            .contributionIndexes,
                },

                {
                    modelName:
                        'LoanRepaymentSchedule',

                    definitions:
                        indexingStrategy
                            .repaymentScheduleIndexes,
                },

                {
                    modelName:
                        'LoanEligibility',

                    definitions:
                        indexingStrategy
                            .loanEligibilityIndexes,
                },

                {
                    modelName:
                        'LoanAudit',

                    definitions:
                        indexingStrategy
                            .loanAuditIndexes,
                },

                {
                    modelName:
                        'Chat',

                    definitions:
                        indexingStrategy
                            .chatIndexes,
                },

                {
                    modelName:
                        'Referral',

                    definitions:
                        indexingStrategy
                            .referralIndexes,
                },
            ];

            const modelResults =
                [];

            let failedOptionalModels =
                0;

            for (
                const modelConfiguration of
                modelConfigurations
            ) {

                try {

                    const model =
                        resolveModel(
                            modelConfiguration
                                .modelName,
                        );

                    const results =
                        await initializeModelIndexes(
                            model,
                            modelConfiguration
                                .definitions,
                            {
                                ignoreConflicts:
                                    true,
                            },
                        );

                    modelResults.push({
                        model:
                            model
                                .modelName,

                        indexes:
                            results,

                        success:
                            true,
                    });

                } catch (
                    error
                ) {

                    if (
                        DEFAULTS.indexes
                            .continueOnOptionalModelFailure
                    ) {

                        failedOptionalModels +=
                            1;

                        modelResults.push({
                            model:
                                modelConfiguration
                                    .modelName,

                            indexes:
                                [],

                            success:
                                false,

                            error:
                                {
                                    name:
                                        error?.name,

                                    code:
                                        error?.code,

                                    message:
                                        error?.message,
                                },
                        });

                        log(
                            'warn',
                            {
                                model:
                                    modelConfiguration
                                        .modelName,

                                code:
                                    error?.code,

                                message:
                                    error?.message,
                            },
                            'TITech model indexes could not be fully initialized; continuing.',
                        );

                        continue;

                    }

                    throw error;

                }

            }

            const durationMs =
                Number(
                    process.hrtime.bigint() -
                        startedAt,
                ) / 1e6;

            const totalIndexes =
                modelResults.reduce(
                    (
                        total,
                        modelResult,
                    ) =>
                        total +
                        modelResult.indexes.length,
                    0,
                );

            const failedModels =
                modelResults.filter(
                    modelResult =>
                        !modelResult.success,
                ).length;

            const state =
                failedModels >
                0
                    ? PERFORMANCE_STATES
                        .DEGRADED
                    : PERFORMANCE_STATES
                        .READY;

            const result = {
                state,

                enabled:
                    true,

                models:
                    modelResults,

                totalModels:
                    modelResults.length,

                failedModels,

                failedOptionalModels,

                totalIndexes,

                durationMs:
                    Number(
                        durationMs.toFixed(
                            3,
                        ),
                    ),

                completedAt:
                    new Date()
                        .toISOString(),
            };

            log(
                failedModels >
                    0
                    ? 'warn'
                    : 'info',
                {
                    totalModels:
                        result.totalModels,

                    failedModels:
                        result.failedModels,

                    totalIndexes:
                        result.totalIndexes,

                    durationMs:
                        result.durationMs,
                },
                'TITech database index initialization completed.',
            );

            return result;

        })();

    try {

        return await indexInitializationPromise;

    } finally {

        indexInitializationPromise =
            null;

    }

}

/**
 * =============================================================================
 * Pagination validation
 * =============================================================================
 */

function normalizePagination(
    options = {},
) {

    const configuredMax =
        Math.min(
            Math.max(
                getIntegerConfig(
                    'api.maxPageSize',
                    getIntegerConfig(
                        'performance.queries.maxPageSize',
                        MAX_PAGE_SIZE,
                    ),
                ),
                1,
            ),
            MAX_PAGE_SIZE,
        );

    const requestedPage =
        Number(
            options.page ??
                DEFAULT_PAGE,
        );

    const requestedLimit =
        Number(
            options.limit ??
                DEFAULT_PAGE_SIZE,
        );

    const page =
        Number.isInteger(
            requestedPage,
        ) &&
        requestedPage >=
            1
            ? requestedPage
            : DEFAULT_PAGE;

    const limit =
        Number.isInteger(
            requestedLimit,
        ) &&
        requestedLimit >=
            1
            ? Math.min(
                requestedLimit,
                configuredMax,
            )
            : DEFAULT_PAGE_SIZE;

    return {
        page,
        limit,
        skip:
            (page - 1) *
            limit,
        maxLimit:
            configuredMax,
    };

}

/**
 * =============================================================================
 * Query helpers
 * =============================================================================
 */

function sanitizeSort(
    sortBy,
    sortOrder,
    allowedSortFields = [
        'createdAt',
    ],
) {

    const normalizedField =
        String(
            sortBy ||
                'createdAt',
        ).trim();

    if (
        !allowedSortFields.includes(
            normalizedField,
        )
    ) {

        return {
            [
                allowedSortFields[0]
            ]:
                -1,
        };

    }

    const direction =
        Number(
            sortOrder,
        ) ===
            1
            ? 1
            : -1;

    return {
        [normalizedField]:
            direction,
    };

}

async function getUserById(
    userId,
    options = {},
) {

    const User =
        resolveModel(
            'User',
        );

    if (
        !mongoose.isValidObjectId(
            userId,
        )
    ) {

        return null;

    }

    const query =
        User.findById(
            userId,
        );

    if (
        options.select
    ) {

        query.select(
            options.select,
        );

    }

    if (
        options.lean !==
        false
    ) {

        query.lean();

    }

    if (
        options.timeoutMs
    ) {

        query.maxTimeMS(
            options.timeoutMs,
        );

    }

    return query.exec();

}

async function getUsersByIds(
    userIds,
    options = {},
) {

    const User =
        resolveModel(
            'User',
        );

    if (
        !Array.isArray(
            userIds,
        )
    ) {

        throw new TypeError(
            'userIds must be an array.',
        );

    }

    const uniqueIds =
        [
            ...new Set(
                userIds
                    .map(
                        value =>
                            String(
                                value,
                            ),
                    )
                    .filter(
                        mongoose.isValidObjectId,
                    ),
            ),
        ];

    const maxIds =
        getIntegerConfig(
            'performance.queries.maxIdsPerBatch',
            DEFAULTS.queries.maxIdsPerBatch,
        );

    if (
        uniqueIds.length >
        maxIds
    ) {

        throw new RangeError(
            `TITech user batch size cannot exceed ${maxIds}.`,
        );

    }

    const query =
        User.find({
            _id:
                {
                    $in:
                        uniqueIds,
                },
        });

    if (
        options.select
    ) {

        query.select(
            options.select,
        );

    }

    if (
        options.lean !==
        false
    ) {

        query.lean();

    }

    if (
        options.timeoutMs
    ) {

        query.maxTimeMS(
            options.timeoutMs,
        );

    }

    return query.exec();

}

async function getLoanWithSchedule(
    loanId,
    options = {},
) {

    const Loan =
        resolveModel(
            'Loan',
        );

    const LoanRepaymentSchedule =
        resolveModel(
            'LoanRepaymentSchedule',
        );

    if (
        !mongoose.isValidObjectId(
            loanId,
        )
    ) {

        return {
            loan:
                null,

            schedule:
                null,
        };

    }

    const timeoutMs =
        options.timeoutMs ||
        getIntegerConfig(
            'performance.timeouts.default',
            DEFAULTS.timeouts.default,
        );

    const loanQuery =
        Loan.findById(
            loanId,
        ).select(
            options.loanSelect ||
            'user group amount status interestRate repaymentPeriodMonths createdAt',
        );

    const scheduleQuery =
        LoanRepaymentSchedule.findOne({
            loan:
                loanId,
        });

    if (
        options.lean !==
        false
    ) {

        loanQuery.lean();
        scheduleQuery.lean();

    }

    loanQuery.maxTimeMS(
        timeoutMs,
    );

    scheduleQuery.maxTimeMS(
        timeoutMs,
    );

    const [
        loan,
        schedule,
    ] =
        await Promise.all([
            loanQuery.exec(),
            scheduleQuery.exec(),
        ]);

    return {
        loan,
        schedule,
    };

}

/**
 * =============================================================================
 * Paginated query
 * =============================================================================
 */

async function getPaginatedResults(
    model,
    query = {},
    options = {},
) {

    if (
        !model ||
        typeof model.find !==
            'function'
    ) {

        throw new TypeError(
            'A valid Mongoose model is required.',
        );

    }

    const pagination =
        normalizePagination(
            options,
        );

    const allowedSortFields =
        options.allowedSortFields ||
        [
            'createdAt',
            '_id',
        ];

    const sort =
        sanitizeSort(
            options.sortBy,
            options.sortOrder,
            allowedSortFields,
        );

    const shouldLean =
        options.lean !==
        false;

    const timeoutMs =
        options.timeoutMs ||
        getIntegerConfig(
            'performance.timeouts.default',
            DEFAULTS.timeouts.default,
        );

    const findQuery =
        model
            .find(
                query,
            )
            .sort(
                sort,
            )
            .skip(
                pagination.skip,
            )
            .limit(
                pagination.limit,
            )
            .maxTimeMS(
                timeoutMs,
            );

    const countQuery =
        model.countDocuments(
            query,
        );

    if (
        shouldLean
    ) {

        findQuery.lean();

    }

    const [
        data,
        total,
    ] =
        await Promise.all([
            findQuery.exec(),
            countQuery.maxTimeMS(
                timeoutMs,
            ).exec(),
        ]);

    return {
        data,

        pagination:
            {
                page:
                    pagination.page,

                limit:
                    pagination.limit,

                total,

                pages:
                    Math.ceil(
                        total /
                            pagination.limit,
                    ),

                hasNextPage:
                    (
                        pagination.page *
                            pagination.limit
                    ) <
                    total,

                hasPreviousPage:
                    pagination.page >
                    1,
            },

        sort,
    };

}

/**
 * =============================================================================
 * Aggregation safety
 * =============================================================================
 */

function normalizeAggregationOptions(
    options = {},
) {

    return {
        allowDiskUse:
            options.allowDiskUse ??
            getBooleanConfig(
                'performance.queries.allowDiskUse',
                DEFAULTS.queries.allowDiskUse,
            ),

        maxTimeMS:
            options.maxTimeMS ||
            getIntegerConfig(
                'performance.timeouts.aggregation',
                DEFAULTS.timeouts.aggregation,
            ),

        comment:
            options.comment ||
            `${APPLICATION_NAME}:aggregation`,
    };

}

function toObjectId(
    value,
) {

    if (
        value instanceof
        mongoose.Types.ObjectId
    ) {

        return value;

    }

    if (
        !mongoose.isValidObjectId(
            value,
        )
    ) {

        throw new TypeError(
            `Invalid MongoDB ObjectId: ${value}`,
        );

    }

    return new mongoose.Types.ObjectId(
        value,
    );

}

async function getGroupStatistics(
    groupId,
    options = {},
) {

    const Loan =
        resolveModel(
            'Loan',
        );

    const Contribution =
        resolveModel(
            'Contribution',
        );

    const objectId =
        toObjectId(
            groupId,
        );

    const aggregateOptions =
        normalizeAggregationOptions(
            options,
        );

    const [
        loanStats,
        contributionStats,
    ] =
        await Promise.all([
            Loan.aggregate([
                {
                    $match:
                        {
                            group:
                                objectId,
                        },
                },

                {
                    $group:
                        {
                            _id:
                                '$status',

                            count:
                                {
                                    $sum:
                                        1,
                                },

                            totalAmount:
                                {
                                    $sum:
                                        '$amount',
                                },

                            averageAmount:
                                {
                                    $avg:
                                        '$amount',
                                },
                        },
                },

                {
                    $sort:
                        {
                            _id:
                                1,
                        },
                },
            ])
                .allowDiskUse(
                    aggregateOptions
                        .allowDiskUse,
                )
                .option({
                    maxTimeMS:
                        aggregateOptions
                            .maxTimeMS,

                    comment:
                        aggregateOptions
                            .comment,
                })
                .exec(),

            Contribution.aggregate([
                {
                    $match:
                        {
                            group:
                                objectId,
                        },
                },

                {
                    $group:
                        {
                            _id:
                                null,

                            totalAmount:
                                {
                                    $sum:
                                        '$amount',
                                },

                            count:
                                {
                                    $sum:
                                        1,
                                },

                            averageContribution:
                                {
                                    $avg:
                                        '$amount',
                                },
                        },
                },
            ])
                .allowDiskUse(
                    aggregateOptions
                        .allowDiskUse,
                )
                .option({
                    maxTimeMS:
                        aggregateOptions
                            .maxTimeMS,

                    comment:
                        aggregateOptions
                            .comment,
                })
                .exec(),
        ]);

    return {
        groupId:
            String(
                groupId,
            ),

        loanStats,
        contributionStats,
    };

}

/**
 * =============================================================================
 * Additional optimized repository-style helpers
 * =============================================================================
 */

async function getRecentRecords(
    model,
    query = {},
    options = {},
) {

    if (
        !model ||
        typeof model.find !==
            'function'
    ) {

        throw new TypeError(
            'A valid Mongoose model is required.',
        );

    }

    const limit =
        Math.min(
            Math.max(
                Number(
                    options.limit ||
                        20,
                ),
                1,
            ),
            getIntegerConfig(
                'performance.queries.maxPageSize',
                MAX_PAGE_SIZE,
            ),
        );

    const timeoutMs =
        options.timeoutMs ||
        getIntegerConfig(
            'performance.timeouts.default',
            DEFAULTS.timeouts.default,
        );

    const queryBuilder =
        model
            .find(
                query,
            )
            .sort({
                createdAt:
                    -1,

                _id:
                    -1,
            })
            .limit(
                limit,
            )
            .maxTimeMS(
                timeoutMs,
            );

    if (
        options.select
    ) {

        queryBuilder.select(
            options.select,
        );

    }

    if (
        options.lean !==
        false
    ) {

        queryBuilder.lean();

    }

    return queryBuilder.exec();

}

/**
 * =============================================================================
 * Query timing helper
 * =============================================================================
 */

async function measureOperation(
    name,
    operation,
    options = {},
) {

    if (
        typeof operation !==
        'function'
    ) {

        throw new TypeError(
            'measureOperation requires a function.',
        );

    }

    const startedAt =
        process.hrtime.bigint();

    try {

        const result =
            await operation();

        const durationMs =
            Number(
                process.hrtime.bigint() -
                    startedAt,
            ) / 1e6;

        const thresholdMs =
            options.slowThresholdMs ||
            getIntegerConfig(
                'performance.observability.slowQueryThresholdMs',
                DEFAULTS.observability
                    .slowQueryThresholdMs,
            );

        if (
            getBooleanConfig(
                'performance.observability.logSlowQueries',
                DEFAULTS.observability
                    .logSlowQueries,
            ) &&
            durationMs >=
                thresholdMs
        ) {

            log(
                'warn',
                {
                    operation:
                        name,

                    durationMs:
                        Number(
                            durationMs.toFixed(
                                3,
                            ),
                        ),

                    thresholdMs,
                },
                'TITech slow database operation detected.',
            );

        }

        return {
            result,

            durationMs:
                Number(
                    durationMs.toFixed(
                        3,
                    ),
                ),

            slow:
                durationMs >=
                thresholdMs,
        };

    } catch (
        error
    ) {

        const durationMs =
            Number(
                process.hrtime.bigint() -
                    startedAt,
            ) / 1e6;

        log(
            'error',
            {
                operation:
                    name,

                durationMs:
                    Number(
                        durationMs.toFixed(
                            3,
                        ),
                    ),

                error:
                    {
                        name:
                            error?.name,

                        code:
                            error?.code,

                        message:
                            error?.message,
                    },
            },
            'TITech database operation failed.',
        );

        throw error;

    }

}

/**
 * =============================================================================
 * Cache strategy
 * =============================================================================
 *
 * Cache keys are deterministic and bounded.
 *
 * IMPORTANT:
 *
 * Cache is never the source of truth for:
 *   - account balances
 *   - ledger entries
 *   - transactions
 *   - payment state
 *   - financial authorization state
 * =============================================================================
 */

const cachingStrategy =
    Object.freeze({

        TTL:
            Object.freeze({
                USER:
                    3_600,

                LOAN:
                    1_800,

                ELIGIBILITY:
                    1_800,

                GROUP:
                    3_600,

                ANALYTICS:
                    300,

                REFERENCE_DATA:
                    3_600,

                AUTHORIZATION:
                    300,
            }),

        policy:
            Object.freeze({
                provider:
                    getConfig(
                        'cache.provider',
                        'redis',
                    ),

                enabled:
                    getBooleanConfig(
                        'cache.enabled',
                        DEFAULTS.cache
                            .enabled,
                    ),

                authoritativeFinancialState:
                    false,

                financialReads:
                    true,

                financialWrites:
                    false,

                balances:
                    false,

                ledger:
                    false,

                paymentState:
                    false,

                invalidateOnWrite:
                    DEFAULTS.cache
                        .invalidateOnWrite,
            }),

        generateKey(
            type,
            id,
            params = {},
        ) {

            const normalizedType =
                String(
                    type ||
                        'unknown',
                )
                    .trim()
                    .toLowerCase()
                    .replace(
                        /[^a-z0-9:_-]/g,
                        '_',
                    );

            const normalizedId =
                String(
                    id ||
                        'global',
                )
                    .trim()
                    .slice(
                        0,
                        DEFAULTS.cache
                            .maxParameterLength,
                    );

            const sortedParams =
                Object.fromEntries(
                    Object.entries(
                        params ||
                            {},
                    ).sort(
                        (
                            [
                                a,
                            ],
                            [
                                b,
                            ],
                        ) =>
                            a.localeCompare(
                                b,
                            ),
                    ),
                );

            const paramsText =
                Object.keys(
                    sortedParams,
                ).length >
                    0
                    ? JSON.stringify(
                        sortedParams,
                    )
                    : '';

            let key =
                [
                    DEFAULT_CACHE_NAMESPACE,
                    normalizedType,
                    normalizedId,
                    paramsText,
                ]
                    .filter(
                        Boolean,
                    )
                    .join(':');

            if (
                key.length >
                DEFAULTS.cache
                    .maxKeyLength
            ) {

                key =
                    `${DEFAULT_CACHE_NAMESPACE}:${normalizedType}:${crypto
                        .createHash(
                            'sha256',
                        )
                        .update(
                            key,
                            'utf8',
                        )
                        .digest(
                            'hex',
                        )}`;

            }

            return key;

        },

        invalidationPatterns:
            Object.freeze({

                userUpdate(
                    userId,
                ) {

                    return [
                        `${DEFAULT_CACHE_NAMESPACE}:user:${userId}:*`,
                    ];

                },

                loanUpdate(
                    loanId,
                ) {

                    return [
                        `${DEFAULT_CACHE_NAMESPACE}:loan:${loanId}:*`,

                        `${DEFAULT_CACHE_NAMESPACE}:eligibility:*`,
                    ];

                },

                groupUpdate(
                    groupId,
                ) {

                    return [
                        `${DEFAULT_CACHE_NAMESPACE}:group:${groupId}:*`,
                    ];

                },

                eligibilityUpdate(
                    userId,
                    groupId,
                ) {

                    return [
                        `${DEFAULT_CACHE_NAMESPACE}:eligibility:${userId}:${groupId}`,
                    ];

                },

            }),
    });

/**
 * =============================================================================
 * Connection pooling
 * =============================================================================
 */

const connectionPooling =
    Object.freeze({

        maxPoolSize:
            getIntegerConfig(
                'database.maxPoolSize',
                DEFAULTS.pool
                    .maxPoolSize,
            ),

        minPoolSize:
            getIntegerConfig(
                'database.minPoolSize',
                DEFAULTS.pool
                    .minPoolSize,
            ),

        maxIdleTimeMS:
            getIntegerConfig(
                'database.maxIdleTimeMS',
                DEFAULTS.pool
                    .maxIdleTimeMS,
            ),

        waitQueueTimeoutMS:
            getIntegerConfig(
                'database.waitQueueTimeoutMS',
                DEFAULTS.pool
                    .waitQueueTimeoutMS,
            ),

        maxConnecting:
            getIntegerConfig(
                'database.maxConnecting',
                DEFAULTS.pool
                    .maxConnecting,
            ),
    });

/**
 * =============================================================================
 * Query timeouts
 * =============================================================================
 */

const queryTimeouts =
    Object.freeze({

        default:
            getIntegerConfig(
                'performance.timeouts.default',
                DEFAULTS.timeouts.default,
            ),

        aggregation:
            getIntegerConfig(
                'performance.timeouts.aggregation',
                DEFAULTS.timeouts.aggregation,
            ),

        transaction:
            getIntegerConfig(
                'performance.timeouts.transaction',
                DEFAULTS.timeouts.transaction,
            ),

        bulkOperation:
            getIntegerConfig(
                'performance.timeouts.bulkOperation',
                DEFAULTS.timeouts.bulkOperation,
            ),

        count:
            getIntegerConfig(
                'performance.timeouts.count',
                DEFAULTS.timeouts.count,
            ),

        healthCheck:
            getIntegerConfig(
                'performance.timeouts.healthCheck',
                DEFAULTS.timeouts.healthCheck,
            ),
    });

/**
 * =============================================================================
 * Performance snapshot
 * =============================================================================
 */

function getSnapshot() {

    return Object.freeze({

        component:
            COMPONENT,

        service:
            SERVICE_NAME,

        application:
            APPLICATION_NAME,

        environment:
            process.env.NODE_ENV ||
            'development',

        state:
            PERFORMANCE_STATES.READY,

        indexBuildMode:
            INDEX_BUILD_MODE,

        indexes:
            {
                enabled:
                    getBooleanConfig(
                        'performance.indexes.enabled',
                        DEFAULTS.indexes
                            .enabled,
                    ),

                required:
                    getBooleanConfig(
                        'performance.indexes.required',
                        DEFAULTS.indexes
                            .required,
                    ),

                strategyGroups:
                    Object.keys(
                        indexingStrategy,
                    ).length,

                totalDefinitions:
                    flattenIndexDefinitions()
                        .length,
            },

        queries:
            {
                defaultPage:
                    DEFAULT_PAGE,

                defaultPageSize:
                    getIntegerConfig(
                        'performance.queries.defaultPageSize',
                        DEFAULT_PAGE_SIZE,
                    ),

                maxPageSize:
                    getIntegerConfig(
                        'performance.queries.maxPageSize',
                        MAX_PAGE_SIZE,
                    ),

                leanDefault:
                    DEFAULTS.queries
                        .lean,

                allowDiskUse:
                    getBooleanConfig(
                        'performance.queries.allowDiskUse',
                        DEFAULTS.queries
                            .allowDiskUse,
                    ),
            },

        cache:
            {
                enabled:
                    cachingStrategy
                        .policy
                        .enabled,

                provider:
                    cachingStrategy
                        .policy
                        .provider,

                authoritativeFinancialState:
                    false,

                financialWrites:
                    false,

                balances:
                    false,

                ledger:
                    false,
            },

        pool:
            connectionPooling,

        timeouts:
            queryTimeouts,

        observability:
            {
                slowQueryLogging:
                    getBooleanConfig(
                        'performance.observability.logSlowQueries',
                        DEFAULTS.observability
                            .logSlowQueries,
                    ),

                slowQueryThresholdMs:
                    getIntegerConfig(
                        'performance.observability.slowQueryThresholdMs',
                        DEFAULTS.observability
                            .slowQueryThresholdMs,
                    ),
            },

        timestamp:
            new Date()
                .toISOString(),
    });

}

/**
 * =============================================================================
 * Lifecycle state
 * =============================================================================
 */

let lifecycleState =
    PERFORMANCE_STATES.CREATED;

let initializedAt =
    null;

let lastInitializationResult =
    null;

let lastInitializationError =
    null;

async function initialize(
    options = {},
) {

    if (
        lifecycleState ===
        PERFORMANCE_STATES.READY
    ) {

        return lastInitializationResult;

    }

    lifecycleState =
        PERFORMANCE_STATES.INITIALIZING;

    initializedAt =
        new Date();

    try {

        const result =
            await initializeIndexes(
                options,
            );

        lastInitializationResult =
            result;

        lastInitializationError =
            null;

        lifecycleState =
            result.failedModels >
                0
                ? PERFORMANCE_STATES
                    .DEGRADED
                : PERFORMANCE_STATES
                    .READY;

        return result;

    } catch (
        error
    ) {

        lastInitializationError =
            error;

        lifecycleState =
            PERFORMANCE_STATES.FAILED;

        log(
            'error',
            {
                code:
                    error?.code,

                message:
                    error?.message,
            },
            'TITech performance subsystem initialization failed.',
        );

        throw error;

    }

}

async function start(
    context = {},
    options = {},
) {

    const result =
        await initialize(
            options,
        );

    if (
        context &&
        typeof context ===
            'object'
    ) {

        context.performance =
            {
                state:
                    lifecycleState,

                result,
            };

    }

    return result;

}

async function bootstrap(
    context = {},
    options = {},
) {

    return start(
        context,
        options,
    );

}

async function shutdown() {

    lifecycleState =
        PERFORMANCE_STATES.STOPPED;

    return true;

}

/**
 * =============================================================================
 * Health
 * =============================================================================
 */

async function health() {

    return {

        status:
            lifecycleState ===
            PERFORMANCE_STATES.FAILED
                ? 'unhealthy'
                : lifecycleState ===
                      PERFORMANCE_STATES.DEGRADED
                    ? 'degraded'
                    : 'healthy',

        component:
            COMPONENT,

        state:
            lifecycleState,

        indexes:
            lastInitializationResult
                ? {
                    totalModels:
                        lastInitializationResult
                            .totalModels,

                    failedModels:
                        lastInitializationResult
                            .failedModels,

                    totalIndexes:
                        lastInitializationResult
                            .totalIndexes,
                }
                : null,

        error:
            lastInitializationError
                ? {
                    code:
                        lastInitializationError
                            .code,

                    message:
                        lastInitializationError
                            .message,
                }
                : null,

        timestamp:
            new Date()
                .toISOString(),
    };

}

/**
 * =============================================================================
 * Reset
 * =============================================================================
 *
 * Testing/process isolation only.
 * =============================================================================
 */

function reset() {

    if (
        lifecycleState ===
        PERFORMANCE_STATES.INITIALIZING
    ) {

        throw new Error(
            'Cannot reset the active TITech performance subsystem.',
        );

    }

    lifecycleState =
        PERFORMANCE_STATES.CREATED;

    initializedAt =
        null;

    lastInitializationResult =
        null;

    lastInitializationError =
        null;

    indexInitializationPromise =
        null;

    return true;

}

/**
 * =============================================================================
 * Public API
 * =============================================================================
 */

module.exports =
    Object.freeze({

        /**
         * Constants/defaults.
         */
        COMPONENT,

        SERVICE_NAME,

        APPLICATION_NAME,

        DEFAULTS,

        PERFORMANCE_STATES,

        MODEL_PATHS,

        indexingStrategy,

        getIndexDefinitions,

        flattenIndexDefinitions,

        /**
         * Index lifecycle.
         */
        initializeIndexes,

        initializeModelIndexes,

        initialize,

        start,

        bootstrap,

        shutdown,

        health,

        reset,

        /**
         * Query optimization.
         */
        getUserById,

        getUsersByIds,

        getLoanWithSchedule,

        getPaginatedResults,

        getRecentRecords,

        getGroupStatistics,

        measureOperation,

        normalizePagination,

        sanitizeSort,

        toObjectId,

        normalizeAggregationOptions,

        /**
         * Cache.
         */
        cachingStrategy,

        /**
         * Connection/query policy.
         */
        connectionPooling,

        queryTimeouts,

        /**
         * Diagnostics.
         */
        getSnapshot,

        getLifecycleState:
            () =>
                lifecycleState,

        getInitializedAt:
            () =>
                initializedAt,

        getLastInitializationResult:
            () =>
                lastInitializationResult,

        getLastInitializationError:
            () =>
                lastInitializationError,
    });