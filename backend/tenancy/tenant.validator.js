'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Tenant Validation
 * ============================================================================
 *
 * File:
 *   backend/tenancy/tenant.validator.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical validation layer for TITech Community Capital tenancy operations.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Validate tenant identifiers.
 * - Validate tenant creation/update requests.
 * - Validate tenant lifecycle operations.
 * - Validate provisioning options.
 * - Validate tenant registry records.
 * - Provide Express middleware.
 * - Provide Koa middleware.
 * - Produce stable machine-readable validation errors.
 *
 * Security principles
 * ----------------------------------------------------------------------------
 * - Never silently rewrite an untrusted tenant identity before authorization.
 * - Strictly validate tenant IDs against tenant.constants.js.
 * - Treat tenant IDs as identifiers, not free-form strings.
 * - Validate domains using canonical hostname rules.
 * - Reject unknown top-level request fields.
 * - Prevent arbitrary operational functions from being supplied over HTTP.
 * - Keep request validation separate from authorization.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 *
 * Validation does NOT establish tenant authorization.
 *
 * The secure request chain remains:
 *
 *   Authentication
 *        ↓
 *   Tenant Context
 *        ↓
 *   Authorization
 *        ↓
 *   Validation
 *        ↓
 *   Controller
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS references are replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const AjvModule =
    require('ajv');

const Ajv =
    AjvModule.default ||
    AjvModule;

const addFormatsModule =
    require('ajv-formats');

const addFormats =
    addFormatsModule.default ||
    addFormatsModule;

const Joi =
    require('joi');

const tenantConstants =
    require('./tenant.constants');

/**
 * ============================================================================
 * Configuration
 * ============================================================================
 */

const TENANT_ID_REGEX =
    tenantConstants.TENANT_ID_REGEX;

const TENANT_STATUS =
    Object.freeze([
        'pending',
        'active',
        'suspended',
        'deleted',
    ]);

const ALLOWED_UPDATE_FIELDS =
    Object.freeze([
        'name',
        'domain',
        'metadata',
        'settings',
        'status',
        'migration_version',
    ]);

const MAX_METADATA_DEPTH =
    6;

const MAX_JSON_SIZE =
    100_000;

/**
 * ============================================================================
 * AJV
 * ============================================================================
 */

const ajv =
    new Ajv({
        allErrors:
            true,

        removeAdditional:
            false,

        useDefaults:
            false,

        coerceTypes:
            false,

        strict:
            true,

        allowUnionTypes:
            true,
    });

addFormats(
    ajv
);

/**
 * Custom AJV keyword.
 *
 * The keyword performs exact tenant validation against the canonical
 * tenant.constants module.
 */
ajv.addKeyword({
    keyword:
        'titechTenantId',

    type:
        'string',

    schemaType:
        'boolean',

    errors:
        false,

    validate(
        enabled,
        data
    ) {
        if (
            enabled !==
            true
        ) {
            return true;
        }

        return (
            typeof data ===
                'string' &&
            tenantConstants.isValidTenantId(
                data
            )
        );
    },
});

/**
 * ============================================================================
 * Joi Base Validators
 * ============================================================================
 */

/**
 * IMPORTANT:
 *
 * Do NOT use Joi.lowercase() automatically for incoming tenant IDs.
 *
 * Tenant identity must first be validated as supplied. Normalization should
 * be performed by the trusted service layer after validation.
 */
const tenantIdJoi =
    Joi.string()
        .trim()
        .min(3)
        .max(64)
        .pattern(
            TENANT_ID_REGEX
        )
        .custom(
            validateTenantIdJoi
        )
        .messages({
            'string.empty':
                'tenantId is required.',

            'string.min':
                'tenantId must be at least 3 characters.',

            'string.max':
                'tenantId must not exceed 64 characters.',

            'string.pattern.base':
                'tenantId contains invalid characters.',

            'any.invalid':
                'tenantId is invalid.',
        });

const domainJoi =
    Joi.string()
        .trim()
        .max(255)
        .custom(
            validateDomainJoi
        )
        .messages({
            'string.empty':
                'domain cannot be empty.',

            'string.max':
                'domain must not exceed 255 characters.',

            'any.invalid':
                'domain must be a valid hostname.',
        });

const nullableDomainJoi =
    Joi.alternatives()
        .try(
            domainJoi,
            Joi.valid(
                null
            )
        )
        .optional();

const nameJoi =
    Joi.string()
        .trim()
        .min(1)
        .max(255)
        .messages({
            'string.empty':
                'name is required.',

            'string.min':
                'name must not be empty.',

            'string.max':
                'name must not exceed 255 characters.',
        });

const statusJoi =
    Joi.string()
        .valid(
            ...TENANT_STATUS
        );

const migrationVersionJoi =
    Joi.alternatives()
        .try(
            Joi.string()
                .trim()
                .max(128),

            Joi.valid(
                null
            )
        )
        .optional();

/**
 * Metadata/settings intentionally accept flexible objects because their schema
 * belongs to the product/domain layer. Structural protections are still
 * applied to prevent arrays, functions, buffers, and pathological objects.
 */
const metadataJoi =
    Joi.object()
        .custom(
            validateObjectStructure,
            'tenant metadata validation'
        )
        .default({});

const settingsJoi =
    Joi.object()
        .custom(
            validateObjectStructure,
            'tenant settings validation'
        )
        .default({});

/**
 * ============================================================================
 * Request Schemas
 * ============================================================================
 */

/**
 * Create tenant request.
 */
const createTenantSchema =
    Joi.object({
        tenantId:
            tenantIdJoi.required(),

        name:
            nameJoi.required(),

        domain:
            nullableDomainJoi,

        metadata:
            metadataJoi,

        settings:
            settingsJoi,

        provision:
            Joi.boolean()
                .default(
                    true
                ),

        idempotencyKey:
            Joi.string()
                .trim()
                .min(8)
                .max(255)
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .optional()
                .messages({
                    'string.min':
                        'idempotencyKey must be at least 8 characters.',

                    'string.max':
                        'idempotencyKey must not exceed 255 characters.',

                    'string.pattern.base':
                        'idempotencyKey contains unsupported characters.',
                }),
    })
        .options({
            abortEarly:
                false,

            allowUnknown:
                false,

            stripUnknown:
                false,

            convert:
                true,
        });

/**
 * Tenant update request.
 */
const updateTenantSchema =
    Joi.object({
        name:
            nameJoi.optional(),

        domain:
            nullableDomainJoi,

        metadata:
            metadataJoi.optional(),

        settings:
            settingsJoi.optional(),

        status:
            statusJoi.optional(),

        migration_version:
            migrationVersionJoi,
    })
        .min(1)
        .options({
            abortEarly:
                false,

            allowUnknown:
                false,

            stripUnknown:
                false,

            convert:
                true,
        });

/**
 * Settings update.
 *
 * This is deliberately separated from general tenant update so callers cannot
 * accidentally update lifecycle fields while modifying settings.
 */
const updateSettingsSchema =
    Joi.object()
        .custom(
            validateObjectStructure,
            'tenant settings update validation'
        )
        .options({
            abortEarly:
                false,

            allowUnknown:
                true,

            stripUnknown:
                false,

            convert:
                false,
        });

/**
 * Metadata update.
 */
const updateMetadataSchema =
    Joi.object()
        .custom(
            validateObjectStructure,
            'tenant metadata update validation'
        )
        .options({
            abortEarly:
                false,

            allowUnknown:
                true,

            stripUnknown:
                false,

            convert:
                false,
        });

/**
 * Provisioning request.
 *
 * SECURITY:
 *
 * A request body must never be able to submit executable functions.
 *
 * Migration runners, database factories and provisioning callbacks belong to
 * server-side dependency injection and are therefore deliberately excluded.
 */
const provisionOptionsSchema =
    Joi.object({
        force:
            Joi.boolean()
                .optional(),

        mode:
            Joi.string()
                .valid(
                    'SINGLE',
                    'SCHEMA',
                    'DATABASE',
                    'ISOLATED',
                    'HYBRID'
                )
                .optional(),

        allowRawCreateDatabase:
            Joi.boolean()
                .valid(
                    false
                )
                .default(
                    false
                ),

        metadata:
            metadataJoi.optional(),
    })
        .options({
            abortEarly:
                false,

            allowUnknown:
                false,

            stripUnknown:
                false,

            convert:
                true,
        });

/**
 * Pagination/filter schema.
 */
const listTenantsSchema =
    Joi.object({
        page:
            Joi.number()
                .integer()
                .min(1)
                .max(1_000_000)
                .default(1),

        pageSize:
            Joi.number()
                .integer()
                .min(1)
                .max(500)
                .default(50),

        status:
            statusJoi.optional(),

        q:
            Joi.string()
                .trim()
                .max(255)
                .optional(),

        includeDeleted:
            Joi.boolean()
                .default(false),
    })
        .options({
            abortEarly:
                false,

            allowUnknown:
                false,

            convert:
                true,
        });

/**
 * Lifecycle operation schema.
 */
const lifecycleSchema =
    Joi.object({
        idempotencyKey:
            Joi.string()
                .trim()
                .min(8)
                .max(255)
                .pattern(
                    /^[A-Za-z0-9._:-]+$/
                )
                .optional(),

        reason:
            Joi.string()
                .trim()
                .max(1000)
                .optional(),

        confirmTenantId:
            tenantIdJoi.optional(),
    })
        .options({
            abortEarly:
                false,

            allowUnknown:
                false,

            convert:
                true,
        });

/**
 * ============================================================================
 * AJV Tenant Registry Schema
 * ============================================================================
 */

const tenantJsonSchema =
    {
        $schema:
            'https://json-schema.org/draft/2020-12/schema',

        type:
            'object',

        additionalProperties:
            false,

        required:
            [
                'tenant_id',
                'name',
                'status',
            ],

        properties:
            {
                id:
                    {
                        type:
                            'string',

                        format:
                            'uuid',
                    },

                tenant_id:
                    {
                        type:
                            'string',

                        minLength:
                            3,

                        maxLength:
                            64,

                        pattern:
                            TENANT_ID_REGEX,

                        titechTenantId:
                            true,
                    },

                name:
                    {
                        type:
                            'string',

                        minLength:
                            1,

                        maxLength:
                            255,
                    },

                status:
                    {
                        type:
                            'string',

                        enum:
                            TENANT_STATUS,
                    },

                domain:
                    {
                        anyOf:
                            [
                                {
                                    type:
                                        'string',

                                    maxLength:
                                        255,
                                },
                                {
                                    type:
                                        'null',
                                },
                            ],
                    },

                metadata:
                    {
                        anyOf:
                            [
                                {
                                    type:
                                        'object',
                                },
                                {
                                    type:
                                        'null',
                                },
                            ],
                    },

                settings:
                    {
                        anyOf:
                            [
                                {
                                    type:
                                        'object',
                                },
                                {
                                    type:
                                        'null',
                                },
                            ],
                    },

                migration_version:
                    {
                        anyOf:
                            [
                                {
                                    type:
                                        'string',

                                    maxLength:
                                        128,
                                },
                                {
                                    type:
                                        'null',
                                },
                            ],
                    },

                created_at:
                    {
                        type:
                            'string',

                        format:
                            'date-time',
                    },

                updated_at:
                    {
                        type:
                            'string',

                        format:
                            'date-time',
                    },

                deleted_at:
                    {
                        anyOf:
                            [
                                {
                                    type:
                                        'string',

                                    format:
                                        'date-time',
                                },
                                {
                                    type:
                                        'null',
                                },
                            ],
                    },
            },
    };

const validateTenantJson =
    ajv.compile(
        tenantJsonSchema
    );

/**
 * ============================================================================
 * Validation Functions
 * ============================================================================
 */

/**
 * Validate a tenant ID without modifying it.
 */
function validateTenantId(
    tenantId
) {
    if (
        typeof tenantId !==
        'string'
    ) {
        return {
            valid:
                false,

            value:
                null,

            error:
                createSimpleValidationError(
                    'tenantId must be a string.',
                    'tenant_id.type'
                ),
        };
    }

    const value =
        tenantId.trim();

    if (
        !tenantConstants.isValidTenantId(
            value
        )
    ) {
        return {
            valid:
                false,

            value:
                null,

            error:
                createSimpleValidationError(
                    'tenantId is invalid.',
                    'tenant_id'
                ),
        };
    }

    return {
        valid:
            true,

        value,
        error:
            null,
    };
}

/**
 * Explicit trusted normalization.
 *
 * This must not be used as a substitute for validation.
 */
function normalizeValidatedTenantId(
    tenantId
) {
    const result =
        validateTenantId(
            tenantId
        );

    if (
        !result.valid
    ) {
        throw createValidationException(
            result.error
        );
    }

    return result.value
        .toLowerCase();
}

/**
 * Existing compatibility helper.
 *
 * Unlike the old implementation, this function first validates and then
 * returns the canonical normalized representation.
 */
function sanitizeTenantId(
    raw
) {
    const value =
        normalizeOptionalString(
            raw
        );

    if (
        !value
    ) {
        return null;
    }

    const result =
        validateTenantId(
            value
        );

    if (
        !result.valid
    ) {
        return null;
    }

    return result.value
        .toLowerCase();
}

function isValidTenantId(
    tenantId
) {
    return Boolean(
        tenantConstants.isValidTenantId(
            tenantId
        )
    );
}

/**
 * Validate domain.
 */
function validateDomain(
    domain
) {
    if (
        domain ===
            null ||
        domain ===
            undefined ||
        String(
            domain
        ).trim() ===
            ''
    ) {
        return {
            valid:
                true,

            value:
                domain ===
                    undefined
                    ? undefined
                    : null,

            error:
                null,
        };
    }

    const value =
        String(
            domain
        )
            .trim()
            .toLowerCase();

    if (
        typeof tenantConstants
            .isValidHostname !==
            'function'
    ) {
        return {
            valid:
                false,

            value:
                null,

            error:
                createSimpleValidationError(
                    'Tenant hostname validation is not configured.',
                    'domain.configuration'
                ),
        };
    }

    if (
        !tenantConstants.isValidHostname(
            value
        )
    ) {
        return {
            valid:
                false,

            value:
                null,

            error:
                createSimpleValidationError(
                    'domain must be a valid hostname.',
                    'domain'
                ),
        };
    }

    return {
        valid:
            true,

        value,

        error:
            null,
    };
}

/**
 * Validate create request.
 */
function validateCreatePayload(
    payload = {}
) {
    return validateJoiSchema(
        createTenantSchema,
        payload,
        'Invalid create tenant payload'
    );
}

/**
 * Validate update request.
 */
function validateUpdatePayload(
    payload = {}
) {
    return validateJoiSchema(
        updateTenantSchema,
        payload,
        'Invalid update tenant payload'
    );
}

/**
 * Validate settings request.
 */
function validateUpdateSettingsPayload(
    payload = {}
) {
    return validateJoiSchema(
        updateSettingsSchema,
        payload,
        'Invalid tenant settings payload'
    );
}

/**
 * Validate metadata request.
 */
function validateUpdateMetadataPayload(
    payload = {}
) {
    return validateJoiSchema(
        updateMetadataSchema,
        payload,
        'Invalid tenant metadata payload'
    );
}

/**
 * Validate provisioning request.
 */
function validateProvisionOptions(
    payload = {}
) {
    return validateJoiSchema(
        provisionOptionsSchema,
        payload,
        'Invalid tenant provisioning options'
    );
}

/**
 * Validate tenant list/query request.
 */
function validateListTenants(
    payload = {}
) {
    return validateJoiSchema(
        listTenantsSchema,
        payload,
        'Invalid tenant list parameters'
    );
}

/**
 * Validate lifecycle request.
 */
function validateLifecyclePayload(
    payload = {}
) {
    return validateJoiSchema(
        lifecycleSchema,
        payload,
        'Invalid tenant lifecycle payload'
    );
}

/**
 * Validate a persisted tenant registry object.
 */
function validateTenantRegistryObject(
    object = {}
) {
    const valid =
        validateTenantJson(
            object
        );

    if (
        valid
    ) {
        return {
            valid:
                true,

            value:
                object,

            error:
                null,
        };
    }

    return {
        valid:
            false,

        value:
            null,

        error:
            formatAjvErrors(
                validateTenantJson.errors
            ),
    };
}

/**
 * ============================================================================
 * Joi Helpers
 * ============================================================================
 */

function validateJoiSchema(
    schema,
    payload,
    genericMessage
) {
    const result =
        schema.validate(
            payload,
            {
                convert:
                    true,
            }
        );

    if (
        !result.error
    ) {
        return {
            valid:
                true,

            value:
                result.value,

            error:
                null,
        };
    }

    return {
        valid:
            false,

        value:
            null,

        error:
            formatJoiErrors(
                result.error,
                genericMessage
            ),
    };
}

/**
 * ============================================================================
 * Express Middleware
 * ============================================================================
 *
 * Supported schema names:
 *
 *   create
 *   update
 *   settings
 *   metadata
 *   provisionOptions
 *   lifecycle
 *   list
 *   tenantIdParam
 * ============================================================================
 */

function expressValidatorMiddleware(
    schemaName,
    options = {}
) {
    return function tenantValidationMiddleware(
        req,
        res,
        next
    ) {
        try {
            switch (
                schemaName
            ) {
                case 'create': {
                    const result =
                        validateCreatePayload(
                            req.body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_CREATE_TENANT_PAYLOAD'
                            )
                        );
                    }

                    /**
                     * Important:
                     *
                     * Validation succeeded BEFORE normalization.
                     */
                    req.validatedBody =
                        {
                            ...result.value,

                            tenantId:
                                normalizeValidatedTenantId(
                                    result.value
                                        .tenantId
                                ),
                        };

                    return next();
                }

                case 'update': {
                    const result =
                        validateUpdatePayload(
                            req.body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_UPDATE_TENANT_PAYLOAD'
                            )
                        );
                    }

                    req.validatedBody =
                        result.value;

                    return next();
                }

                case 'settings': {
                    const result =
                        validateUpdateSettingsPayload(
                            req.body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_TENANT_SETTINGS'
                            )
                        );
                    }

                    req.validatedBody =
                        result.value;

                    return next();
                }

                case 'metadata': {
                    const result =
                        validateUpdateMetadataPayload(
                            req.body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_TENANT_METADATA'
                            )
                        );
                    }

                    req.validatedBody =
                        result.value;

                    return next();
                }

                case 'provisionOptions': {
                    const result =
                        validateProvisionOptions(
                            req.body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_TENANT_PROVISION_OPTIONS'
                            )
                        );
                    }

                    req.validatedBody =
                        result.value;

                    return next();
                }

                case 'lifecycle': {
                    const result =
                        validateLifecyclePayload(
                            req.body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_TENANT_LIFECYCLE_PAYLOAD'
                            )
                        );
                    }

                    req.validatedBody =
                        result.value;

                    return next();
                }

                case 'list': {
                    const result =
                        validateListTenants(
                            req.query ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                result.error,
                                'INVALID_TENANT_LIST_PARAMETERS'
                            )
                        );
                    }

                    req.validatedQuery =
                        result.value;

                    return next();
                }

                case 'tenantIdParam': {
                    const paramName =
                        options.paramName ||
                        'tenantId';

                    const raw =
                        req.params?.[
                            paramName
                        ];

                    const result =
                        validateTenantId(
                            raw
                        );

                    if (
                        !result.valid
                    ) {
                        return next(
                            createValidationException(
                                {
                                    message:
                                        'Invalid tenant identifier.',

                                    details:
                                        [
                                            {
                                                path:
                                                    paramName,

                                                type:
                                                    'tenant_id.invalid',
                                            },
                                        ],
                                },
                                'INVALID_TENANT_ID'
                            )
                        );
                    }

                    /**
                     * Normalize only AFTER strict validation.
                     */
                    req.params[
                        paramName
                    ] =
                        normalizeValidatedTenantId(
                            result.value
                        );

                    return next();
                }

                default:
                    return next(
                        createValidationException(
                            {
                                message:
                                    `Unknown tenant validation schema "${schemaName}".`,

                                details:
                                    [],
                            },
                            'UNKNOWN_VALIDATION_SCHEMA',
                            500
                        )
                    );
            }
        } catch (
            error
        ) {
            return next(
                error
            );
        }
    };
}

/**
 * ============================================================================
 * Koa Middleware
 * ============================================================================
 */

function koaValidatorMiddleware(
    schemaName,
    options = {}
) {
    return async function tenantValidationMiddleware(
        ctx,
        next
    ) {
        try {
            switch (
                schemaName
            ) {
                case 'create': {
                    const result =
                        validateCreatePayload(
                            ctx.request
                                .body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_CREATE_TENANT_PAYLOAD'
                        );
                    }

                    ctx.state.validatedBody =
                        {
                            ...result.value,

                            tenantId:
                                normalizeValidatedTenantId(
                                    result.value
                                        .tenantId
                                ),
                        };

                    return next();
                }

                case 'update': {
                    const result =
                        validateUpdatePayload(
                            ctx.request
                                .body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_UPDATE_TENANT_PAYLOAD'
                        );
                    }

                    ctx.state.validatedBody =
                        result.value;

                    return next();
                }

                case 'settings': {
                    const result =
                        validateUpdateSettingsPayload(
                            ctx.request
                                .body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_TENANT_SETTINGS'
                        );
                    }

                    ctx.state.validatedBody =
                        result.value;

                    return next();
                }

                case 'metadata': {
                    const result =
                        validateUpdateMetadataPayload(
                            ctx.request
                                .body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_TENANT_METADATA'
                        );
                    }

                    ctx.state.validatedBody =
                        result.value;

                    return next();
                }

                case 'provisionOptions': {
                    const result =
                        validateProvisionOptions(
                            ctx.request
                                .body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_TENANT_PROVISION_OPTIONS'
                        );
                    }

                    ctx.state.validatedBody =
                        result.value;

                    return next();
                }

                case 'lifecycle': {
                    const result =
                        validateLifecyclePayload(
                            ctx.request
                                .body ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_TENANT_LIFECYCLE_PAYLOAD'
                        );
                    }

                    ctx.state.validatedBody =
                        result.value;

                    return next();
                }

                case 'list': {
                    const result =
                        validateListTenants(
                            ctx.request
                                .query ||
                                {}
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            result.error,
                            'INVALID_TENANT_LIST_PARAMETERS'
                        );
                    }

                    ctx.state.validatedQuery =
                        result.value;

                    return next();
                }

                case 'tenantIdParam': {
                    const paramName =
                        options.paramName ||
                        'tenantId';

                    const raw =
                        ctx.params?.[
                            paramName
                        ];

                    const result =
                        validateTenantId(
                            raw
                        );

                    if (
                        !result.valid
                    ) {
                        return respondKoaValidationError(
                            ctx,
                            {
                                message:
                                    'Invalid tenant identifier.',

                                details:
                                    [
                                        {
                                            path:
                                                paramName,

                                            type:
                                                'tenant_id.invalid',
                                        },
                                    ],
                            },
                            'INVALID_TENANT_ID'
                        );
                    }

                    ctx.params[
                        paramName
                    ] =
                        normalizeValidatedTenantId(
                            result.value
                        );

                    return next();
                }

                default:
                    return respondKoaValidationError(
                        ctx,
                        {
                            message:
                                `Unknown tenant validation schema "${schemaName}".`,

                            details:
                                [],
                        },
                        'UNKNOWN_VALIDATION_SCHEMA',
                        500
                    );
            }
        } catch (
            error
        ) {
            ctx.status =
                error.status ||
                error.statusCode ||
                500;

            ctx.body =
                {
                    success:
                        false,

                    code:
                        error.code ||
                        'TENANT_VALIDATION_ERROR',

                    message:
                        error.message ||
                        'Tenant validation failed.',
                };

            return;
        }
    };
}

/**
 * ============================================================================
 * Error Formatting
 * ============================================================================
 */

function formatJoiErrors(
    error,
    defaultMessage =
        'Validation failed.'
) {
    if (
        !error ||
        !Array.isArray(
            error.details
        )
    ) {
        return {
            message:
                defaultMessage,

            details:
                [],
        };
    }

    return {
        message:
            defaultMessage,

        details:
            error.details.map(
                detail => ({
                    message:
                        detail.message,

                    path:
                        detail.path.join(
                            '.'
                        ),

                    type:
                        detail.type,

                    context:
                        sanitizeContext(
                            detail.context
                        ),
                })
            ),
    };
}

function formatAjvErrors(
    errors
) {
    if (
        !Array.isArray(
            errors
        )
    ) {
        return {
            message:
                'AJV validation failed.',

            details:
                [],
        };
    }

    return {
        message:
            'AJV validation failed.',

        details:
            errors.map(
                error => ({
                    message:
                        buildAjvMessage(
                            error
                        ),

                    path:
                        error.instancePath ||
                        error.dataPath ||
                        buildAjvPath(
                            error
                        ),

                    keyword:
                        error.keyword,

                    params:
                        error.params,
                })
            ),
    };
}

function buildAjvPath(
    error
) {
    if (
        error?.params?.missingProperty
    ) {
        return error
            .params
            .missingProperty;
    }

    return '';
}

function sanitizeContext(
    context
) {
    if (
        !context ||
        typeof context !==
            'object'
    ) {
        return undefined;
    }

    const allowed = [
        'limit',
        'value',
        'label',
        'key',
    ];

    const result =
        {};

    for (
        const key of allowed
    ) {
        if (
            Object.prototype.hasOwnProperty.call(
                context,
                key
            )
        ) {
            result[key] =
                context[key];
        }
    }

    return Object.keys(
        result
    ).length
        ? result
        : undefined;
}

/**
 * ============================================================================
 * Validation Error Construction
 * ============================================================================
 */

function createValidationException(
    validation,
    code =
        'TENANT_VALIDATION_ERROR',
    status =
        400
) {
    const error =
        new Error(
            validation?.message ||
                'Tenant validation failed.'
        );

    error.name =
        'TenantValidationError';

    error.code =
        code;

    error.status =
        status;

    error.statusCode =
        status;

    error.validation =
        validation ||
        null;

    return error;
}

function buildValidationErrorResponse(
    error
) {
    if (
        !error
    ) {
        return null;
    }

    return {
        success:
            false,

        code:
            error.code ||
            'TENANT_VALIDATION_ERROR',

        message:
            error.message ||
            'Validation failed.',

        status:
            error.status ||
            error.statusCode ||
            400,

        validation:
            error.validation ||
            null,
    };
}

/**
 * ============================================================================
 * Koa Response Helper
 * ============================================================================
 */

function respondKoaValidationError(
    ctx,
    validation,
    code =
        'TENANT_VALIDATION_ERROR',
    status =
        400
) {
    ctx.status =
        status;

    ctx.body =
        {
            success:
                false,

            code,

            message:
                validation?.message ||
                'Tenant validation failed.',

            validation:
                validation ||
                null,
        };
}

/**
 * ============================================================================
 * Custom Joi Validators
 * ============================================================================
 */

function validateTenantIdJoi(
    value,
    helpers
) {
    const result =
        tenantConstants.isValidTenantId(
            value
        );

    if (
        !result
    ) {
        return helpers.error(
            'any.invalid'
        );
    }

    return value;
}

function validateDomainJoi(
    value,
    helpers
) {
    if (
        typeof tenantConstants
            .isValidHostname !==
            'function'
    ) {
        return helpers.error(
            'any.invalid'
        );
    }

    if (
        !tenantConstants.isValidHostname(
            value
        )
    ) {
        return helpers.error(
            'any.invalid'
        );
    }

    return value
        .toLowerCase();
}

function validateObjectStructure(
    value,
    helpers
) {
    if (
        !isPlainObject(
            value
        )
    ) {
        return helpers.error(
            'object.base'
        );
    }

    try {
        validateJsonValue(
            value,
            0,
            ''
        );
    } catch (
        error
    ) {
        return helpers.message(
            error.message
        );
    }

    return value;
}

/**
 * ============================================================================
 * Generic JSON Structure Protection
 * ============================================================================
 */

function validateJsonValue(
    value,
    depth,
    path
) {
    if (
        depth >
        MAX_METADATA_DEPTH
    ) {
        throw new Error(
            `Object nesting exceeds the maximum depth of ${MAX_METADATA_DEPTH} at ${path || 'root'}.`
        );
    }

    if (
        value ===
            null ||
        typeof value ===
            'string' ||
        typeof value ===
            'boolean'
    ) {
        if (
            typeof value ===
                'string' &&
            Buffer.byteLength(
                value,
                'utf8'
            ) >
                MAX_JSON_SIZE
        ) {
            throw new Error(
                `Value at ${path || 'root'} exceeds the maximum supported size.`
            );
        }

        return;
    }

    if (
        typeof value ===
            'number'
    ) {
        if (
            !Number.isFinite(
                value
            )
        ) {
            throw new Error(
                `Non-finite numeric value at ${path || 'root'} is not allowed.`
            );
        }

        return;
    }

    if (
        Array.isArray(
            value
        )
    ) {
        for (
            let index = 0;
            index <
            value.length;
            index += 1
        ) {
            validateJsonValue(
                value[index],
                depth + 1,
                `${path}[${index}]`
            );
        }

        return;
    }

    if (
        typeof value ===
        'object'
    ) {
        for (
            const [
                key,
                child,
            ] of Object.entries(
                value
            )
        ) {
            if (
                key.length >
                255
            ) {
                throw new Error(
                    `Object key at ${path || 'root'} exceeds 255 characters.`
                );
            }

            validateJsonValue(
                child,
                depth + 1,
                path
                    ? `${path}.${key}`
                    : key
            );
        }

        return;
    }

    throw new Error(
        `Unsupported value type at ${path || 'root'}.`
    );
}

/**
 * ============================================================================
 * Utility
 * ============================================================================
 */

function normalizeOptionalString(
    value
) {
    if (
        value ===
            undefined ||
        value ===
            null
    ) {
        return null;
    }

    const normalized =
        String(
            value
        ).trim();

    return (
        normalized ||
        null
    );
}

function createSimpleValidationError(
    message,
    path
) {
    return {
        message,

        details:
            [
                {
                    message,

                    path,

                    type:
                        'validation',
                },
            ],
    };
}

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
    Object.freeze({
        /**
         * Joi schemas
         */
        schemas:
            Object.freeze({
                createTenantSchema,

                updateTenantSchema,

                updateSettingsSchema,

                updateMetadataSchema,

                provisionOptionsSchema,

                lifecycleSchema,

                listTenantsSchema,
            }),

        /**
         * AJV schema
         */
        tenantJsonSchema,

        /**
         * AJV validation
         */
        validateTenantRegistryObject,

        /**
         * Request validation
         */
        validateCreatePayload,

        validateUpdatePayload,

        validateUpdateSettingsPayload,

        validateUpdateMetadataPayload,

        validateProvisionOptions,

        validateLifecyclePayload,

        validateListTenants,

        validateTenantId,

        validateDomain,

        /**
         * Tenant identity helpers
         */
        sanitizeTenantId,

        normalizeValidatedTenantId,

        isValidTenantId,

        /**
         * Middleware
         */
        expressValidatorMiddleware,

        koaValidatorMiddleware,

        /**
         * Error formatting
         */
        formatJoiErrors,

        formatAjvErrors,

        buildValidationErrorResponse,

        createValidationException,

        /**
         * Constants
         */
        TENANT_STATUS,
    });