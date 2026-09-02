'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE SYSTEM SETTING VALIDATOR
 * ============================================================================
 *
 * File:
 *   backend/validators/systemSettingValidator.js
 *
 * Purpose:
 *   Production-grade HTTP/request validation for SystemSetting operations.
 *
 * Architectural boundary:
 *
 *   HTTP Request
 *       ↓
 *   systemSettingValidator
 *       ↓
 *   Controller
 *       ↓
 *   systemSettingService
 *       ↓
 *   SystemSetting Model
 *
 * Responsibilities:
 *
 *   - Validate SystemSetting request payloads
 *   - Validate tenant identifiers
 *   - Validate setting keys
 *   - Validate setting categories
 *   - Validate value types
 *   - Validate optimistic-concurrency versions
 *   - Validate request/correlation metadata
 *   - Reject unknown mutation fields
 *   - Prevent client-controlled protected fields
 *   - Normalize safe transport values
 *   - Provide reusable validation middleware
 *   - Provide programmatic validation helpers for tests/services
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This module validates REQUEST DATA.
 *
 * It does NOT:
 *
 *   - authorize users
 *   - determine tenant access
 *   - determine whether an administrator may change a setting
 *   - bypass SystemSetting protection
 *   - write to MongoDB
 *   - mutate financial records
 *   - approve regulatory configuration changes
 *
 * Authorization belongs to middleware/service layers.
 *
 * ============================================================================
 */

const {
    body,
    param,
    query,
    validationResult
} = require('express-validator');

/**
 * ============================================================================
 * MODEL CONSTANTS
 * ============================================================================
 *
 * Loaded defensively so validation remains usable even when this validator is
 * imported independently by tests or tooling.
 * ============================================================================
 */

let SystemSetting;

try {
    SystemSetting =
        require('../models/SystemSetting');
} catch (error) {
    SystemSetting = null;
}

/**
 * ============================================================================
 * FALLBACK CONSTANTS
 * ============================================================================
 */

const SYSTEM_TENANT_ID =
    SystemSetting?.SYSTEM_TENANT_ID ||
    'SYSTEM';

const VALUE_TYPES =
    Object.freeze(
        SystemSetting?.VALUE_TYPES || [
            'STRING',
            'NUMBER',
            'BOOLEAN',
            'JSON',
            'ARRAY'
        ]
    );

const CATEGORIES =
    Object.freeze(
        SystemSetting?.CATEGORIES || [
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
        ]
    );

/**
 * ============================================================================
 * VALIDATION LIMITS
 * ============================================================================
 */

const LIMITS =
    Object.freeze({
        TENANT_ID_MAX: 100,

        KEY_MAX: 150,

        NAME_MAX: 200,

        DESCRIPTION_MAX: 2000,

        REQUEST_ID_MAX: 200,

        CORRELATION_ID_MAX: 200,

        SOURCE_MAX: 100,

        MAX_METADATA_KEYS: 100,

        MAX_METADATA_BYTES: 64 * 1024,

        MAX_JSON_VALUE_BYTES: 256 * 1024,

        MAX_AUDIT_DETAILS_BYTES: 64 * 1024,

        MAX_PAGE_SIZE: 100,

        DEFAULT_PAGE_SIZE: 25,

        MAX_VERSION: Number.MAX_SAFE_INTEGER
    });

/**
 * ============================================================================
 * PUBLIC MUTATION FIELDS
 * ============================================================================
 *
 * These are the fields that an API client may request to change.
 *
 * Identity and security-sensitive fields are intentionally excluded:
 *
 *   - _id
 *   - tenantId
 *   - key
 *   - version
 *   - isSystem
 *   - editable
 *   - createdBy
 *   - updatedBy
 *   - auditLog
 *   - deletedBy
 *   - deletedAt
 *
 * These must never be trusted from an ordinary client payload.
 * ============================================================================
 */

const MUTABLE_FIELDS =
    Object.freeze([
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
    ]);

/**
 * ============================================================================
 * CREATE FIELDS
 * ============================================================================
 */

const CREATE_FIELDS =
    Object.freeze([
        'tenantId',
        'key',
        'category',
        'name',
        'description',
        'value',
        'valueType',
        'enabled',
        'complianceRelevant',
        'regulatoryCritical',
        'metadata',
        'sensitive'
    ]);

/**
 * ============================================================================
 * ALLOWED TRANSPORT FIELDS
 * ============================================================================
 */

const COMMON_OPTION_FIELDS =
    Object.freeze([
        'expectedVersion',
        'requestId',
        'correlationId',
        'source',
        'auditDetails'
    ]);

/**
 * ============================================================================
 * NORMALIZATION HELPERS
 * ============================================================================
 */

function normalizeString(
    value,
    fallback = null
) {
    if (
        value === undefined ||
        value === null
    ) {
        return fallback;
    }

    const normalized =
        String(value).trim();

    return normalized || fallback;
}

function normalizeTenantId(
    value
) {
    const normalized =
        normalizeString(
            value,
            SYSTEM_TENANT_ID
        );

    return normalized
        .toUpperCase();
}

function normalizeKey(
    value
) {
    return normalizeString(
        value,
        ''
    )
        .toUpperCase();
}

function normalizeCategory(
    value
) {
    return normalizeString(
        value,
        'SYSTEM'
    )
        .toUpperCase();
}

function normalizeValueType(
    value
) {
    return normalizeString(
        value,
        null
    )
        ?.toUpperCase();
}

function normalizeSource(
    value
) {
    return normalizeString(
        value,
        'api'
    )
        ?.toLowerCase();
}

/**
 * ============================================================================
 * SETTING KEY VALIDATION
 * ============================================================================
 */

function isValidSettingKey(
    key
) {
    return (
        typeof key === 'string' &&
        key.length >= 1 &&
        key.length <= LIMITS.KEY_MAX &&
        /^[A-Z][A-Z0-9_.:-]*$/.test(
            key
        )
    );
}

/**
 * ============================================================================
 * TENANT ID VALIDATION
 * ============================================================================
 */

function isValidTenantId(
    tenantId
) {
    if (
        typeof tenantId !==
        'string'
    ) {
        return false;
    }

    if (
        tenantId.length < 1 ||
        tenantId.length >
        LIMITS.TENANT_ID_MAX
    ) {
        return false;
    }

    /**
     * Tenant identifiers are deliberately restricted to a conservative
     * identifier alphabet.
     *
     * This prevents whitespace, control characters and query-style payloads
     * from entering the configuration boundary.
     */

    return /^[A-Z0-9][A-Z0-9_.:-]*$/i.test(
        tenantId
    );
}

/**
 * ============================================================================
 * VALUE TYPE VALIDATION
 * ============================================================================
 */

function detectValueType(
    value
) {
    if (
        Array.isArray(value)
    ) {
        return 'ARRAY';
    }

    if (
        value === null
    ) {
        return 'JSON';
    }

    switch (
        typeof value
    ) {
        case 'string':
            return 'STRING';

        case 'number':
            return 'NUMBER';

        case 'boolean':
            return 'BOOLEAN';

        case 'object':
            return 'JSON';

        default:
            return null;
    }
}

function isValidValueType(
    value,
    valueType
) {
    switch (
        valueType
    ) {
        case 'STRING':
            return (
                typeof value ===
                'string'
            );

        case 'NUMBER':
            return (
                typeof value ===
                    'number' &&
                Number.isFinite(
                    value
                )
            );

        case 'BOOLEAN':
            return (
                typeof value ===
                'boolean'
            );

        case 'ARRAY':
            return Array.isArray(
                value
            );

        case 'JSON':
            return (
                value === null ||
                (
                    typeof value ===
                        'object' &&
                    !Array.isArray(
                        value
                    )
                )
            );

        default:
            return false;
    }
}

/**
 * ============================================================================
 * JSON SERIALIZATION SAFETY
 * ============================================================================
 */

function getSerializedByteLength(
    value
) {
    try {
        const serialized =
            JSON.stringify(
                value
            );

        if (
            serialized ===
            undefined
        ) {
            return 0;
        }

        return Buffer.byteLength(
            serialized,
            'utf8'
        );
    } catch (
        error
    ) {
        return Infinity;
    }
}

function isSerializable(
    value
) {
    try {
        JSON.stringify(
            value
        );

        return true;
    } catch (
        error
    ) {
        return false;
    }
}

/**
 * ============================================================================
 * OBJECT DEPTH
 * ============================================================================
 */

function getObjectDepth(
    value,
    currentDepth = 0,
    maxDepth = 10
) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return currentDepth;
    }

    if (
        currentDepth >=
        maxDepth
    ) {
        return currentDepth;
    }

    const values =
        Array.isArray(value)
            ? value
            : Object.values(value);

    let depth =
        currentDepth;

    for (
        const item of values
    ) {
        depth = Math.max(
            depth,
            getObjectDepth(
                item,
                currentDepth + 1,
                maxDepth
            )
        );
    }

    return depth;
}

/**
 * ============================================================================
 * METADATA VALIDATION
 * ============================================================================
 */

function validateMetadata(
    metadata
) {
    if (
        metadata === undefined ||
        metadata === null
    ) {
        return {
            valid: true
        };
    }

    if (
        typeof metadata !==
            'object' ||
        Array.isArray(
            metadata
        )
    ) {
        return {
            valid: false,
            message:
                'metadata must be a JSON object.'
        };
    }

    if (
        !isSerializable(
            metadata
        )
    ) {
        return {
            valid: false,
            message:
                'metadata must contain only JSON-serializable values.'
        };
    }

    if (
        getSerializedByteLength(
            metadata
        ) >
        LIMITS.MAX_METADATA_BYTES
    ) {
        return {
            valid: false,
            message:
                'metadata exceeds the maximum supported size.'
        };
    }

    if (
        getObjectDepth(
            metadata
        ) > 10
    ) {
        return {
            valid: false,
            message:
                'metadata exceeds the maximum supported nesting depth.'
        };
    }

    if (
        Object.keys(
            metadata
        ).length >
        LIMITS.MAX_METADATA_KEYS
    ) {
        return {
            valid: false,
            message:
                'metadata contains too many top-level properties.'
        };
    }

    return {
        valid: true
    };
}

/**
 * ============================================================================
 * VALUE PAYLOAD VALIDATION
 * ============================================================================
 */

function validateSettingValue(
    value,
    valueType
) {
    const normalizedType =
        normalizeValueType(
            valueType
        ) ||
        detectValueType(
            value
        );

    if (
        !VALUE_TYPES.includes(
            normalizedType
        )
    ) {
        return {
            valid: false,
            message:
                `Unsupported valueType: ${normalizedType}.`
        };
    }

    if (
        !isSerializable(
            value
        )
    ) {
        return {
            valid: false,
            message:
                'value must be JSON-serializable.'
        };
    }

    if (
        getSerializedByteLength(
            value
        ) >
        LIMITS.MAX_JSON_VALUE_BYTES
    ) {
        return {
            valid: false,
            message:
                'value exceeds the maximum supported size.'
        };
    }

    if (
        !isValidValueType(
            value,
            normalizedType
        )
    ) {
        return {
            valid: false,
            message:
                `value does not match valueType ${normalizedType}.`
        };
    }

    return {
        valid: true,
        valueType:
            normalizedType
    };
}

/**
 * ============================================================================
 * EXPECTED VERSION VALIDATION
 * ============================================================================
 */

function isValidVersion(
    version
) {
    return (
        Number.isSafeInteger(
            version
        ) &&
        version >= 0 &&
        version <=
            LIMITS.MAX_VERSION
    );
}

/**
 * ============================================================================
 * REQUEST ID VALIDATION
 * ============================================================================
 */

function isValidRequestId(
    requestId
) {
    if (
        requestId ===
            undefined ||
        requestId === null
    ) {
        return true;
    }

    if (
        typeof requestId !==
        'string'
    ) {
        return false;
    }

    return (
        requestId.trim()
            .length >= 1 &&
        requestId.trim()
            .length <=
            LIMITS.REQUEST_ID_MAX
    );
}

/**
 * ============================================================================
 * UNKNOWN FIELD DETECTION
 * ============================================================================
 */

function getUnknownFields(
    payload,
    allowedFields
) {
    if (
        !payload ||
        typeof payload !==
            'object' ||
        Array.isArray(
            payload
        )
    ) {
        return [];
    }

    const allowed =
        new Set(
            allowedFields
        );

    return Object.keys(
        payload
    ).filter(
        field =>
            !allowed.has(
                field
            )
    );
}

/**
 * ============================================================================
 * PROTECTED FIELD DETECTION
 * ============================================================================
 *
 * These fields may appear in a request only if a dedicated internal/privileged
 * service explicitly constructs the request. Ordinary HTTP APIs should reject
 * them before service invocation.
 * ============================================================================
 */

const PROTECTED_FIELDS =
    Object.freeze([
        '_id',
        'id',
        'tenantId',
        'key',
        'version',
        '__v',
        'isSystem',
        'editable',
        'createdBy',
        'updatedBy',
        'auditLog',
        'retiredAt',
        'retiredBy',
        'deletedAt',
        'deletedBy'
    ]);

/**
 * ============================================================================
 * RAW BODY VALIDATION
 * ============================================================================
 *
 * Programmatic validation used by:
 *
 *   - unit tests
 *   - services
 *   - controllers
 *   - import/migration tooling
 *
 * ============================================================================
 */

function validateCreatePayload(
    payload = {},
    options = {}
) {
    const errors = [];

    if (
        !payload ||
        typeof payload !==
            'object' ||
        Array.isArray(
            payload
        )
    ) {
        return {
            valid: false,
            errors: [
                'Request body must be a JSON object.'
            ],
            value: null
        };
    }

    const unknown =
        getUnknownFields(
            payload,
            [
                ...CREATE_FIELDS,
                ...COMMON_OPTION_FIELDS
            ]
        );

    if (
        unknown.length
    ) {
        errors.push(
            `Unknown field(s): ${unknown.join(
                ', '
            )}.`
        );
    }

    const tenantId =
        normalizeTenantId(
            payload.tenantId
        );

    if (
        !isValidTenantId(
            tenantId
        )
    ) {
        errors.push(
            'tenantId is invalid.'
        );
    }

    const key =
        normalizeKey(
            payload.key
        );

    if (
        !isValidSettingKey(
            key
        )
    ) {
        errors.push(
            'key must contain only uppercase letters, numbers, underscores, dots, colons and hyphens, and must begin with a letter.'
        );
    }

    const category =
        normalizeCategory(
            payload.category
        );

    if (
        !CATEGORIES.includes(
            category
        )
    ) {
        errors.push(
            `category must be one of: ${CATEGORIES.join(
                ', '
            )}.`
        );
    }

    if (
        payload.name !==
            undefined &&
        (
            typeof payload.name !==
            'string' ||
            payload.name.trim()
                .length >
                LIMITS.NAME_MAX
        )
    ) {
        errors.push(
            `name must be a string no longer than ${LIMITS.NAME_MAX} characters.`
        );
    }

    if (
        payload.description !==
            undefined &&
        (
            typeof payload.description !==
            'string' ||
            payload.description.trim()
                .length >
                LIMITS.DESCRIPTION_MAX
        )
    ) {
        errors.push(
            `description must be a string no longer than ${LIMITS.DESCRIPTION_MAX} characters.`
        );
    }

    if (
        payload.value ===
        undefined
    ) {
        errors.push(
            'value is required.'
        );
    }

    const valueValidation =
        validateSettingValue(
            payload.value,
            payload.valueType
        );

    if (
        !valueValidation.valid
    ) {
        errors.push(
            valueValidation.message
        );
    }

    if (
        payload.enabled !==
            undefined &&
        typeof payload.enabled !==
            'boolean'
    ) {
        errors.push(
            'enabled must be a boolean.'
        );
    }

    if (
        payload.complianceRelevant !==
            undefined &&
        typeof payload.complianceRelevant !==
            'boolean'
    ) {
        errors.push(
            'complianceRelevant must be a boolean.'
        );
    }

    if (
        payload.regulatoryCritical !==
            undefined &&
        typeof payload.regulatoryCritical !==
            'boolean'
    ) {
        errors.push(
            'regulatoryCritical must be a boolean.'
        );
    }

    if (
        payload.sensitive !==
            undefined &&
        typeof payload.sensitive !==
            'boolean'
    ) {
        errors.push(
            'sensitive must be a boolean.'
        );
    }

    const metadataValidation =
        validateMetadata(
            payload.metadata
        );

    if (
        !metadataValidation.valid
    ) {
        errors.push(
            metadataValidation.message
        );
    }

    if (
        payload.expectedVersion !==
            undefined
    ) {
        if (
            !isValidVersion(
                Number(
                    payload.expectedVersion
                )
            )
        ) {
            errors.push(
                'expectedVersion must be a non-negative safe integer.'
            );
        }
    }

    if (
        !isValidRequestId(
            payload.requestId
        )
    ) {
        errors.push(
            'requestId is invalid.'
        );
    }

    if (
        !isValidRequestId(
            payload.correlationId
        )
    ) {
        errors.push(
            'correlationId is invalid.'
        );
    }

    if (
        payload.source !==
            undefined
    ) {
        if (
            typeof payload.source !==
                'string' ||
            payload.source.trim()
                .length >
                LIMITS.SOURCE_MAX
        ) {
            errors.push(
                `source must be a string no longer than ${LIMITS.SOURCE_MAX} characters.`
            );
        }
    }

    /**
     * SYSTEM scope is reserved for platform-level configuration.
     *
     * Creation of SYSTEM settings should normally be performed by a privileged
     * internal/bootstrap operation, not by an ordinary tenant API.
     */

    if (
        tenantId ===
            SYSTEM_TENANT_ID &&
        options.allowSystemScope !==
            true
    ) {
        errors.push(
            'SYSTEM tenant scope requires a privileged system configuration operation.'
        );
    }

    return {
        valid:
            errors.length === 0,

        errors,

        value: {
            ...payload,

            tenantId,

            key,

            category,

            ...(valueValidation.valueType
                ? {
                    valueType:
                        valueValidation.valueType
                }
                : {})
        }
    };
}

/**
 * ============================================================================
 * UPDATE PAYLOAD VALIDATION
 * ============================================================================
 */

function validateUpdatePayload(
    payload = {}
) {
    const errors = [];

    if (
        !payload ||
        typeof payload !==
            'object' ||
        Array.isArray(
            payload
        )
    ) {
        return {
            valid: false,
            errors: [
                'Request body must be a JSON object.'
            ],
            value: null
        };
    }

    const unknown =
        getUnknownFields(
            payload,
            [
                ...MUTABLE_FIELDS,
                ...COMMON_OPTION_FIELDS
            ]
        );

    if (
        unknown.length
    ) {
        errors.push(
            `Unknown or protected field(s): ${unknown.join(
                ', '
            )}.`
        );
    }

    const suppliedMutableFields =
        MUTABLE_FIELDS.filter(
            field =>
                Object.prototype.hasOwnProperty.call(
                    payload,
                    field
                )
        );

    if (
        suppliedMutableFields.length ===
        0
    ) {
        errors.push(
            'At least one mutable setting field must be supplied.'
        );
    }

    if (
        payload.name !==
            undefined &&
        (
            typeof payload.name !==
                'string' ||
            payload.name.trim()
                .length >
                LIMITS.NAME_MAX
        )
    ) {
        errors.push(
            `name must be a string no longer than ${LIMITS.NAME_MAX} characters.`
        );
    }

    if (
        payload.description !==
            undefined &&
        (
            typeof payload.description !==
                'string' ||
            payload.description.trim()
                .length >
                LIMITS.DESCRIPTION_MAX
        )
    ) {
        errors.push(
            `description must be a string no longer than ${LIMITS.DESCRIPTION_MAX} characters.`
        );
    }

    if (
        payload.category !==
            undefined
    ) {
        const category =
            normalizeCategory(
                payload.category
            );

        if (
            !CATEGORIES.includes(
                category
            )
        ) {
            errors.push(
                `category must be one of: ${CATEGORIES.join(
                    ', '
                )}.`
            );
        }
    }

    if (
        payload.value !==
            undefined
    ) {
        const valueValidation =
            validateSettingValue(
                payload.value,
                payload.valueType
            );

        if (
            !valueValidation.valid
        ) {
            errors.push(
                valueValidation.message
            );
        }
    } else if (
        payload.valueType !==
        undefined
    ) {
        errors.push(
            'valueType cannot be changed without supplying value.'
        );
    }

    const booleanFields = [
        'enabled',
        'complianceRelevant',
        'regulatoryCritical',
        'sensitive',
        'retired',
        'deleted'
    ];

    for (
        const field of
            booleanFields
    ) {
        if (
            payload[field] !==
                undefined &&
            typeof payload[field] !==
                'boolean'
        ) {
            errors.push(
                `${field} must be a boolean.`
            );
        }
    }

    /**
     * Retirement/deletion imply inactive operation.
     *
     * The service/model remains authoritative, but rejecting contradictory
     * transport state here reduces ambiguity.
     */

    if (
        payload.retired ===
            true &&
        payload.enabled ===
            true
    ) {
        errors.push(
            'A retired setting cannot simultaneously be enabled.'
        );
    }

    if (
        payload.deleted ===
            true &&
        payload.enabled ===
            true
    ) {
        errors.push(
            'A deleted setting cannot simultaneously be enabled.'
        );
    }

    const metadataValidation =
        validateMetadata(
            payload.metadata
        );

    if (
        !metadataValidation.valid
    ) {
        errors.push(
            metadataValidation.message
        );
    }

    if (
        payload.expectedVersion !==
            undefined &&
        !isValidVersion(
            Number(
                payload.expectedVersion
            )
        )
    ) {
        errors.push(
            'expectedVersion must be a non-negative safe integer.'
        );
    }

    if (
        !isValidRequestId(
            payload.requestId
        )
    ) {
        errors.push(
            'requestId is invalid.'
        );
    }

    if (
        !isValidRequestId(
            payload.correlationId
        )
    ) {
        errors.push(
            'correlationId is invalid.'
        );
    }

    return {
        valid:
            errors.length === 0,

        errors,

        value: {
            ...payload,

            ...(payload.category !==
                undefined
                ? {
                    category:
                        normalizeCategory(
                            payload.category
                        )
                }
                : {}),

            ...(payload.valueType !==
                undefined
                ? {
                    valueType:
                        normalizeValueType(
                            payload.valueType
                        )
                }
                : {})
        }
    };
}

/**
 * ============================================================================
 * VALIDATION ERROR HANDLER
 * ============================================================================
 *
 * Standard Express middleware.
 *
 * Controllers can simply call:
 *
 *   validationResultMiddleware
 *
 * after the validation chains.
 * ============================================================================
 */

function validationResultMiddleware(
    req,
    res,
    next
) {
    const result =
        validationResult(
            req
        );

    if (
        result.isEmpty()
    ) {
        return next();
    }

    const details =
        result.array({
            onlyFirstError: true
        });

    return res
        .status(400)
        .json({
            success: false,

            code:
                'SYSTEM_SETTING_VALIDATION_ERROR',

            message:
                'System setting request validation failed.',

            errors:
                details.map(
                    error => ({
                        field:
                            error.path ||
                            error.param ||
                            'request',

                        location:
                            error.location ||
                            'body',

                        message:
                            error.msg,

                        value:
                            error.type ===
                            'field'
                                ? undefined
                                : error.value
                    })
                ),

            requestId:
                req.requestId ||
                req.id ||
                null,

            correlationId:
                req.correlationId ||
                null,

            timestamp:
                new Date()
                    .toISOString()
        });
}

/**
 * ============================================================================
 * VALIDATION CHAINS — CREATE
 * ============================================================================
 */

const validateCreateSystemSetting =
    [
        body()
            .custom(
                value => {
                    const result =
                        validateCreatePayload(
                            value || {}
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.errors.join(
                                ' '
                            )
                        );
                    }

                    return true;
                }
            ),

        body('tenantId')
            .optional()
            .customSanitizer(
                normalizeTenantId
            )
            .isString()
            .withMessage(
                'tenantId must be a string.'
            )
            .isLength({
                min: 1,
                max:
                    LIMITS.TENANT_ID_MAX
            })
            .withMessage(
                'tenantId has an invalid length.'
            )
            .matches(
                /^[A-Z0-9][A-Z0-9_.:-]*$/i
            )
            .withMessage(
                'tenantId contains invalid characters.'
            ),

        body('key')
            .exists()
            .withMessage(
                'key is required.'
            )
            .bail()
            .isString()
            .withMessage(
                'key must be a string.'
            )
            .bail()
            .trim()
            .toUpperCase()
            .isLength({
                min: 1,
                max:
                    LIMITS.KEY_MAX
            })
            .withMessage(
                'key has an invalid length.'
            )
            .bail()
            .matches(
                /^[A-Z][A-Z0-9_.:-]*$/
            )
            .withMessage(
                'key contains invalid characters.'
            ),

        body('category')
            .optional()
            .customSanitizer(
                normalizeCategory
            )
            .isIn(
                CATEGORIES
            )
            .withMessage(
                'category is invalid.'
            ),

        body('name')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'name must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                max:
                    LIMITS.NAME_MAX
            })
            .withMessage(
                'name is too long.'
            ),

        body('description')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'description must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                max:
                    LIMITS.DESCRIPTION_MAX
            })
            .withMessage(
                'description is too long.'
            ),

        body('value')
            .exists()
            .withMessage(
                'value is required.'
            )
            .custom(
                (value, {
                    req
                }) => {
                    const result =
                        validateSettingValue(
                            value,
                            req.body
                                ?.valueType
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.message
                        );
                    }

                    return true;
                }
            ),

        body('valueType')
            .optional()
            .customSanitizer(
                normalizeValueType
            )
            .isIn(
                VALUE_TYPES
            )
            .withMessage(
                'valueType is invalid.'
            ),

        body('enabled')
            .optional()
            .isBoolean()
            .withMessage(
                'enabled must be a boolean.'
            )
            .toBoolean(),

        body('complianceRelevant')
            .optional()
            .isBoolean()
            .withMessage(
                'complianceRelevant must be a boolean.'
            )
            .toBoolean(),

        body('regulatoryCritical')
            .optional()
            .isBoolean()
            .withMessage(
                'regulatoryCritical must be a boolean.'
            )
            .toBoolean(),

        body('sensitive')
            .optional()
            .isBoolean()
            .withMessage(
                'sensitive must be a boolean.'
            )
            .toBoolean(),

        body('metadata')
            .optional({
                nullable: true
            })
            .custom(
                value => {
                    const result =
                        validateMetadata(
                            value
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.message
                        );
                    }

                    return true;
                }
            ),

        body('expectedVersion')
            .optional()
            .isInt({
                min: 0,
                max:
                    Number.MAX_SAFE_INTEGER
            })
            .withMessage(
                'expectedVersion must be a non-negative integer.'
            )
            .toInt(),

        body('requestId')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'requestId must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                min: 1,
                max:
                    LIMITS.REQUEST_ID_MAX
            }),

        body('correlationId')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'correlationId must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                min: 1,
                max:
                    LIMITS.CORRELATION_ID_MAX
            }),

        body('source')
            .optional()
            .isString()
            .withMessage(
                'source must be a string.'
            )
            .bail()
            .trim()
            .toLowerCase()
            .isLength({
                max:
                    LIMITS.SOURCE_MAX
            }),

        body('auditDetails')
            .optional({
                nullable: true
            })
            .custom(
                value => {
                    const result =
                        validateMetadata(
                            value
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            `auditDetails: ${result.message}`
                        );
                    }

                    return true;
                }
            ),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * VALIDATION CHAINS — UPDATE
 * ============================================================================
 */

const validateUpdateSystemSetting =
    [
        body()
            .custom(
                value => {
                    const result =
                        validateUpdatePayload(
                            value || {}
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.errors.join(
                                ' '
                            )
                        );
                    }

                    return true;
                }
            ),

        body('name')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'name must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                max:
                    LIMITS.NAME_MAX
            }),

        body('description')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'description must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                max:
                    LIMITS.DESCRIPTION_MAX
            }),

        body('category')
            .optional()
            .customSanitizer(
                normalizeCategory
            )
            .isIn(
                CATEGORIES
            )
            .withMessage(
                'category is invalid.'
            ),

        body('value')
            .optional()
            .custom(
                (value, {
                    req
                }) => {
                    const result =
                        validateSettingValue(
                            value,
                            req.body
                                ?.valueType
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.message
                        );
                    }

                    return true;
                }
            ),

        body('valueType')
            .optional()
            .customSanitizer(
                normalizeValueType
            )
            .isIn(
                VALUE_TYPES
            )
            .withMessage(
                'valueType is invalid.'
            ),

        body('enabled')
            .optional()
            .isBoolean()
            .withMessage(
                'enabled must be a boolean.'
            )
            .toBoolean(),

        body('complianceRelevant')
            .optional()
            .isBoolean()
            .withMessage(
                'complianceRelevant must be a boolean.'
            )
            .toBoolean(),

        body('regulatoryCritical')
            .optional()
            .isBoolean()
            .withMessage(
                'regulatoryCritical must be a boolean.'
            )
            .toBoolean(),

        body('sensitive')
            .optional()
            .isBoolean()
            .withMessage(
                'sensitive must be a boolean.'
            )
            .toBoolean(),

        body('retired')
            .optional()
            .isBoolean()
            .withMessage(
                'retired must be a boolean.'
            )
            .toBoolean(),

        body('deleted')
            .optional()
            .isBoolean()
            .withMessage(
                'deleted must be a boolean.'
            )
            .toBoolean(),

        body('metadata')
            .optional({
                nullable: true
            })
            .custom(
                value => {
                    const result =
                        validateMetadata(
                            value
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.message
                        );
                    }

                    return true;
                }
            ),

        body('expectedVersion')
            .optional()
            .isInt({
                min: 1,
                max:
                    Number.MAX_SAFE_INTEGER
            })
            .withMessage(
                'expectedVersion must be a positive integer.'
            )
            .toInt(),

        body('requestId')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'requestId must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                min: 1,
                max:
                    LIMITS.REQUEST_ID_MAX
            }),

        body('correlationId')
            .optional({
                nullable: true
            })
            .isString()
            .withMessage(
                'correlationId must be a string.'
            )
            .bail()
            .trim()
            .isLength({
                min: 1,
                max:
                    LIMITS.CORRELATION_ID_MAX
            }),

        body('source')
            .optional()
            .isString()
            .withMessage(
                'source must be a string.'
            )
            .bail()
            .trim()
            .toLowerCase()
            .isLength({
                max:
                    LIMITS.SOURCE_MAX
            }),

        body('auditDetails')
            .optional({
                nullable: true
            })
            .custom(
                value => {
                    const result =
                        validateMetadata(
                            value
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.message
                        );
                    }

                    return true;
                }
            ),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * VALIDATION CHAINS — KEY PARAMETER
 * ============================================================================
 */

const validateSystemSettingKey =
    [
        param('key')
            .exists()
            .withMessage(
                'System setting key is required.'
            )
            .bail()
            .isString()
            .withMessage(
                'System setting key must be a string.'
            )
            .bail()
            .trim()
            .toUpperCase()
            .isLength({
                min: 1,
                max:
                    LIMITS.KEY_MAX
            })
            .withMessage(
                'System setting key has an invalid length.'
            )
            .bail()
            .matches(
                /^[A-Z][A-Z0-9_.:-]*$/
            )
            .withMessage(
                'System setting key contains invalid characters.'
            ),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * VALIDATION CHAINS — TENANT PARAMETER
 * ============================================================================
 */

const validateTenantId =
    [
        param('tenantId')
            .exists()
            .withMessage(
                'tenantId is required.'
            )
            .bail()
            .isString()
            .withMessage(
                'tenantId must be a string.'
            )
            .bail()
            .trim()
            .toUpperCase()
            .isLength({
                min: 1,
                max:
                    LIMITS.TENANT_ID_MAX
            })
            .withMessage(
                'tenantId has an invalid length.'
            )
            .bail()
            .matches(
                /^[A-Z0-9][A-Z0-9_.:-]*$/i
            )
            .withMessage(
                'tenantId contains invalid characters.'
            ),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * VALIDATION CHAINS — QUERY
 * ============================================================================
 */

const validateSystemSettingQuery =
    [
        query('tenantId')
            .optional()
            .customSanitizer(
                normalizeTenantId
            )
            .isLength({
                min: 1,
                max:
                    LIMITS.TENANT_ID_MAX
            })
            .withMessage(
                'tenantId has an invalid length.'
            )
            .matches(
                /^[A-Z0-9][A-Z0-9_.:-]*$/i
            )
            .withMessage(
                'tenantId contains invalid characters.'
            ),

        query('category')
            .optional()
            .customSanitizer(
                normalizeCategory
            )
            .isIn(
                CATEGORIES
            )
            .withMessage(
                'category is invalid.'
            ),

        query('enabled')
            .optional()
            .isBoolean()
            .withMessage(
                'enabled must be a boolean.'
            )
            .toBoolean(),

        query('retired')
            .optional()
            .isBoolean()
            .withMessage(
                'retired must be a boolean.'
            )
            .toBoolean(),

        query('deleted')
            .optional()
            .isBoolean()
            .withMessage(
                'deleted must be a boolean.'
            )
            .toBoolean(),

        query('complianceRelevant')
            .optional()
            .isBoolean()
            .withMessage(
                'complianceRelevant must be a boolean.'
            )
            .toBoolean(),

        query('regulatoryCritical')
            .optional()
            .isBoolean()
            .withMessage(
                'regulatoryCritical must be a boolean.'
            )
            .toBoolean(),

        query('page')
            .optional()
            .isInt({
                min: 1,
                max:
                    Number.MAX_SAFE_INTEGER
            })
            .withMessage(
                'page must be a positive integer.'
            )
            .toInt(),

        query('limit')
            .optional()
            .isInt({
                min: 1,
                max:
                    LIMITS.MAX_PAGE_SIZE
            })
            .withMessage(
                `limit must be between 1 and ${LIMITS.MAX_PAGE_SIZE}.`
            )
            .toInt(),

        query('key')
            .optional()
            .customSanitizer(
                normalizeKey
            )
            .matches(
                /^[A-Z][A-Z0-9_.:-]*$/
            )
            .withMessage(
                'key contains invalid characters.'
            ),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * VALIDATION CHAINS — EXPECTED VERSION
 * ============================================================================
 */

const validateExpectedVersion =
    [
        body('expectedVersion')
            .exists()
            .withMessage(
                'expectedVersion is required for optimistic-concurrency operations.'
            )
            .bail()
            .isInt({
                min: 1,
                max:
                    Number.MAX_SAFE_INTEGER
            })
            .withMessage(
                'expectedVersion must be a positive safe integer.'
            )
            .toInt(),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * VALIDATION CHAINS — VALUE ONLY
 * ============================================================================
 */

const validateSystemSettingValue =
    [
        body('value')
            .exists()
            .withMessage(
                'value is required.'
            )
            .custom(
                (value, {
                    req
                }) => {
                    const result =
                        validateSettingValue(
                            value,
                            req.body
                                ?.valueType
                        );

                    if (
                        !result.valid
                    ) {
                        throw new Error(
                            result.message
                        );
                    }

                    return true;
                }
            ),

        body('valueType')
            .optional()
            .customSanitizer(
                normalizeValueType
            )
            .isIn(
                VALUE_TYPES
            )
            .withMessage(
                'valueType is invalid.'
            ),

        validationResultMiddleware
    ];

/**
 * ============================================================================
 * STRICT UNKNOWN-FIELD MIDDLEWARE
 * ============================================================================
 *
 * This middleware is intentionally separate from express-validator chains.
 *
 * Use it before a mutation validator when the endpoint must reject all
 * unexpected body properties.
 * ============================================================================
 */

function rejectUnknownFields(
    allowedFields = []
) {
    const allowed =
        new Set(
            allowedFields
        );

    return (
        req,
        res,
        next
    ) => {
        const body =
            req.body || {};

        const unknown =
            Object.keys(
                body
            ).filter(
                field =>
                    !allowed.has(
                        field
                    )
            );

        if (
            unknown.length === 0
        ) {
            return next();
        }

        return res
            .status(400)
            .json({
                success: false,

                code:
                    'SYSTEM_SETTING_UNKNOWN_FIELD',

                message:
                    'Request contains unsupported fields.',

                fields:
                    unknown,

                requestId:
                    req.requestId ||
                    req.id ||
                    null,

                correlationId:
                    req.correlationId ||
                    null,

                timestamp:
                    new Date()
                        .toISOString()
            });
    };
}

/**
 * ============================================================================
 * PROTECTED FIELD MIDDLEWARE
 * ============================================================================
 *
 * Ordinary HTTP callers cannot control security-sensitive SystemSetting
 * identity/protection fields.
 * ============================================================================
 */

function rejectProtectedFields() {
    return (
        req,
        res,
        next
    ) => {
        const body =
            req.body || {};

        const supplied =
            PROTECTED_FIELDS.filter(
                field =>
                    Object.prototype.hasOwnProperty.call(
                        body,
                        field
                    )
            );

        if (
            supplied.length ===
            0
        ) {
            return next();
        }

        return res
            .status(400)
            .json({
                success: false,

                code:
                    'SYSTEM_SETTING_PROTECTED_FIELD',

                message:
                    'Request contains fields that are controlled exclusively by the platform security/service layer.',

                fields:
                    supplied,

                requestId:
                    req.requestId ||
                    req.id ||
                    null,

                correlationId:
                    req.correlationId ||
                    null,

                timestamp:
                    new Date()
                        .toISOString()
            });
    };
}

/**
 * ============================================================================
 * TENANT SCOPE CONSISTENCY MIDDLEWARE
 * ============================================================================
 *
 * Prevents a caller from silently selecting a different tenant through the
 * request body when the route already establishes a tenant.
 *
 * Authorization remains the responsibility of the service/authentication layer.
 * ============================================================================
 */

function validateTenantScopeConsistency() {
    return (
        req,
        res,
        next
    ) => {
        const bodyTenant =
            req.body?.tenantId;

        const routeTenant =
            req.params?.tenantId;

        const requestTenant =
            req.tenantId;

        const candidates =
            [
                bodyTenant,
                routeTenant,
                requestTenant
            ]
                .filter(
                    value =>
                        value !==
                        undefined &&
                        value !==
                        null
                )
                .map(
                    normalizeTenantId
                );

        if (
            candidates.length <=
            1
        ) {
            return next();
        }

        const first =
            candidates[0];

        const consistent =
            candidates.every(
                tenantId =>
                    tenantId ===
                    first
            );

        if (
            consistent
        ) {
            return next();
        }

        return res
            .status(400)
            .json({
                success: false,

                code:
                    'SYSTEM_SETTING_TENANT_SCOPE_MISMATCH',

                message:
                    'Tenant identifiers supplied by the request do not match the trusted tenant scope.',

                requestId:
                    req.requestId ||
                    req.id ||
                    null,

                correlationId:
                    req.correlationId ||
                    null,

                timestamp:
                    new Date()
                        .toISOString()
            });
    };
}

/**
 * ============================================================================
 * SAFE REQUEST NORMALIZATION
 * ============================================================================
 *
 * This middleware performs non-authoritative normalization only.
 *
 * It deliberately does not create tenant identity or authorization context.
 * ============================================================================
 */

function normalizeSystemSettingRequest() {
    return (
        req,
        res,
        next
    ) => {
        if (
            req.body &&
            typeof req.body ===
                'object' &&
            !Array.isArray(
                req.body
            )
        ) {
            if (
                req.body.tenantId !==
                    undefined
            ) {
                req.body.tenantId =
                    normalizeTenantId(
                        req.body.tenantId
                    );
            }

            if (
                req.body.key !==
                    undefined
            ) {
                req.body.key =
                    normalizeKey(
                        req.body.key
                    );
            }

            if (
                req.body.category !==
                    undefined
            ) {
                req.body.category =
                    normalizeCategory(
                        req.body.category
                    );
            }

            if (
                req.body.valueType !==
                    undefined
            ) {
                req.body.valueType =
                    normalizeValueType(
                        req.body.valueType
                    );
            }

            if (
                req.body.source !==
                    undefined
            ) {
                req.body.source =
                    normalizeSource(
                        req.body.source
                    );
            }

            if (
                req.body.requestId !==
                    undefined &&
                req.body.requestId !==
                    null
            ) {
                req.body.requestId =
                    normalizeString(
                        req.body.requestId
                    );
            }

            if (
                req.body.correlationId !==
                    undefined &&
                req.body.correlationId !==
                    null
            ) {
                req.body.correlationId =
                    normalizeString(
                        req.body.correlationId
                    );
            }
        }

        next();
    };
}

/**
 * ============================================================================
 * VALIDATION CHAIN FACTORY
 * ============================================================================
 *
 * Useful when routes want a single middleware array with strict field
 * protection.
 * ============================================================================
 */

function createValidationStack({
    operation = 'update'
} = {}) {
    const validation =
        operation ===
        'create'
            ? validateCreateSystemSetting
            : validateUpdateSystemSetting;

    const allowedFields =
        operation ===
        'create'
            ? [
                ...CREATE_FIELDS,
                ...COMMON_OPTION_FIELDS
            ]
            : [
                ...MUTABLE_FIELDS,
                ...COMMON_OPTION_FIELDS
            ];

    return [
        normalizeSystemSettingRequest(),

        rejectProtectedFields(),

        rejectUnknownFields(
            allowedFields
        ),

        validateTenantScopeConsistency(),

        ...validation
    ];
}

/**
 * ============================================================================
 * LEGACY / CONVENIENCE ALIASES
 * ============================================================================
 */

const createSystemSettingValidator =
    createValidationStack({
        operation: 'create'
    });

const updateSystemSettingValidator =
    createValidationStack({
        operation: 'update'
    });

const systemSettingValidator =
    updateSystemSettingValidator;

/**
 * ============================================================================
 * PROGRAMMATIC ASSERTION HELPERS
 * ============================================================================
 */

function assertCreatePayload(
    payload,
    options = {}
) {
    const result =
        validateCreatePayload(
            payload,
            options
        );

    if (
        !result.valid
    ) {
        const error =
            new Error(
                result.errors.join(
                    ' '
                )
            );

        error.code =
            'SYSTEM_SETTING_VALIDATION_ERROR';

        error.validationErrors =
            result.errors;

        throw error;
    }

    return result.value;
}

function assertUpdatePayload(
    payload
) {
    const result =
        validateUpdatePayload(
            payload
        );

    if (
        !result.valid
    ) {
        const error =
            new Error(
                result.errors.join(
                    ' '
                )
            );

        error.code =
            'SYSTEM_SETTING_VALIDATION_ERROR';

        error.validationErrors =
            result.errors;

        throw error;
    }

    return result.value;
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = {
    /**
     * Primary route validators.
     */

    createSystemSettingValidator,

    updateSystemSettingValidator,

    systemSettingValidator,

    validateCreateSystemSetting,

    validateUpdateSystemSetting,

    validateSystemSettingKey,

    validateTenantId,

    validateSystemSettingQuery,

    validateExpectedVersion,

    validateSystemSettingValue,

    validationResultMiddleware,

    /**
     * Security/normalization middleware.
     */

    normalizeSystemSettingRequest,

    rejectUnknownFields,

    rejectProtectedFields,

    validateTenantScopeConsistency,

    createValidationStack,

    /**
     * Programmatic validation.
     */

    validateCreatePayload,

    validateUpdatePayload,

    assertCreatePayload,

    assertUpdatePayload,

    validateMetadata,

    validateSettingValue,

    isValidSettingKey,

    isValidTenantId,

    isValidValueType,

    detectValueType,

    isValidVersion,

    normalizeTenantId,

    normalizeKey,

    normalizeCategory,

    normalizeValueType,

    normalizeSource,

    /**
     * Constants.
     */

    SYSTEM_TENANT_ID,

    VALUE_TYPES,

    CATEGORIES,

    MUTABLE_FIELDS,

    CREATE_FIELDS,

    PROTECTED_FIELDS,

    LIMITS
};