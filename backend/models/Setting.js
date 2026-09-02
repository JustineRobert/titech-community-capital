'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Settings Model
 * =============================================================================
 *
 * File:
 *   backend/models/Setting.js
 *
 * Purpose:
 *   Centralized, multi-tenant application configuration and operational
 *   settings for the TITech Community Capital platform.
 *
 * Architecture:
 *
 *   Tenant
 *      │
 *      ▼
 *   Setting
 *      │
 *      ├── Application Configuration
 *      ├── Registration Controls
 *      ├── Currency
 *      ├── Support Configuration
 *      ├── Maintenance Controls
 *      ├── Group Limits
 *      ├── Feature Controls
 *      └── Audit History
 *
 * Design Principles:
 *   - Multi-tenant isolation
 *   - One active settings document per tenant
 *   - Safe defaults
 *   - Strong validation
 *   - Auditability
 *   - Soft deletion
 *   - Optimistic concurrency
 *   - No sensitive secrets in settings
 *   - Production-safe update helpers
 *
 * IMPORTANT:
 *   Secrets such as JWT secrets, encryption keys, API credentials, database
 *   passwords and payment-provider credentials MUST NOT be stored here.
 *
 * =============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema,
    Types
} = mongoose;


/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const MODEL_NAME = 'Setting';

const DEFAULT_SINGLETON_KEY = 'app';

const DEFAULT_APP_NAME = 'TITech Community Capital';

const DEFAULT_CURRENCY = 'UGX';

const DEFAULT_SUPPORT_EMAIL = 'support@titechcommunity.app';

const MAX_AUDIT_ENTRIES = 100;


/**
 * =============================================================================
 * ENUMS
 * =============================================================================
 */

const SETTING_STATUS = Object.freeze({
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE'
});

const SETTING_ENVIRONMENT = Object.freeze({
    DEVELOPMENT: 'DEVELOPMENT',
    TEST: 'TEST',
    STAGING: 'STAGING',
    PRODUCTION: 'PRODUCTION'
});


/**
 * =============================================================================
 * AUDIT LOG SCHEMA
 * =============================================================================
 *
 * Audit history is intentionally bounded.
 *
 * Do NOT store secrets, authentication tokens, passwords or payment-provider
 * credentials inside details.
 * =============================================================================
 */

const SettingAuditSchema = new Schema(
    {
        action: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            maxlength: 100
        },

        userId: {
            type: Types.ObjectId,
            ref: 'User',
            default: null
        },

        timestamp: {
            type: Date,
            default: Date.now,
            immutable: true
        },

        /**
         * Safe operational metadata only.
         */
        details: {
            type: Schema.Types.Mixed,
            default: undefined
        },

        /**
         * Optional correlation/reference identifier.
         */
        reference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        /**
         * Optional source such as:
         *
         * ADMIN_PANEL
         * API
         * SYSTEM
         * MIGRATION
         * BOOTSTRAP
         */
        source: {
            type: String,
            trim: true,
            uppercase: true,
            maxlength: 50,
            default: 'SYSTEM'
        }
    },
    {
        _id: false
    }
);


/**
 * =============================================================================
 * SETTINGS SCHEMA
 * =============================================================================
 */

const SettingSchema = new Schema(
    {
        /**
         * =====================================================================
         * MULTI-TENANCY
         * =====================================================================
         *
         * Every production tenant MUST have an isolated settings document.
         *
         * tenantId is intentionally an ObjectId reference rather than a free
         * text value.
         * =====================================================================
         */

        tenantId: {
            type: Types.ObjectId,
            ref: 'Tenant',
            required: true,
            index: true,
            immutable: true
        },


        /**
         * =====================================================================
         * SINGLETON KEY
         * =====================================================================
         *
         * Allows one settings document per tenant for a given configuration
         * scope.
         *
         * Example:
         *
         * tenantId + singleton = app
         *
         * This permits future scoped settings without creating duplicate
         * application configuration documents.
         * =====================================================================
         */

        singleton: {
            type: String,
            required: true,
            default: DEFAULT_SINGLETON_KEY,
            trim: true,
            lowercase: true,
            minlength: 1,
            maxlength: 50,
            immutable: true
        },


        /**
         * =====================================================================
         * APPLICATION IDENTITY
         * =====================================================================
         */

        appName: {
            type: String,
            required: true,
            default: DEFAULT_APP_NAME,
            trim: true,
            minlength: 2,
            maxlength: 150
        },


        /**
         * =====================================================================
         * ENVIRONMENT
         * =====================================================================
         */

        environment: {
            type: String,
            enum: Object.values(SETTING_ENVIRONMENT),
            default: SETTING_ENVIRONMENT.PRODUCTION,
            uppercase: true,
            trim: true
        },


        /**
         * =====================================================================
         * STATUS
         * =====================================================================
         */

        status: {
            type: String,
            enum: Object.values(SETTING_STATUS),
            default: SETTING_STATUS.ACTIVE,
            uppercase: true,
            trim: true,
            index: true
        },


        /**
         * =====================================================================
         * REGISTRATION
         * =====================================================================
         */

        allowRegistrations: {
            type: Boolean,
            default: true
        },


        /**
         * =====================================================================
         * CURRENCY
         * =====================================================================
         *
         * ISO-4217 style three-character currency code.
         *
         * Financial transaction amounts and currency handling should still be
         * controlled by the transaction/ledger layer.
         * =====================================================================
         */

        currency: {
            type: String,
            required: true,
            default: DEFAULT_CURRENCY,
            uppercase: true,
            trim: true,
            minlength: 3,
            maxlength: 3,
            match: [
                /^[A-Z]{3}$/,
                'Currency must be a valid three-letter uppercase code.'
            ]
        },


        /**
         * =====================================================================
         * SUPPORT
         * =====================================================================
         */

        supportEmail: {
            type: String,
            default: DEFAULT_SUPPORT_EMAIL,
            lowercase: true,
            trim: true,
            maxlength: 254,
            match: [
                /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
                'Invalid support email format.'
            ]
        },


        /**
         * =====================================================================
         * MAINTENANCE
         * =====================================================================
         */

        maintenanceMode: {
            type: Boolean,
            default: false,
            index: true
        },

        maintenanceMessage: {
            type: String,
            trim: true,
            maxlength: 500,
            default: null
        },


        /**
         * =====================================================================
         * GROUP CONFIGURATION
         * =====================================================================
         */

        maxGroupMembers: {
            type: Number,
            default: 50,
            min: 1,
            max: 100000,
            validate: {
                validator(value) {
                    return Number.isInteger(value);
                },
                message: 'maxGroupMembers must be an integer.'
            }
        },


        /**
         * =====================================================================
         * OPTIONAL PLATFORM LIMITS
         * =====================================================================
         *
         * These are operational limits, not financial authorization controls.
         */

        maxGroupsPerMember: {
            type: Number,
            default: 20,
            min: 1,
            max: 10000,
            validate: {
                validator(value) {
                    return Number.isInteger(value);
                },
                message: 'maxGroupsPerMember must be an integer.'
            }
        },

        maxSavingsAccountsPerMember: {
            type: Number,
            default: 10,
            min: 1,
            max: 1000,
            validate: {
                validator(value) {
                    return Number.isInteger(value);
                },
                message:
                    'maxSavingsAccountsPerMember must be an integer.'
            }
        },


        /**
         * =====================================================================
         * FEATURE FLAGS
         * =====================================================================
         *
         * Tenant-level operational switches.
         */

        features: {
            mobileMoney: {
                type: Boolean,
                default: true
            },

            referrals: {
                type: Boolean,
                default: true
            },

            notifications: {
                type: Boolean,
                default: true
            },

            reporting: {
                type: Boolean,
                default: true
            },

            analytics: {
                type: Boolean,
                default: true
            },

            chat: {
                type: Boolean,
                default: true
            }
        },


        /**
         * =====================================================================
         * COMPLIANCE CONTROLS
         * =====================================================================
         */

        compliance: {
            requireKycBeforeTransactions: {
                type: Boolean,
                default: true
            },

            requireKycBeforeWithdrawal: {
                type: Boolean,
                default: true
            },

            enableAmlChecks: {
                type: Boolean,
                default: true
            },

            enableFraudMonitoring: {
                type: Boolean,
                default: true
            }
        },


        /**
         * =====================================================================
         * NOTIFICATION CONFIGURATION
         * =====================================================================
         */

        notifications: {
            emailEnabled: {
                type: Boolean,
                default: true
            },

            smsEnabled: {
                type: Boolean,
                default: true
            },

            pushEnabled: {
                type: Boolean,
                default: true
            }
        },


        /**
         * =====================================================================
         * SOFT DELETE
         * =====================================================================
         */

        isDeleted: {
            type: Boolean,
            default: false,
            index: true
        },

        deletedAt: {
            type: Date,
            default: null
        },

        deletedBy: {
            type: Types.ObjectId,
            ref: 'User',
            default: null
        },


        /**
         * =====================================================================
         * AUDIT
         * =====================================================================
         */

        auditLog: {
            type: [SettingAuditSchema],
            default: []
        },


        /**
         * =====================================================================
         * AUDIT METADATA
         * =====================================================================
         */

        createdBy: {
            type: Types.ObjectId,
            ref: 'User',
            default: null,
            immutable: true
        },

        updatedBy: {
            type: Types.ObjectId,
            ref: 'User',
            default: null
        },

        lastUpdatedSource: {
            type: String,
            trim: true,
            uppercase: true,
            maxlength: 50,
            default: 'SYSTEM'
        },

        auditReference: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },


        /**
         * =====================================================================
         * WORKFLOW VERSION
         * =====================================================================
         *
         * Application-level configuration version.
         */

        workflowVersion: {
            type: Number,
            default: 1,
            min: 1,
            validate: {
                validator(value) {
                    return Number.isInteger(value);
                },
                message: 'workflowVersion must be an integer.'
            }
        }
    },
    {
        timestamps: true,

        optimisticConcurrency: true,

        versionKey: '__v',

        strict: true,

        minimize: true,

        toJSON: {
            virtuals: true,

            transform(doc, ret) {
                ret.id = ret._id
                    ? ret._id.toString()
                    : undefined;

                delete ret._id;

                /**
                 * Never expose internal mongoose version metadata.
                 */
                delete ret.__v;

                return ret;
            }
        },

        toObject: {
            virtuals: true
        }
    }
);


/**
 * =============================================================================
 * INDEXES
 * =============================================================================
 */

/**
 * One active configuration scope per tenant.
 */
SettingSchema.index(
    {
        tenantId: 1,
        singleton: 1
    },
    {
        unique: true,
        name: 'uq_setting_tenant_singleton'
    }
);


/**
 * Fast active-setting lookup.
 */
SettingSchema.index(
    {
        tenantId: 1,
        isDeleted: 1,
        status: 1
    },
    {
        name: 'idx_setting_tenant_active'
    }
);


/**
 * Maintenance-mode operational queries.
 */
SettingSchema.index(
    {
        tenantId: 1,
        maintenanceMode: 1
    },
    {
        name: 'idx_setting_tenant_maintenance'
    }
);


/**
 * Updated configuration records.
 */
SettingSchema.index(
    {
        tenantId: 1,
        updatedAt: -1
    },
    {
        name: 'idx_setting_tenant_updated'
    }
);


/**
 * =============================================================================
 * VIRTUALS
 * =============================================================================
 */

SettingSchema.virtual('isActive')
    .get(function () {
        return (
            this.status === SETTING_STATUS.ACTIVE &&
            this.isDeleted === false
        );
    });


SettingSchema.virtual('isMaintenanceMode')
    .get(function () {
        return this.maintenanceMode === true;
    });


/**
 * =============================================================================
 * INTERNAL HELPERS
 * =============================================================================
 */

function sanitizeAuditDetails(details) {
    if (
        !details ||
        typeof details !== 'object'
    ) {
        return undefined;
    }

    /**
     * Prevent credentials and secrets from entering the audit trail.
     */
    const forbiddenKeys = new Set([
        'password',
        'passwordHash',
        'token',
        'accessToken',
        'refreshToken',
        'secret',
        'clientSecret',
        'apiKey',
        'privateKey',
        'encryptionKey',
        'jwtSecret',
        'authorization',
        'cookie'
    ]);

    const sanitized = {};

    for (const [key, value] of Object.entries(details)) {
        if (
            forbiddenKeys.has(
                String(key).toLowerCase()
            )
        ) {
            continue;
        }

        sanitized[key] = value;
    }

    return sanitized;
}


/**
 * =============================================================================
 * PRE-VALIDATE
 * =============================================================================
 */

SettingSchema.pre(
    'validate',
    function (next) {
        /**
         * Normalize tenant ID.
         */
        if (
            this.tenantId &&
            !(
                this.tenantId instanceof Types.ObjectId
            )
        ) {
            this.tenantId =
                normalizeObjectId(
                    this.tenantId
                );
        }

        /**
         * Normalize singleton.
         */
        if (this.singleton) {
            this.singleton =
                String(
                    this.singleton
                )
                    .trim()
                    .toLowerCase();
        }

        /**
         * Ensure deleted records have deletion metadata.
         */
        if (
            this.isDeleted === true &&
            !this.deletedAt
        ) {
            this.deletedAt = new Date();
        }

        if (
            this.isDeleted === false
        ) {
            this.deletedAt = null;
            this.deletedBy = null;
        }

        next();
    }
);


/**
 * =============================================================================
 * PRE-SAVE
 * =============================================================================
 */

SettingSchema.pre(
    'save',
    function (next) {
        /**
         * Keep workflow version valid.
         */
        if (
            !Number.isInteger(
                this.workflowVersion
            ) ||
            this.workflowVersion < 1
        ) {
            this.workflowVersion = 1;
        }

        /**
         * Bound audit history.
         *
         * Financial/audit-grade immutable event history should live in the
         * dedicated audit system. This embedded array is only an operational
         * settings-change history.
         */
        if (
            Array.isArray(this.auditLog) &&
            this.auditLog.length >
                MAX_AUDIT_ENTRIES
        ) {
            this.auditLog =
                this.auditLog.slice(
                    -MAX_AUDIT_ENTRIES
                );
        }

        next();
    }
);


/**
 * =============================================================================
 * STATIC: GET SETTINGS
 * =============================================================================
 *
 * Always requires tenantId.
 *
 * This prevents accidental cross-tenant configuration access.
 * =============================================================================
 */

SettingSchema.statics.getSettings =
    async function (tenantId, options = {}) {
        const normalizedTenantId =
            normalizeObjectId(
                tenantId
            );

        if (!normalizedTenantId) {
            throw new Error(
                'Valid tenantId is required to retrieve settings.'
            );
        }

        const query = {
            tenantId: normalizedTenantId,
            singleton:
                options.singleton ||
                DEFAULT_SINGLETON_KEY,
            isDeleted: false
        };

        if (
            options.includeInactive !== true
        ) {
            query.status =
                SETTING_STATUS.ACTIVE;
        }

        return this.findOne(query)
            .lean(
                options.lean !== false
            );
    };


/**
 * =============================================================================
 * STATIC: GET OR CREATE SETTINGS
 * =============================================================================
 */

SettingSchema.statics.getOrCreateSettings =
    async function (
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeObjectId(
                tenantId
            );

        if (!normalizedTenantId) {
            throw new Error(
                'Valid tenantId is required.'
            );
        }

        const singleton =
            options.singleton ||
            DEFAULT_SINGLETON_KEY;

        const existing =
            await this.findOne({
                tenantId:
                    normalizedTenantId,

                singleton,

                isDeleted: false
            });

        if (existing) {
            return existing;
        }

        try {
            return await this.create({
                tenantId:
                    normalizedTenantId,

                singleton,

                appName:
                    options.appName ||
                    DEFAULT_APP_NAME,

                currency:
                    options.currency ||
                    DEFAULT_CURRENCY,

                supportEmail:
                    options.supportEmail ||
                    DEFAULT_SUPPORT_EMAIL,

                createdBy:
                    normalizeOptionalObjectId(
                        options.userId
                    )
            });
        } catch (error) {
            /**
             * Another concurrent request may have created the singleton.
             */
            if (
                error &&
                error.code === 11000
            ) {
                return this.findOne({
                    tenantId:
                        normalizedTenantId,

                    singleton,

                    isDeleted: false
                });
            }

            throw error;
        }
    };


/**
 * =============================================================================
 * STATIC: UPDATE SETTINGS
 * =============================================================================
 *
 * Safe tenant-scoped update helper.
 *
 * IMPORTANT:
 *   Financial authorization, authentication secrets and system credentials
 *   must never be updated through this generic settings method.
 * =============================================================================
 */

SettingSchema.statics.updateSettings =
    async function (
        tenantId,
        updates = {},
        userId = null,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeObjectId(
                tenantId
            );

        if (!normalizedTenantId) {
            throw new Error(
                'Valid tenantId is required.'
            );
        }

        if (
            !updates ||
            typeof updates !== 'object' ||
            Array.isArray(updates)
        ) {
            throw new Error(
                'Settings updates must be an object.'
            );
        }

        const singleton =
            options.singleton ||
            DEFAULT_SINGLETON_KEY;

        const settings =
            await this.findOne({
                tenantId:
                    normalizedTenantId,

                singleton,

                isDeleted: false
            });

        if (!settings) {
            throw new Error(
                'Tenant settings were not found.'
            );
        }

        /**
         * Protected fields.
         */
        const protectedFields = new Set([
            '_id',
            'tenantId',
            'singleton',
            'createdAt',
            'createdBy',
            'updatedAt',
            'updatedBy',
            'auditLog',
            'isDeleted',
            'deletedAt',
            'deletedBy',
            '__v'
        ]);

        const safeUpdates = {};

        for (
            const [key, value]
            of Object.entries(updates)
        ) {
            if (
                protectedFields.has(key)
            ) {
                continue;
            }

            /**
             * Block MongoDB operator injection.
             */
            if (
                key.startsWith('$') ||
                key.includes('.')
            ) {
                throw new Error(
                    `Invalid settings field: ${key}`
                );
            }

            safeUpdates[key] = value;
        }

        Object.assign(
            settings,
            safeUpdates
        );

        const normalizedUserId =
            normalizeOptionalObjectId(
                userId
            );

        settings.updatedBy =
            normalizedUserId;

        settings.lastUpdatedSource =
            options.source ||
            'SYSTEM';

        settings.auditReference =
            options.auditReference ||
            null;

        settings.workflowVersion =
            Math.max(
                1,
                Number(
                    settings.workflowVersion ||
                    1
                ) + 1
            );

        settings.auditLog.push({
            action: 'UPDATE',
            userId:
                normalizedUserId,
            timestamp: new Date(),
            details:
                sanitizeAuditDetails(
                    safeUpdates
                ),
            reference:
                options.auditReference ||
                null,
            source:
                options.source ||
                'SYSTEM'
        });

        /**
         * Bound embedded history.
         */
        if (
            settings.auditLog.length >
            MAX_AUDIT_ENTRIES
        ) {
            settings.auditLog =
                settings.auditLog.slice(
                    -MAX_AUDIT_ENTRIES
                );
        }

        return settings.save();
    };


/**
 * =============================================================================
 * STATIC: ENABLE MAINTENANCE MODE
 * =============================================================================
 */

SettingSchema.statics.enableMaintenanceMode =
    async function (
        tenantId,
        userId = null,
        message = null
    ) {
        return this.updateSettings(
            tenantId,
            {
                maintenanceMode: true,
                maintenanceMessage:
                    message || null
            },
            userId,
            {
                source: 'SYSTEM'
            }
        );
    };


/**
 * =============================================================================
 * STATIC: DISABLE MAINTENANCE MODE
 * =============================================================================
 */

SettingSchema.statics.disableMaintenanceMode =
    async function (
        tenantId,
        userId = null
    ) {
        return this.updateSettings(
            tenantId,
            {
                maintenanceMode: false,
                maintenanceMessage: null
            },
            userId,
            {
                source: 'SYSTEM'
            }
        );
    };


/**
 * =============================================================================
 * STATIC: SOFT DELETE
 * =============================================================================
 */

SettingSchema.statics.softDeleteSettings =
    async function (
        tenantId,
        userId = null,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeObjectId(
                tenantId
            );

        const normalizedUserId =
            normalizeOptionalObjectId(
                userId
            );

        if (!normalizedTenantId) {
            throw new Error(
                'Valid tenantId is required.'
            );
        }

        const settings =
            await this.findOne({
                tenantId:
                    normalizedTenantId,

                singleton:
                    options.singleton ||
                    DEFAULT_SINGLETON_KEY,

                isDeleted: false
            });

        if (!settings) {
            return null;
        }

        settings.isDeleted = true;

        settings.deletedAt =
            new Date();

        settings.deletedBy =
            normalizedUserId;

        settings.status =
            SETTING_STATUS.INACTIVE;

        settings.updatedBy =
            normalizedUserId;

        settings.auditLog.push({
            action: 'SOFT_DELETE',
            userId:
                normalizedUserId,
            timestamp: new Date(),
            source:
                options.source ||
                'SYSTEM'
        });

        return settings.save();
    };


/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

/**
 * Automatically exclude soft-deleted settings from the helper.
 */
SettingSchema.query.active =
    function () {
        return this.where({
            isDeleted: false,
            status: SETTING_STATUS.ACTIVE
        });
    };


/**
 * =============================================================================
 * NORMALIZATION HELPERS
 * =============================================================================
 */

function normalizeObjectId(value) {
    if (
        value instanceof Types.ObjectId
    ) {
        return value;
    }

    if (
        typeof value === 'string' &&
        Types.ObjectId.isValid(value)
    ) {
        return new Types.ObjectId(
            value
        );
    }

    return null;
}


function normalizeOptionalObjectId(value) {
    if (
        value === null ||
        value === undefined ||
        value === ''
    ) {
        return null;
    }

    return normalizeObjectId(value);
}


/**
 * =============================================================================
 * MODEL EXPORT
 * =============================================================================
 */

module.exports =
    mongoose.models[MODEL_NAME] ||
    mongoose.model(
        MODEL_NAME,
        SettingSchema
    );


/**
 * =============================================================================
 * CONSTANT EXPORTS
 * =============================================================================
 */

module.exports.SETTING_STATUS =
    SETTING_STATUS;

module.exports.SETTING_ENVIRONMENT =
    SETTING_ENVIRONMENT;

module.exports.DEFAULT_SINGLETON_KEY =
    DEFAULT_SINGLETON_KEY;