'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE SYSTEM SETTING MODEL
 * ============================================================================
 *
 * File:
 *   backend/models/SystemSetting.js
 *
 * Purpose:
 *   Enterprise configuration/state management for TITech Community Capital.
 *
 * Architectural responsibilities:
 *
 *   - Global SYSTEM configuration
 *   - Tenant-specific configuration
 *   - Tenant overrides
 *   - Feature flags
 *   - Compliance configuration
 *   - Financial configuration metadata
 *   - Security configuration
 *   - Operational configuration
 *   - Versioned configuration
 *   - Optimistic concurrency
 *   - Configuration audit history
 *   - Safe effective-value resolution
 *   - Configuration lifecycle management
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This model stores CONFIGURATION STATE.
 *
 * It MUST NOT be used as:
 *
 *   - a financial ledger
 *   - a transaction journal
 *   - a balance store
 *   - a payment record
 *   - an accounting posting store
 *   - an immutable financial event store
 *
 * Financial state belongs in the transaction/ledger architecture.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const {
    Schema,
    Types
} = mongoose;

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SYSTEM_TENANT_ID = 'SYSTEM';

const MAX_KEY_LENGTH = 150;
const MAX_NAME_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 2000;

const MAX_AUDIT_ENTRIES = 100;

const MAX_METADATA_DEPTH = 10;

const VALUE_TYPES = Object.freeze([
    'STRING',
    'NUMBER',
    'BOOLEAN',
    'JSON',
    'ARRAY'
]);

const CATEGORIES = Object.freeze([
    'SYSTEM',
    'LOANS',
    'SAVINGS',
    'SHARES',
    'FIXED_DEPOSITS',
    'AML',
    'KYC',
    'FRAUD',
    'AI',
    'NOTIFICATIONS',
    'AUDIT',
    'ACCOUNTING',
    'GENERAL_LEDGER',
    'REPORTING',
    'MOBILE_MONEY',
    'API_GATEWAY',
    'WEBHOOKS',
    'SECURITY',
    'DISASTER_RECOVERY',
    'BACKUP',
    'COMPLIANCE'
]);

const AUDIT_ACTIONS = Object.freeze([
    'CREATE',
    'UPDATE',
    'ENABLE',
    'DISABLE',
    'DELETE',
    'RESTORE',
    'VALUE_UPDATE',
    'SYSTEM_UPDATE',
    'TENANT_OVERRIDE',
    'RETIRE',
    'UNRETIRE'
]);

const SOURCES = Object.freeze([
    'system',
    'api',
    'admin',
    'bootstrap',
    'migration',
    'seed',
    'worker',
    'scheduler',
    'cli',
    'internal'
]);

/**
 * ============================================================================
 * ERROR FACTORY
 * ============================================================================
 */

function createSettingError(
    message,
    code,
    extra = {}
) {
    const error = new Error(message);

    error.code = code;

    Object.assign(error, extra);

    return error;
}

/**
 * ============================================================================
 * SAFE CLONE
 * ============================================================================
 *
 * Used for audit snapshots and metadata so that references to mutable objects
 * are not accidentally persisted or mutated after an audit entry is created.
 * ============================================================================
 */

function cloneValue(value) {
    if (value === undefined || value === null) {
        return value;
    }

    if (value instanceof Date) {
        return new Date(value.getTime());
    }

    if (value instanceof Types.ObjectId) {
        return new Types.ObjectId(value);
    }

    if (
        typeof value !== 'object'
    ) {
        return value;
    }

    try {
        return JSON.parse(
            JSON.stringify(value)
        );
    } catch (error) {
        throw createSettingError(
            'System setting value cannot be safely serialized.',
            'SYSTEM_SETTING_UNSERIALIZABLE_VALUE'
        );
    }
}

/**
 * ============================================================================
 * TENANT NORMALIZATION
 * ============================================================================
 */

function normalizeTenantId(value) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return SYSTEM_TENANT_ID;
    }

    const normalized =
        String(value)
            .trim()
            .toUpperCase();

    if (!normalized) {
        return SYSTEM_TENANT_ID;
    }

    return normalized;
}

/**
 * ============================================================================
 * KEY NORMALIZATION
 * ============================================================================
 */

function normalizeKey(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return '';
    }

    return String(value)
        .trim()
        .toUpperCase();
}

/**
 * ============================================================================
 * CATEGORY NORMALIZATION
 * ============================================================================
 */

function normalizeCategory(value) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return 'SYSTEM';
    }

    return String(value)
        .trim()
        .toUpperCase();
}

/**
 * ============================================================================
 * SOURCE NORMALIZATION
 * ============================================================================
 */

function normalizeSource(value) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return 'system';
    }

    return String(value)
        .trim()
        .toLowerCase();
}

/**
 * ============================================================================
 * VALUE TYPE DETECTION
 * ============================================================================
 */

function detectValueType(value) {
    if (Array.isArray(value)) {
        return 'ARRAY';
    }

    if (value === null) {
        return 'JSON';
    }

    switch (typeof value) {
        case 'boolean':
            return 'BOOLEAN';

        case 'number':
            return 'NUMBER';

        case 'string':
            return 'STRING';

        case 'object':
            return 'JSON';

        default:
            return 'STRING';
    }
}

/**
 * ============================================================================
 * VALUE TYPE VALIDATION
 * ============================================================================
 */

function validateValueType(
    value,
    valueType
) {
    switch (valueType) {
        case 'STRING':
            return typeof value === 'string';

        case 'NUMBER':
            return (
                typeof value === 'number' &&
                Number.isFinite(value)
            );

        case 'BOOLEAN':
            return typeof value === 'boolean';

        case 'ARRAY':
            return Array.isArray(value);

        case 'JSON':
            return (
                value === null ||
                (
                    typeof value === 'object' &&
                    !Array.isArray(value)
                )
            );

        default:
            return false;
    }
}

/**
 * ============================================================================
 * KEY VALIDATION
 * ============================================================================
 */

function isValidSettingKey(key) {
    return (
        typeof key === 'string' &&
        /^[A-Z][A-Z0-9_.:-]*$/.test(key)
    );
}

/**
 * ============================================================================
 * METADATA VALIDATION
 * ============================================================================
 */

function getObjectDepth(
    value,
    currentDepth = 0
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return currentDepth;
    }

    if (currentDepth >= MAX_METADATA_DEPTH) {
        return currentDepth;
    }

    const values = Array.isArray(value)
        ? value
        : Object.values(value);

    let maxDepth = currentDepth;

    for (const item of values) {
        maxDepth = Math.max(
            maxDepth,
            getObjectDepth(
                item,
                currentDepth + 1
            )
        );
    }

    return maxDepth;
}

function validateMetadata(metadata) {
    if (
        metadata === null ||
        metadata === undefined
    ) {
        return true;
    }

    if (
        typeof metadata !== 'object'
    ) {
        return false;
    }

    return (
        getObjectDepth(metadata) <=
        MAX_METADATA_DEPTH
    );
}

/**
 * ============================================================================
 * AUDIT ENTRY SCHEMA
 * ============================================================================
 */

const SettingAuditSchema = new Schema(
    {
        action: {
            type: String,
            required: true,
            enum: AUDIT_ACTIONS,
            uppercase: true,
            trim: true
        },

        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        timestamp: {
            type: Date,
            required: true,
            default: Date.now,
            immutable: true
        },

        previousValue: {
            type: Schema.Types.Mixed,
            default: undefined
        },

        newValue: {
            type: Schema.Types.Mixed,
            default: undefined
        },

        previousVersion: {
            type: Number,
            min: 0,
            default: null
        },

        newVersion: {
            type: Number,
            min: 0,
            default: null
        },

        requestId: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null
        },

        source: {
            type: String,
            trim: true,
            lowercase: true,
            maxlength: 100,
            default: 'system'
        },

        details: {
            type: Schema.Types.Mixed,
            default: undefined
        }
    },
    {
        _id: false,
        strict: true
    }
);

/**
 * ============================================================================
 * SYSTEM SETTING SCHEMA
 * ============================================================================
 */

const SystemSettingSchema = new Schema(
    {
        /**
         * ====================================================================
         * TENANT
         * ====================================================================
         */

        tenantId: {
            type: String,
            required: true,
            default: SYSTEM_TENANT_ID,
            trim: true,
            uppercase: true,
            minlength: 1,
            maxlength: 100,
            immutable: true,
            index: true
        },

        /**
         * ====================================================================
         * SETTING KEY
         * ====================================================================
         */

        key: {
            type: String,
            required: true,
            trim: true,
            uppercase: true,
            minlength: 1,
            maxlength: MAX_KEY_LENGTH,
            immutable: true,

            match: [
                /^[A-Z][A-Z0-9_.:-]*$/,
                'System setting key contains invalid characters.'
            ]
        },

        /**
         * ====================================================================
         * CATEGORY
         * ====================================================================
         */

        category: {
            type: String,
            required: true,
            enum: CATEGORIES,
            uppercase: true,
            trim: true,
            index: true
        },

        /**
         * ====================================================================
         * DISPLAY INFORMATION
         * ====================================================================
         */

        name: {
            type: String,
            trim: true,
            maxlength: MAX_NAME_LENGTH,
            default: null
        },

        description: {
            type: String,
            trim: true,
            maxlength: MAX_DESCRIPTION_LENGTH,
            default: null
        },

        /**
         * ====================================================================
         * VALUE
         * ====================================================================
         */

        value: {
            type: Schema.Types.Mixed,
            required: true
        },

        /**
         * ====================================================================
         * VALUE TYPE
         * ====================================================================
         */

        valueType: {
            type: String,
            required: true,
            enum: VALUE_TYPES,
            uppercase: true,
            default: 'STRING'
        },

        /**
         * ====================================================================
         * OPERATIONAL STATUS
         * ====================================================================
         */

        enabled: {
            type: Boolean,
            default: true,
            index: true
        },

        /**
         * ====================================================================
         * LIFECYCLE
         * ====================================================================
         *
         * retired:
         *
         *   The configuration is no longer intended for operational use.
         *
         * deleted:
         *
         *   Logical deletion marker. Physical deletion is deliberately avoided
         *   for configuration history.
         */

        retired: {
            type: Boolean,
            default: false,
            index: true
        },

        retiredAt: {
            type: Date,
            default: null
        },

        retiredBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        deleted: {
            type: Boolean,
            default: false,
            index: true
        },

        deletedAt: {
            type: Date,
            default: null
        },

        deletedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * ====================================================================
         * PROTECTION
         * ====================================================================
         */

        isSystem: {
            type: Boolean,
            default: false,
            index: true
        },

        editable: {
            type: Boolean,
            default: true,
            index: true
        },

        /**
         * Indicates that the value should be treated as sensitive by services
         * that serialize configuration for logs/API responses.
         *
         * This does NOT encrypt the value.
         *
         * Secrets should preferably live in a dedicated secrets manager.
         */

        sensitive: {
            type: Boolean,
            default: false,
            index: true
        },

        /**
         * ====================================================================
         * COMPLIANCE
         * ====================================================================
         */

        complianceRelevant: {
            type: Boolean,
            default: false,
            index: true
        },

        regulatoryCritical: {
            type: Boolean,
            default: false,
            index: true
        },

        /**
         * ====================================================================
         * VERSION
         * ====================================================================
         *
         * Application-level configuration version.
         *
         * This is intentionally independent of MongoDB's __v.
         *
         * Every successful configuration mutation advances this number.
         */

        version: {
            type: Number,
            required: true,
            default: 1,
            min: 1
        },

        /**
         * ====================================================================
         * AUDIT ACTORS
         * ====================================================================
         */

        createdBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        updatedBy: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            default: null
        },

        /**
         * ====================================================================
         * REQUEST / CORRELATION
         * ====================================================================
         */

        lastRequestId: {
            type: String,
            trim: true,
            maxlength: 200,
            default: null,
            index: true
        },

        /**
         * ====================================================================
         * AUDIT TRAIL
         * ====================================================================
         */

        auditLog: {
            type: [SettingAuditSchema],
            default: []
        },

        /**
         * ====================================================================
         * METADATA
         * ====================================================================
         */

        metadata: {
            type: Schema.Types.Mixed,
            default: {}
        }
    },
    {
        timestamps: true,

        optimisticConcurrency: true,

        strict: true,

        minimize: false,

        versionKey: '__v',

        toJSON: {
            virtuals: true,

            transform(doc, ret) {
                if (ret._id) {
                    ret.id = String(ret._id);
                }

                delete ret._id;
                delete ret.__v;

                /**
                 * Never serialize a sensitive configuration value through
                 * the ordinary JSON representation.
                 *
                 * Consumers needing the actual secret must use a dedicated
                 * privileged secret-management mechanism.
                 */

                if (ret.sensitive === true) {
                    ret.value = '[REDACTED]';
                }

                return ret;
            }
        },

        toObject: {
            virtuals: true
        }
    }
);

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

SystemSettingSchema.index(
    {
        tenantId: 1,
        key: 1
    },
    {
        unique: true,
        name: 'uq_system_setting_tenant_key'
    }
);

SystemSettingSchema.index(
    {
        tenantId: 1,
        category: 1,
        enabled: 1,
        deleted: 1
    },
    {
        name: 'idx_system_setting_tenant_category_enabled'
    }
);

SystemSettingSchema.index(
    {
        tenantId: 1,
        complianceRelevant: 1,
        enabled: 1
    },
    {
        name: 'idx_system_setting_compliance'
    }
);

SystemSettingSchema.index(
    {
        tenantId: 1,
        regulatoryCritical: 1,
        enabled: 1
    },
    {
        name: 'idx_system_setting_regulatory'
    }
);

SystemSettingSchema.index(
    {
        tenantId: 1,
        updatedAt: -1
    },
    {
        name: 'idx_system_setting_updated'
    }
);

SystemSettingSchema.index(
    {
        tenantId: 1,
        category: 1,
        key: 1
    },
    {
        name: 'idx_system_setting_category_key'
    }
);

SystemSettingSchema.index(
    {
        tenantId: 1,
        retired: 1,
        deleted: 1
    },
    {
        name: 'idx_system_setting_lifecycle'
    }
);

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

SystemSettingSchema.virtual('isGlobal')
    .get(function () {
        return (
            this.tenantId ===
            SYSTEM_TENANT_ID
        );
    });

SystemSettingSchema.virtual('isTenantOverride')
    .get(function () {
        return (
            this.tenantId !==
            SYSTEM_TENANT_ID
        );
    });

SystemSettingSchema.virtual('isActive')
    .get(function () {
        return (
            this.enabled === true &&
            this.retired !== true &&
            this.deleted !== true
        );
    });

/**
 * ============================================================================
 * DOCUMENT VALIDATION
 * ============================================================================
 */

SystemSettingSchema.pre(
    'validate',
    function (next) {
        try {
            this.tenantId =
                normalizeTenantId(
                    this.tenantId
                );

            this.key =
                normalizeKey(
                    this.key
                );

            this.category =
                normalizeCategory(
                    this.category
                );

            if (!this.key) {
                return next(
                    createSettingError(
                        'System setting key is required.',
                        'SYSTEM_SETTING_KEY_REQUIRED'
                    )
                );
            }

            if (!isValidSettingKey(this.key)) {
                return next(
                    createSettingError(
                        'System setting key contains invalid characters.',
                        'SYSTEM_SETTING_INVALID_KEY'
                    )
                );
            }

            if (!this.valueType) {
                this.valueType =
                    detectValueType(
                        this.value
                    );
            }

            this.valueType =
                String(
                    this.valueType
                )
                    .trim()
                    .toUpperCase();

            if (
                !VALUE_TYPES.includes(
                    this.valueType
                )
            ) {
                return next(
                    createSettingError(
                        `Unsupported system setting value type: ${this.valueType}.`,
                        'SYSTEM_SETTING_INVALID_VALUE_TYPE'
                    )
                );
            }

            if (
                !validateValueType(
                    this.value,
                    this.valueType
                )
            ) {
                return next(
                    createSettingError(
                        `System setting value does not match valueType ${this.valueType}.`,
                        'SYSTEM_SETTING_VALUE_TYPE_MISMATCH'
                    )
                );
            }

            if (
                this.isSystem === true &&
                this.tenantId !==
                SYSTEM_TENANT_ID
            ) {
                return next(
                    createSettingError(
                        'isSystem settings must belong to the SYSTEM tenant scope.',
                        'SYSTEM_SETTING_INVALID_SCOPE'
                    )
                );
            }

            /**
             * SYSTEM settings are protected by default.
             */

            if (
                this.isSystem === true
            ) {
                this.editable = false;
            }

            if (
                this.retired === true
            ) {
                this.enabled = false;
            }

            if (
                this.deleted === true
            ) {
                this.enabled = false;
            }

            if (
                !Number.isInteger(
                    this.version
                ) ||
                this.version < 1
            ) {
                this.version = 1;
            }

            if (
                !validateMetadata(
                    this.metadata
                )
            ) {
                return next(
                    createSettingError(
                        'System setting metadata exceeds the supported structure.',
                        'SYSTEM_SETTING_INVALID_METADATA'
                    )
                );
            }

            next();
        } catch (error) {
            next(error);
        }
    }
);

/**
 * ============================================================================
 * PRE-SAVE VERSION MANAGEMENT
 * ============================================================================
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * Explicit version increments are NOT performed by enable()/disable() before
 * save(). Those methods rely on this middleware.
 *
 * This prevents accidental double increments.
 * ============================================================================
 */

SystemSettingSchema.pre(
    'save',
    function (next) {
        if (
            this.isNew
        ) {
            this.version = 1;
            return next();
        }

        const configurationFields = [
            'value',
            'valueType',
            'enabled',
            'editable',
            'metadata',
            'description',
            'name',
            'category',
            'complianceRelevant',
            'regulatoryCritical',
            'sensitive',
            'retired',
            'deleted'
        ];

        const configurationChanged =
            configurationFields.some(
                field =>
                    this.isModified(field)
            );

        if (
            configurationChanged
        ) {
            this.version =
                Math.max(
                    1,
                    Number(
                        this.version || 1
                    )
                ) + 1;
        }

        next();
    }
);

/**
 * ============================================================================
 * QUERY NORMALIZATION
 * ============================================================================
 */

SystemSettingSchema.pre(
    [
        'find',
        'findOne',
        'findOneAndUpdate',
        'findOneAndReplace',
        'countDocuments'
    ],
    function () {
        const query =
            this.getQuery();

        if (
            query &&
            query.tenantId !== undefined
        ) {
            query.tenantId =
                normalizeTenantId(
                    query.tenantId
                );
        }

        if (
            query &&
            typeof query.key ===
            'string'
        ) {
            query.key =
                normalizeKey(
                    query.key
                );
        }

        if (
            query &&
            typeof query.category ===
            'string'
        ) {
            query.category =
                normalizeCategory(
                    query.category
                );
        }
    }
);

/**
 * ============================================================================
 * UPDATE GUARD
 * ============================================================================
 *
 * Prevent direct update APIs from silently modifying immutable identity fields.
 * ============================================================================
 */

SystemSettingSchema.pre(
    'findOneAndUpdate',
    function (next) {
        const update =
            this.getUpdate() || {};

        const forbiddenFields = [
            'tenantId',
            'key'
        ];

        for (
            const field of forbiddenFields
        ) {
            if (
                update[field] !== undefined
            ) {
                return next(
                    createSettingError(
                        `${field} cannot be modified after a system setting is created.`,
                        'SYSTEM_SETTING_IDENTITY_IMMUTABLE'
                    )
                );
            }

            if (
                update.$set &&
                update.$set[field] !==
                undefined
            ) {
                return next(
                    createSettingError(
                        `${field} cannot be modified after a system setting is created.`,
                        'SYSTEM_SETTING_IDENTITY_IMMUTABLE'
                    )
                );
            }
        }

        next();
    }
);

/**
 * ============================================================================
 * STATIC: NORMALIZE KEY
 * ============================================================================
 */

SystemSettingSchema.statics.normalizeKey =
    function (key) {
        return normalizeKey(key);
    };

/**
 * ============================================================================
 * STATIC: NORMALIZE TENANT
 * ============================================================================
 */

SystemSettingSchema.statics.normalizeTenantId =
    function (tenantId) {
        return normalizeTenantId(
            tenantId
        );
    };

/**
 * ============================================================================
 * STATIC: GET VALUE
 * ============================================================================
 */

SystemSettingSchema.statics.getValue =
    async function (
        key,
        tenantId = SYSTEM_TENANT_ID,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedKey =
            normalizeKey(key);

        if (
            !normalizedKey
        ) {
            return (
                options.fallback !==
                undefined
                    ? options.fallback
                    : null
            );
        }

        const setting =
            await this.findOne({
                tenantId:
                    normalizedTenantId,
                key:
                    normalizedKey,
                enabled: true,
                retired: false,
                deleted: false
            }).lean();

        if (!setting) {
            return (
                options.fallback !==
                undefined
                    ? options.fallback
                    : null
            );
        }

        return setting.value;
    };

/**
 * ============================================================================
 * STATIC: GET SETTING
 * ============================================================================
 */

SystemSettingSchema.statics.getSetting =
    async function (
        key,
        tenantId = SYSTEM_TENANT_ID
    ) {
        return this.findOne({
            tenantId:
                normalizeTenantId(
                    tenantId
                ),
            key:
                normalizeKey(key)
        });
    };

/**
 * ============================================================================
 * STATIC: GET CATEGORY
 * ============================================================================
 */

SystemSettingSchema.statics.getCategory =
    async function (
        category,
        tenantId = SYSTEM_TENANT_ID,
        options = {}
    ) {
        return this.find({
            tenantId:
                normalizeTenantId(
                    tenantId
                ),
            category:
                normalizeCategory(
                    category
                ),
            ...(options.includeDisabled
                ? {}
                : {
                    enabled: true
                }),
            ...(options.includeRetired
                ? {}
                : {
                    retired: false
                }),
            ...(options.includeDeleted
                ? {}
                : {
                    deleted: false
                })
        })
            .sort({
                key: 1
            });
    };

/**
 * ============================================================================
 * STATIC: GET ALL SETTINGS
 * ============================================================================
 */

SystemSettingSchema.statics.getAllSettings =
    async function (
        tenantId = SYSTEM_TENANT_ID,
        options = {}
    ) {
        return this.find({
            tenantId:
                normalizeTenantId(
                    tenantId
                ),
            ...(options.includeDisabled
                ? {}
                : {
                    enabled: true
                }),
            ...(options.includeRetired
                ? {}
                : {
                    retired: false
                }),
            ...(options.includeDeleted
                ? {}
                : {
                    deleted: false
                })
        })
            .sort({
                category: 1,
                key: 1
            });
    };

/**
 * ============================================================================
 * STATIC: SET VALUE
 * ============================================================================
 *
 * Atomic configuration mutation.
 *
 * Concurrency model:
 *
 *   Existing setting + expectedVersion
 *       ↓
 *   atomic filter
 *       ↓
 *   successful update
 *       ↓
 *   version + 1
 *
 * If another process updates the setting first, the version predicate fails.
 * ============================================================================
 */

SystemSettingSchema.statics.setValue =
    async function (
        key,
        value,
        tenantId = SYSTEM_TENANT_ID,
        updatedBy = null,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedKey =
            normalizeKey(key);

        if (
            !normalizedKey
        ) {
            throw createSettingError(
                'System setting key is required.',
                'SYSTEM_SETTING_KEY_REQUIRED'
            );
        }

        if (
            !isValidSettingKey(
                normalizedKey
            )
        ) {
            throw createSettingError(
                'System setting key contains invalid characters.',
                'SYSTEM_SETTING_INVALID_KEY'
            );
        }

        const valueType =
            String(
                options.valueType ||
                detectValueType(value)
            )
                .trim()
                .toUpperCase();

        if (
            !VALUE_TYPES.includes(
                valueType
            )
        ) {
            throw createSettingError(
                `Unsupported valueType ${valueType}.`,
                'SYSTEM_SETTING_INVALID_VALUE_TYPE'
            );
        }

        if (
            !validateValueType(
                value,
                valueType
            )
        ) {
            throw createSettingError(
                `Value does not match valueType ${valueType}.`,
                'SYSTEM_SETTING_VALUE_TYPE_MISMATCH'
            );
        }

        const existing =
            await this.findOne({
                tenantId:
                    normalizedTenantId,
                key:
                    normalizedKey
            })
                .select({
                    tenantId: 1,
                    key: 1,
                    editable: 1,
                    isSystem: 1,
                    version: 1,
                    value: 1,
                    valueType: 1,
                    enabled: 1,
                    retired: 1,
                    deleted: 1
                });

        if (
            existing &&
            (
                existing.isSystem === true ||
                existing.editable === false
            ) &&
            options.allowProtectedUpdate !== true
        ) {
            throw createSettingError(
                'This system setting is protected and cannot be modified through the standard setting API.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        if (
            existing &&
            existing.deleted === true &&
            options.allowDeletedUpdate !== true
        ) {
            throw createSettingError(
                'Deleted system settings cannot be modified without explicit restoration authorization.',
                'SYSTEM_SETTING_DELETED'
            );
        }

        const previousVersion =
            existing
                ? Number(
                    existing.version
                )
                : 0;

        if (
            options.expectedVersion !==
            undefined &&
            existing &&
            Number(
                options.expectedVersion
            ) !== previousVersion
        ) {
            throw createSettingError(
                'System setting version conflict.',
                'SYSTEM_SETTING_VERSION_CONFLICT',
                {
                    expectedVersion:
                        Number(
                            options.expectedVersion
                        ),
                    actualVersion:
                        previousVersion
                }
            );
        }

        const nextVersion =
            existing
                ? previousVersion + 1
                : 1;

        const now =
            new Date();

        const auditEntry = {
            action:
                existing
                    ? 'VALUE_UPDATE'
                    : 'CREATE',

            userId:
                updatedBy || null,

            timestamp:
                now,

            previousValue:
                existing
                    ? cloneValue(
                        existing.value
                    )
                    : undefined,

            newValue:
                cloneValue(value),

            previousVersion:
                existing
                    ? previousVersion
                    : null,

            newVersion:
                nextVersion,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                ),

            details:
                options.auditDetails
                    ? cloneValue(
                        options.auditDetails
                    )
                    : undefined
        };

        const update = {
            $set: {
                value:
                    cloneValue(value),

                valueType,

                updatedBy:
                    updatedBy || null,

                lastRequestId:
                    options.requestId ||
                    null,

                version:
                    nextVersion,

                updatedAt:
                    now
            },

            $push: {
                auditLog: {
                    $each: [
                        auditEntry
                    ],
                    $slice:
                        -MAX_AUDIT_ENTRIES
                }
            },

            $setOnInsert: {
                tenantId:
                    normalizedTenantId,

                key:
                    normalizedKey,

                category:
                    normalizeCategory(
                        options.category ||
                        'SYSTEM'
                    ),

                name:
                    options.name ||
                    null,

                description:
                    options.description ||
                    null,

                enabled:
                    options.enabled !==
                    undefined
                        ? Boolean(
                            options.enabled
                        )
                        : true,

                isSystem:
                    normalizedTenantId ===
                    SYSTEM_TENANT_ID,

                editable:
                    normalizedTenantId ===
                    SYSTEM_TENANT_ID
                        ? false
                        : (
                            options.editable !==
                            undefined
                                ? Boolean(
                                    options.editable
                                )
                                : true
                        ),

                sensitive:
                    Boolean(
                        options.sensitive
                    ),

                complianceRelevant:
                    Boolean(
                        options.complianceRelevant
                    ),

                regulatoryCritical:
                    Boolean(
                        options.regulatoryCritical
                    ),

                retired: false,

                deleted: false,

                version: 1,

                createdBy:
                    updatedBy || null,

                metadata:
                    options.metadata
                        ? cloneValue(
                            options.metadata
                        )
                        : {}
            }
        };

        /**
         * For an existing setting, the optimistic concurrency predicate is
         * version-based.
         *
         * For creation, the unique tenant/key index prevents duplicates.
         */

        const query = {
            tenantId:
                normalizedTenantId,

            key:
                normalizedKey
        };

        if (
            existing
        ) {
            query.version =
                options.expectedVersion !==
                undefined
                    ? Number(
                        options.expectedVersion
                    )
                    : previousVersion;
        } else if (
            options.expectedVersion !==
            undefined &&
            Number(
                options.expectedVersion
            ) !== 0
        ) {
            throw createSettingError(
                'A new system setting must start at expectedVersion 0.',
                'SYSTEM_SETTING_VERSION_CONFLICT'
            );
        }

        let result;

        try {
            result =
                await this.findOneAndUpdate(
                    query,
                    update,
                    {
                        new: true,
                        upsert: true,
                        runValidators: true,
                        setDefaultsOnInsert: true,
                        context: 'query'
                    }
                );
        } catch (error) {
            /**
             * Duplicate key means another process created the setting between
             * the initial read and atomic upsert.
             */

            if (
                error &&
                error.code === 11000
            ) {
                throw createSettingError(
                    'System setting creation conflicted with another concurrent configuration operation.',
                    'SYSTEM_SETTING_CONCURRENT_CREATION'
                );
            }

            throw error;
        }

        if (
            !result
        ) {
            throw createSettingError(
                'System setting update failed because the configuration version changed.',
                'SYSTEM_SETTING_VERSION_CONFLICT'
            );
        }

        return result;
    };

/**
 * ============================================================================
 * STATIC: UPDATE SETTING
 * ============================================================================
 */

SystemSettingSchema.statics.updateSetting =
    async function (
        key,
        updates = {},
        tenantId = SYSTEM_TENANT_ID,
        updatedBy = null,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const normalizedKey =
            normalizeKey(key);

        if (
            !normalizedKey
        ) {
            throw createSettingError(
                'System setting key is required.',
                'SYSTEM_SETTING_KEY_REQUIRED'
            );
        }

        const existing =
            await this.findOne({
                tenantId:
                    normalizedTenantId,
                key:
                    normalizedKey
            });

        if (
            !existing
        ) {
            throw createSettingError(
                'System setting not found.',
                'SYSTEM_SETTING_NOT_FOUND'
            );
        }

        if (
            (
                existing.isSystem === true ||
                existing.editable === false
            ) &&
            options.allowProtectedUpdate !== true
        ) {
            throw createSettingError(
                'This system setting is protected.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        if (
            existing.deleted === true &&
            options.allowDeletedUpdate !== true
        ) {
            throw createSettingError(
                'Deleted system settings cannot be modified.',
                'SYSTEM_SETTING_DELETED'
            );
        }

        const allowedFields = [
            'name',
            'description',
            'category',
            'value',
            'valueType',
            'enabled',
            'complianceRelevant',
            'regulatoryCritical',
            'metadata',
            'sensitive',
            'retired',
            'deleted'
        ];

        const sanitized = {};

        for (
            const field of allowedFields
        ) {
            if (
                Object.prototype.hasOwnProperty.call(
                    updates,
                    field
                )
            ) {
                sanitized[field] =
                    updates[field];
            }
        }

        if (
            Object.prototype.hasOwnProperty.call(
                sanitized,
                'category'
            )
        ) {
            sanitized.category =
                normalizeCategory(
                    sanitized.category
                );
        }

        if (
            Object.prototype.hasOwnProperty.call(
                sanitized,
                'value'
            )
        ) {
            sanitized.valueType =
                sanitized.valueType ||
                detectValueType(
                    sanitized.value
                );
        }

        if (
            sanitized.valueType !==
            undefined
        ) {
            sanitized.valueType =
                String(
                    sanitized.valueType
                )
                    .trim()
                    .toUpperCase();
        }

        if (
            sanitized.value !==
            undefined
        ) {
            const type =
                sanitized.valueType ||
                existing.valueType;

            if (
                !validateValueType(
                    sanitized.value,
                    type
                )
            ) {
                throw createSettingError(
                    'System setting value does not match its declared value type.',
                    'SYSTEM_SETTING_VALUE_TYPE_MISMATCH'
                );
            }
        }

        if (
            sanitized.metadata !==
            undefined &&
            !validateMetadata(
                sanitized.metadata
            )
        ) {
            throw createSettingError(
                'System setting metadata exceeds the supported structure.',
                'SYSTEM_SETTING_INVALID_METADATA'
            );
        }

        if (
            sanitized.deleted === true
        ) {
            sanitized.enabled = false;
        }

        if (
            sanitized.retired === true
        ) {
            sanitized.enabled = false;
        }

        const previousVersion =
            Number(
                existing.version
            );

        const expectedVersion =
            options.expectedVersion !==
            undefined
                ? Number(
                    options.expectedVersion
                )
                : previousVersion;

        const now =
            new Date();

        const valueChanged =
            Object.prototype.hasOwnProperty.call(
                sanitized,
                'value'
            );

        const auditEntry = {
            action:
                valueChanged
                    ? 'VALUE_UPDATE'
                    : 'UPDATE',

            userId:
                updatedBy || null,

            timestamp:
                now,

            previousValue:
                valueChanged
                    ? cloneValue(
                        existing.value
                    )
                    : undefined,

            newValue:
                valueChanged
                    ? cloneValue(
                        sanitized.value
                    )
                    : undefined,

            previousVersion,

            newVersion:
                previousVersion + 1,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                ),

            details:
                options.auditDetails
                    ? cloneValue(
                        options.auditDetails
                    )
                    : undefined
        };

        const updated =
            await this.findOneAndUpdate(
                {
                    _id:
                        existing._id,

                    tenantId:
                        normalizedTenantId,

                    key:
                        normalizedKey,

                    version:
                        expectedVersion
                },
                {
                    $set: {
                        ...sanitized,

                        updatedBy:
                            updatedBy || null,

                        lastRequestId:
                            options.requestId ||
                            null,

                        updatedAt:
                            now,

                        version:
                            previousVersion + 1
                    },

                    $push: {
                        auditLog: {
                            $each: [
                                auditEntry
                            ],
                            $slice:
                                -MAX_AUDIT_ENTRIES
                        }
                    }
                },
                {
                    new: true,
                    runValidators: true,
                    context: 'query'
                }
            );

        if (
            !updated
        ) {
            throw createSettingError(
                'System setting update failed because the configuration version changed.',
                'SYSTEM_SETTING_VERSION_CONFLICT',
                {
                    expectedVersion,
                    actualVersion:
                        previousVersion
                }
            );
        }

        return updated;
    };

/**
 * ============================================================================
 * INSTANCE: ENABLE
 * ============================================================================
 */

SystemSettingSchema.methods.enable =
    async function (
        userId = null,
        options = {}
    ) {
        if (
            (
                this.isSystem ||
                this.editable === false
            ) &&
            options.allowProtectedUpdate !==
            true
        ) {
            throw createSettingError(
                'Protected system settings require privileged update authorization.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        if (
            this.deleted === true
        ) {
            throw createSettingError(
                'Deleted system settings cannot be enabled.',
                'SYSTEM_SETTING_DELETED'
            );
        }

        const previousVersion =
            Number(
                this.version
            );

        this.enabled = true;
        this.retired = false;

        this.updatedBy =
            userId ||
            this.updatedBy;

        this.lastRequestId =
            options.requestId ||
            this.lastRequestId;

        this.auditLog.push({
            action:
                'ENABLE',

            userId,

            timestamp:
                new Date(),

            previousVersion,

            newVersion:
                previousVersion + 1,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                )
        });

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE: DISABLE
 * ============================================================================
 */

SystemSettingSchema.methods.disable =
    async function (
        userId = null,
        options = {}
    ) {
        if (
            (
                this.isSystem ||
                this.editable === false
            ) &&
            options.allowProtectedUpdate !==
            true
        ) {
            throw createSettingError(
                'Protected system settings require privileged update authorization.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        const previousVersion =
            Number(
                this.version
            );

        this.enabled = false;

        this.updatedBy =
            userId ||
            this.updatedBy;

        this.lastRequestId =
            options.requestId ||
            this.lastRequestId;

        this.auditLog.push({
            action:
                'DISABLE',

            userId,

            timestamp:
                new Date(),

            previousVersion,

            newVersion:
                previousVersion + 1,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                )
        });

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE: RETIRE
 * ============================================================================
 */

SystemSettingSchema.methods.retire =
    async function (
        userId = null,
        options = {}
    ) {
        if (
            (
                this.isSystem ||
                this.editable === false
            ) &&
            options.allowProtectedUpdate !==
            true
        ) {
            throw createSettingError(
                'Protected system settings require privileged update authorization.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        const previousVersion =
            Number(
                this.version
            );

        this.retired = true;
        this.enabled = false;
        this.retiredAt =
            new Date();
        this.retiredBy =
            userId || null;

        this.updatedBy =
            userId ||
            this.updatedBy;

        this.auditLog.push({
            action:
                'RETIRE',

            userId,

            timestamp:
                new Date(),

            previousVersion,

            newVersion:
                previousVersion + 1,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                )
        });

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE: RESTORE
 * ============================================================================
 */

SystemSettingSchema.methods.restore =
    async function (
        userId = null,
        options = {}
    ) {
        if (
            (
                this.isSystem ||
                this.editable === false
            ) &&
            options.allowProtectedUpdate !==
            true
        ) {
            throw createSettingError(
                'Protected system settings require privileged update authorization.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        const previousVersion =
            Number(
                this.version
            );

        this.deleted = false;
        this.deletedAt = null;
        this.deletedBy = null;

        this.retired = false;
        this.retiredAt = null;
        this.retiredBy = null;

        this.enabled =
            options.enabled !== undefined
                ? Boolean(
                    options.enabled
                )
                : true;

        this.updatedBy =
            userId ||
            this.updatedBy;

        this.auditLog.push({
            action:
                'RESTORE',

            userId,

            timestamp:
                new Date(),

            previousVersion,

            newVersion:
                previousVersion + 1,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                )
        });

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE: SOFT DELETE
 * ============================================================================
 */

SystemSettingSchema.methods.softDelete =
    async function (
        userId = null,
        options = {}
    ) {
        if (
            (
                this.isSystem ||
                this.editable === false
            ) &&
            options.allowProtectedUpdate !==
            true
        ) {
            throw createSettingError(
                'Protected system settings cannot be deleted.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        const previousVersion =
            Number(
                this.version
            );

        this.deleted = true;
        this.deletedAt =
            new Date();
        this.deletedBy =
            userId || null;
        this.enabled = false;

        this.updatedBy =
            userId ||
            this.updatedBy;

        this.auditLog.push({
            action:
                'DELETE',

            userId,

            timestamp:
                new Date(),

            previousVersion,

            newVersion:
                previousVersion + 1,

            requestId:
                options.requestId ||
                null,

            source:
                normalizeSource(
                    options.source
                )
        });

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE: BUMP VERSION
 * ============================================================================
 *
 * This is intentionally implemented by modifying metadata rather than
 * manually incrementing version, because the save middleware owns version
 * management.
 * ============================================================================
 */

SystemSettingSchema.methods.bumpVersion =
    async function (
        userId = null
    ) {
        this.updatedBy =
            userId ||
            this.updatedBy;

        /**
         * Touch metadata so save() recognizes a configuration mutation.
         */

        this.metadata =
            cloneValue(
                this.metadata || {}
            );

        this.metadata._versionBumpAt =
            new Date();

        return this.save();
    };

/**
 * ============================================================================
 * INSTANCE: IS EDITABLE
 * ============================================================================
 */

SystemSettingSchema.methods.isEditable =
    function () {
        return (
            this.editable === true &&
            this.isSystem !== true &&
            this.deleted !== true
        );
    };

/**
 * ============================================================================
 * INSTANCE: IS ACTIVE
 * ============================================================================
 */

SystemSettingSchema.methods.isActive =
    function () {
        return (
            this.enabled === true &&
            this.retired !== true &&
            this.deleted !== true
        );
    };

/**
 * ============================================================================
 * INSTANCE: GET VALUE
 * ============================================================================
 */

SystemSettingSchema.methods.getValue =
    function () {
        return this.value;
    };

/**
 * ============================================================================
 * INSTANCE: GET SAFE VALUE
 * ============================================================================
 */

SystemSettingSchema.methods.getSafeValue =
    function () {
        if (
            this.sensitive === true
        ) {
            return '[REDACTED]';
        }

        return cloneValue(
            this.value
        );
    };

/**
 * ============================================================================
 * STATIC: DISABLE TENANT OVERRIDE
 * ============================================================================
 *
 * Tenant overrides are retained for historical/audit purposes.
 * ============================================================================
 */

SystemSettingSchema.statics.disableTenantOverride =
    async function (
        key,
        tenantId,
        updatedBy = null,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        if (
            normalizedTenantId ===
            SYSTEM_TENANT_ID
        ) {
            throw createSettingError(
                'SYSTEM settings cannot be disabled as tenant overrides.',
                'SYSTEM_SETTING_INVALID_SCOPE'
            );
        }

        const existing =
            await this.findOne({
                tenantId:
                    normalizedTenantId,
                key:
                    normalizeKey(key)
            });

        if (
            !existing
        ) {
            return null;
        }

        if (
            existing.editable === false &&
            options.allowProtectedUpdate !==
            true
        ) {
            throw createSettingError(
                'This tenant setting is protected.',
                'SYSTEM_SETTING_PROTECTED'
            );
        }

        return this.updateSetting(
            key,
            {
                enabled: false
            },
            normalizedTenantId,
            updatedBy,
            options
        );
    };

/**
 * ============================================================================
 * STATIC: GET EFFECTIVE VALUE
 * ============================================================================
 *
 * Resolution hierarchy:
 *
 *   1. Active tenant override
 *   2. Active SYSTEM setting
 *   3. supplied fallback
 * ============================================================================
 */

SystemSettingSchema.statics.getEffectiveValue =
    async function (
        key,
        tenantId,
        fallback = null
    ) {
        const normalizedKey =
            normalizeKey(key);

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        if (
            !normalizedKey
        ) {
            return fallback;
        }

        if (
            normalizedTenantId !==
            SYSTEM_TENANT_ID
        ) {
            const tenantSetting =
                await this.findOne({
                    tenantId:
                        normalizedTenantId,

                    key:
                        normalizedKey,

                    enabled: true,

                    retired: false,

                    deleted: false
                }).lean();

            if (
                tenantSetting
            ) {
                return tenantSetting.value;
            }
        }

        const systemSetting =
            await this.findOne({
                tenantId:
                    SYSTEM_TENANT_ID,

                key:
                    normalizedKey,

                enabled: true,

                retired: false,

                deleted: false
            }).lean();

        return systemSetting
            ? systemSetting.value
            : fallback;
    };

/**
 * ============================================================================
 * STATIC: GET EFFECTIVE SETTING
 * ============================================================================
 */

SystemSettingSchema.statics.getEffectiveSetting =
    async function (
        key,
        tenantId
    ) {
        const normalizedKey =
            normalizeKey(key);

        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        if (
            normalizedTenantId !==
            SYSTEM_TENANT_ID
        ) {
            const tenantSetting =
                await this.findOne({
                    tenantId:
                        normalizedTenantId,

                    key:
                        normalizedKey,

                    enabled: true,

                    retired: false,

                    deleted: false
                });

            if (
                tenantSetting
            ) {
                return tenantSetting;
            }
        }

        return this.findOne({
            tenantId:
                SYSTEM_TENANT_ID,

            key:
                normalizedKey,

            enabled: true,

            retired: false,

            deleted: false
        });
    };

/**
 * ============================================================================
 * STATIC: GET EFFECTIVE SETTINGS
 * ============================================================================
 *
 * Returns the complete effective configuration for a tenant.
 *
 * Tenant values override SYSTEM values with the same key.
 * ============================================================================
 */

SystemSettingSchema.statics.getEffectiveSettings =
    async function (
        tenantId,
        options = {}
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const [
            systemSettings,
            tenantSettings
        ] = await Promise.all([
            this.find({
                tenantId:
                    SYSTEM_TENANT_ID,

                enabled: true,

                retired: false,

                deleted: false,

                ...(options.category
                    ? {
                        category:
                            normalizeCategory(
                                options.category
                            )
                    }
                    : {})
            }).lean(),

            normalizedTenantId !==
            SYSTEM_TENANT_ID
                ? this.find({
                    tenantId:
                        normalizedTenantId,

                    enabled: true,

                    retired: false,

                    deleted: false,

                    ...(options.category
                        ? {
                            category:
                                normalizeCategory(
                                    options.category
                                )
                        }
                        : {})
                }).lean()
                : []
        ]);

        const effective =
            new Map();

        for (
            const setting
            of systemSettings
        ) {
            effective.set(
                setting.key,
                setting
            );
        }

        for (
            const setting
            of tenantSettings
        ) {
            effective.set(
                setting.key,
                setting
            );
        }

        return Array.from(
            effective.values()
        ).sort(
            (a, b) =>
                a.category.localeCompare(
                    b.category
                ) ||
                a.key.localeCompare(
                    b.key
                )
        );
    };

/**
 * ============================================================================
 * STATIC: GET EFFECTIVE CONFIGURATION OBJECT
 * ============================================================================
 *
 * Converts effective settings into:
 *
 * {
 *   SECURITY: {
 *      PASSWORD_MIN_LENGTH: 12
 *   }
 * }
 *
 * Duplicate keys are impossible within a tenant scope.
 * ============================================================================
 */

SystemSettingSchema.statics.getEffectiveConfiguration =
    async function (
        tenantId,
        options = {}
    ) {
        const settings =
            await this.getEffectiveSettings(
                tenantId,
                options
            );

        const configuration = {};

        for (
            const setting
            of settings
        ) {
            if (
                !configuration[
                    setting.category
                ]
            ) {
                configuration[
                    setting.category
                ] = {};
            }

            configuration[
                setting.category
            ][setting.key] =
                setting.sensitive === true
                    ? '[REDACTED]'
                    : cloneValue(
                        setting.value
                    );
        }

        return configuration;
    };

/**
 * ============================================================================
 * STATIC: FIND BY REQUEST ID
 * ============================================================================
 */

SystemSettingSchema.statics.findByRequestId =
    async function (
        requestId,
        tenantId = SYSTEM_TENANT_ID
    ) {
        if (
            !requestId
        ) {
            return [];
        }

        return this.find({
            tenantId:
                normalizeTenantId(
                    tenantId
                ),

            lastRequestId:
                String(
                    requestId
                ).trim()
        }).sort({
            updatedAt: -1
        });
    };

/**
 * ============================================================================
 * STATIC: HEALTH SUMMARY
 * ============================================================================
 */

SystemSettingSchema.statics.getHealthSummary =
    async function (
        tenantId = SYSTEM_TENANT_ID
    ) {
        const normalizedTenantId =
            normalizeTenantId(
                tenantId
            );

        const [
            total,
            enabled,
            disabled,
            retired,
            deleted,
            editable,
            protectedCount,
            sensitive,
            complianceRelevant,
            regulatoryCritical
        ] = await Promise.all([
            this.countDocuments({
                tenantId:
                    normalizedTenantId
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                enabled: true,
                retired: false,
                deleted: false
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                enabled: false,
                deleted: false
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                retired: true,
                deleted: false
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                deleted: true
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                editable: true,
                isSystem: false,
                deleted: false
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                editable: false
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                sensitive: true
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                complianceRelevant: true
            }),

            this.countDocuments({
                tenantId:
                    normalizedTenantId,
                regulatoryCritical: true
            })
        ]);

        return {
            tenantId:
                normalizedTenantId,

            total,

            enabled,

            disabled,

            retired,

            deleted,

            editable,

            protected:
                protectedCount,

            sensitive,

            complianceRelevant,

            regulatoryCritical,

            generatedAt:
                new Date()
        };
    };

/**
 * ============================================================================
 * STATIC: ASSERT VERSION
 * ============================================================================
 *
 * Useful for service-layer optimistic concurrency checks.
 * ============================================================================
 */

SystemSettingSchema.statics.assertVersion =
    async function (
        key,
        tenantId,
        expectedVersion
    ) {
        const setting =
            await this.findOne({
                tenantId:
                    normalizeTenantId(
                        tenantId
                    ),

                key:
                    normalizeKey(key)
            })
                .select({
                    version: 1
                })
                .lean();

        if (
            !setting
        ) {
            throw createSettingError(
                'System setting not found.',
                'SYSTEM_SETTING_NOT_FOUND'
            );
        }

        if (
            Number(
                setting.version
            ) !==
            Number(
                expectedVersion
            )
        ) {
            throw createSettingError(
                'System setting version conflict.',
                'SYSTEM_SETTING_VERSION_CONFLICT',
                {
                    expectedVersion:
                        Number(
                            expectedVersion
                        ),

                    actualVersion:
                        Number(
                            setting.version
                        )
                }
            );
        }

        return true;
    };

/**
 * ============================================================================
 * STATIC: VALIDATE VALUE
 * ============================================================================
 */

SystemSettingSchema.statics.validateValue =
    function (
        value,
        valueType
    ) {
        const normalizedType =
            String(
                valueType ||
                detectValueType(value)
            )
                .trim()
                .toUpperCase();

        return validateValueType(
            value,
            normalizedType
        );
    };

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

const SystemSetting =
    mongoose.models.SystemSetting ||
    mongoose.model(
        'SystemSetting',
        SystemSettingSchema
    );

module.exports =
    SystemSetting;

/**
 * ============================================================================
 * NAMED COMPATIBILITY EXPORTS
 * ============================================================================
 */

module.exports.SYSTEM_TENANT_ID =
    SYSTEM_TENANT_ID;

module.exports.VALUE_TYPES =
    VALUE_TYPES;

module.exports.CATEGORIES =
    CATEGORIES;

module.exports.AUDIT_ACTIONS =
    AUDIT_ACTIONS;

module.exports.SOURCES =
    SOURCES;