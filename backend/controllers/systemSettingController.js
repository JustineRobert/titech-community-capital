'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * ENTERPRISE SYSTEM SETTING CONTROLLER
 * ============================================================================
 *
 * File:
 *   backend/controllers/systemSettingController.js
 *
 * Purpose:
 *   Enterprise HTTP/controller boundary for centralized TITech configuration.
 *
 * Architectural responsibilities:
 *
 *   - Tenant-isolated system settings
 *   - Global SYSTEM settings
 *   - Tenant configuration overrides
 *   - Effective configuration resolution
 *   - Feature/configuration management
 *   - Optimistic concurrency protection
 *   - Protected setting enforcement
 *   - Audit correlation
 *   - Pagination
 *   - Safe API responses
 *   - Consistent error handling
 *   - Authorization-aware mutation boundaries
 *
 * SECURITY PRINCIPLES
 * ----------------------------------------------------------------------------
 *
 * 1. Controllers NEVER trust tenantId supplied by ordinary clients.
 * 2. Controllers prefer authenticated tenant context.
 * 3. SYSTEM scope requires explicit privileged authorization.
 * 4. Protected settings cannot be changed through ordinary mutation paths.
 * 5. expectedVersion is supported for optimistic concurrency.
 * 6. Raw internal Mongoose errors are never returned directly to clients.
 * 7. Secrets should not be returned by generic configuration endpoints.
 * 8. Financial balances, transactions and ledger state do NOT belong here.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * Business authorization should preferably be enforced by middleware/service
 * layers as well. This controller provides a second defensive boundary.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const SystemSetting = require('../models/SystemSetting');

/**
 * Optional validator import.
 *
 * The controller remains operational if the validator exports only individual
 * functions or if validation is primarily performed by route middleware.
 */
let systemSettingValidator = null;

try {
    systemSettingValidator =
        require('../validators/systemSettingValidator');
} catch (error) {
    systemSettingValidator = null;
}

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SYSTEM_TENANT_ID =
    SystemSetting.SYSTEM_TENANT_ID || 'SYSTEM';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const DEFAULT_AUDIT_LIMIT = 100;

/**
 * Fields that are never accepted from arbitrary update payloads.
 *
 * These fields represent identity, tenancy, concurrency or audit state.
 */
const IMMUTABLE_FIELDS = Object.freeze([
    '_id',
    'id',
    'tenantId',
    'key',
    'version',
    '__v',
    'createdAt',
    'updatedAt',
    'createdBy',
    'updatedBy',
    'lastRequestId',
    'auditLog',
    'isSystem'
]);

/**
 * Fields that may be modified by the standard update endpoint.
 */
const MUTABLE_FIELDS = Object.freeze([
    'name',
    'description',
    'category',
    'value',
    'valueType',
    'enabled',
    'complianceRelevant',
    'regulatoryCritical',
    'editable',
    'metadata'
]);

/**
 * ============================================================================
 * ERROR FACTORY
 * ============================================================================
 */

function createControllerError(
    message,
    code,
    statusCode = 400,
    details = undefined
) {
    const error = new Error(message);

    error.code = code;
    error.statusCode = statusCode;

    if (details !== undefined) {
        error.details = details;
    }

    return error;
}

/**
 * ============================================================================
 * REQUEST ID
 * ============================================================================
 */

function getRequestId(req) {
    return (
        req.id ||
        req.requestId ||
        req.headers?.['x-request-id'] ||
        req.headers?.['x-correlation-id'] ||
        null
    );
}

/**
 * ============================================================================
 * AUTHENTICATED USER
 * ============================================================================
 */

function getAuthenticatedUserId(req) {
    return (
        req.user?._id ||
        req.user?.id ||
        req.auth?.userId ||
        null
    );
}

/**
 * ============================================================================
 * TENANT CONTEXT
 * ============================================================================
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * Never allow a normal tenant user to select another tenant by simply sending
 * tenantId in the request body/query.
 *
 * The exact authentication middleware may expose tenant context under one of
 * several common names, so we support the established conventions while
 * keeping the body/query as fallback only for trusted/system contexts.
 * ============================================================================
 */

function getAuthenticatedTenantId(req) {
    return (
        req.tenantId ||
        req.tenant?.id ||
        req.tenant?._id ||
        req.user?.tenantId ||
        req.user?.tenant?._id ||
        req.auth?.tenantId ||
        null
    );
}

/**
 * ============================================================================
 * ROLE / PRIVILEGE HELPERS
 * ============================================================================
 */

function getRoles(req) {
    const roles = [
        ...(Array.isArray(req.user?.roles)
            ? req.user.roles
            : []),

        ...(Array.isArray(req.auth?.roles)
            ? req.auth.roles
            : [])
    ];

    if (req.user?.role) {
        roles.push(req.user.role);
    }

    if (req.auth?.role) {
        roles.push(req.auth.role);
    }

    return [
        ...new Set(
            roles
                .filter(Boolean)
                .map((role) =>
                    String(role)
                        .trim()
                        .toUpperCase()
                )
        )
    ];
}

function hasRole(req, roles = []) {
    const currentRoles = getRoles(req);

    return roles.some((role) =>
        currentRoles.includes(
            String(role)
                .trim()
                .toUpperCase()
        )
    );
}

function isPrivilegedSystemActor(req) {
    return (
        req.isSystemRequest === true ||
        req.auth?.isSystem === true ||
        hasRole(req, [
            'SUPER_ADMIN',
            'SYSTEM_ADMIN',
            'PLATFORM_ADMIN',
            'SYSTEM_OPERATOR'
        ])
    );
}

/**
 * ============================================================================
 * TENANT RESOLUTION
 * ============================================================================
 */

function resolveTenantId(req, requestedTenantId = null) {
    const authenticatedTenantId =
        getAuthenticatedTenantId(req);

    const requested =
        requestedTenantId !== null &&
        requestedTenantId !== undefined &&
        String(requestedTenantId).trim() !== ''
            ? String(requestedTenantId).trim()
            : null;

    /**
     * SYSTEM scope is only available to explicitly privileged actors.
     */
    if (
        requested &&
        requested.toUpperCase() === SYSTEM_TENANT_ID
    ) {
        if (!isPrivilegedSystemActor(req)) {
            throw createControllerError(
                'Access to SYSTEM configuration is restricted.',
                'SYSTEM_SETTING_SYSTEM_SCOPE_FORBIDDEN',
                403
            );
        }

        return SYSTEM_TENANT_ID;
    }

    /**
     * A privileged platform administrator may explicitly operate on another
     * tenant.
     */
    if (
        requested &&
        authenticatedTenantId &&
        requested.toUpperCase() !==
            String(authenticatedTenantId)
                .trim()
                .toUpperCase()
    ) {
        if (!isPrivilegedSystemActor(req)) {
            throw createControllerError(
                'Cross-tenant configuration access is forbidden.',
                'SYSTEM_SETTING_CROSS_TENANT_FORBIDDEN',
                403
            );
        }

        return requested.toUpperCase();
    }

    if (requested) {
        return requested.toUpperCase();
    }

    if (authenticatedTenantId) {
        return String(
            authenticatedTenantId
        )
            .trim()
            .toUpperCase();
    }

    /**
     * No tenant context:
     *
     * Only a privileged system actor may default to SYSTEM.
     */
    if (isPrivilegedSystemActor(req)) {
        return SYSTEM_TENANT_ID;
    }

    throw createControllerError(
        'Tenant context is required.',
        'TENANT_CONTEXT_REQUIRED',
        400
    );
}

/**
 * ============================================================================
 * REQUEST VALUE HELPERS
 * ============================================================================
 */

function getBody(req) {
    return (
        req.body &&
        typeof req.body === 'object'
            ? req.body
            : {}
    );
}

function getQuery(req) {
    return (
        req.query &&
        typeof req.query === 'object'
            ? req.query
            : {}
    );
}

function parseBoolean(value, defaultValue = undefined) {
    if (value === undefined || value === null) {
        return defaultValue;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    const normalized =
        String(value)
            .trim()
            .toLowerCase();

    if ([
        'true',
        '1',
        'yes',
        'on'
    ].includes(normalized)) {
        return true;
    }

    if ([
        'false',
        '0',
        'no',
        'off'
    ].includes(normalized)) {
        return false;
    }

    return defaultValue;
}

function parsePositiveInteger(
    value,
    defaultValue,
    max = Number.MAX_SAFE_INTEGER
) {
    const parsed =
        Number.parseInt(
            value,
            10
        );

    if (
        !Number.isInteger(parsed) ||
        parsed < 1
    ) {
        return defaultValue;
    }

    return Math.min(
        parsed,
        max
    );
}

function parseExpectedVersion(value) {
    if (
        value === undefined ||
        value === null ||
        value === ''
    ) {
        return undefined;
    }

    const parsed =
        Number(value);

    if (
        !Number.isInteger(parsed) ||
        parsed < 1
    ) {
        throw createControllerError(
            'expectedVersion must be a positive integer.',
            'INVALID_EXPECTED_VERSION',
            400
        );
    }

    return parsed;
}

/**
 * ============================================================================
 * SAFE OBJECT HANDLING
 * ============================================================================
 */

function isPlainObject(value) {
    if (
        value === null ||
        typeof value !== 'object'
    ) {
        return false;
    }

    const prototype =
        Object.getPrototypeOf(value);

    return (
        prototype === Object.prototype ||
        prototype === null
    );
}

function cloneValue(value) {
    if (
        value === undefined ||
        value === null
    ) {
        return value;
    }

    if (value instanceof Date) {
        return new Date(
            value.getTime()
        );
    }

    if (
        value instanceof mongoose.Types.ObjectId
    ) {
        return new mongoose.Types.ObjectId(
            value
        );
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
        return value;
    }
}

/**
 * ============================================================================
 * SENSITIVE SETTING DETECTION
 * ============================================================================
 *
 * Generic configuration endpoints should not accidentally expose secrets.
 *
 * This is intentionally conservative. Secret-bearing settings should ideally
 * be stored in a dedicated secrets manager rather than SystemSetting.
 * ============================================================================
 */

const SENSITIVE_KEY_PATTERNS = Object.freeze([
    /PASSWORD/i,
    /SECRET/i,
    /PRIVATE_KEY/i,
    /CLIENT_SECRET/i,
    /API_KEY/i,
    /ACCESS_TOKEN/i,
    /REFRESH_TOKEN/i,
    /ENCRYPTION_KEY/i,
    /SIGNING_KEY/i,
    /JWT_SECRET/i,
    /WEBHOOK_SECRET/i,
    /CREDENTIAL/i
]);

function isSensitiveSetting(setting) {
    if (!setting) {
        return false;
    }

    const key =
        String(setting.key || '');

    return SENSITIVE_KEY_PATTERNS.some(
        (pattern) =>
            pattern.test(key)
    );
}

/**
 * ============================================================================
 * RESPONSE SERIALIZATION
 * ============================================================================
 */

function serializeSetting(
    setting,
    options = {}
) {
    if (!setting) {
        return null;
    }

    const plain =
        typeof setting.toObject === 'function'
            ? setting.toObject({
                virtuals: true
            })
            : {
                ...setting
            };

    delete plain.__v;

    if (plain._id) {
        plain.id =
            String(plain._id);

        delete plain._id;
    }

    /**
     * Never expose the audit trail from ordinary endpoints unless explicitly
     * requested by a privileged caller.
     */
    if (
        options.includeAudit !== true
    ) {
        delete plain.auditLog;
    }

    /**
     * Never expose sensitive values through generic setting APIs.
     */
    if (
        options.includeSensitive !== true &&
        isSensitiveSetting(plain)
    ) {
        plain.value = '[REDACTED]';
    }

    return plain;
}

/**
 * ============================================================================
 * VALIDATOR INTEGRATION
 * ============================================================================
 */

function invokeValidator(
    validatorName,
    payload,
    options = {}
) {
    if (
        !systemSettingValidator ||
        typeof systemSettingValidator[
            validatorName
        ] !== 'function'
    ) {
        return payload;
    }

    try {
        const result =
            systemSettingValidator[
                validatorName
            ](
                payload,
                options
            );

        return result || payload;
    } catch (error) {
        throw error;
    }
}

/**
 * ============================================================================
 * INPUT SANITIZATION
 * ============================================================================
 */

function sanitizeCreatePayload(
    req,
    tenantId
) {
    const body =
        getBody(req);

    const payload = {};

    const allowedFields = [
        'key',
        'category',
        'name',
        'description',
        'value',
        'valueType',
        'enabled',
        'editable',
        'complianceRelevant',
        'regulatoryCritical',
        'metadata'
    ];

    for (
        const field of allowedFields
    ) {
        if (
            Object.prototype.hasOwnProperty.call(
                body,
                field
            )
        ) {
            payload[field] =
                body[field];
        }
    }

    payload.tenantId =
        tenantId;

    /**
     * SYSTEM is derived from scope and cannot be supplied by clients.
     */
    if (
        tenantId === SYSTEM_TENANT_ID
    ) {
        payload.isSystem = true;
        payload.editable = false;
    }

    return invokeValidator(
        'validateCreate',
        payload,
        {
            req
        }
    );
}

function sanitizeUpdatePayload(
    req
) {
    const body =
        getBody(req);

    const updates = {};

    for (
        const field of MUTABLE_FIELDS
    ) {
        if (
            Object.prototype.hasOwnProperty.call(
                body,
                field
            )
        ) {
            updates[field] =
                body[field];
        }
    }

    /**
     * Explicitly reject immutable fields rather than silently accepting them.
     */
    const attemptedImmutableFields =
        IMMUTABLE_FIELDS.filter(
            (field) =>
                Object.prototype.hasOwnProperty.call(
                    body,
                    field
                )
        );

    if (
        attemptedImmutableFields.length > 0
    ) {
        throw createControllerError(
            `The following fields cannot be modified: ${attemptedImmutableFields.join(', ')}.`,
            'SYSTEM_SETTING_IMMUTABLE_FIELDS',
            400
        );
    }

    return invokeValidator(
        'validateUpdate',
        updates,
        {
            req
        }
    );
}

/**
 * ============================================================================
 * AUTHORIZATION GUARDS
 * ============================================================================
 */

function assertCanMutateSetting(
    req,
    setting = null,
    tenantId = null
) {
    if (
        tenantId === SYSTEM_TENANT_ID &&
        !isPrivilegedSystemActor(req)
    ) {
        throw createControllerError(
            'Only privileged platform administrators may modify SYSTEM settings.',
            'SYSTEM_SETTING_SYSTEM_WRITE_FORBIDDEN',
            403
        );
    }

    if (
        setting &&
        (
            setting.isSystem === true ||
            setting.editable === false
        ) &&
        !isPrivilegedSystemActor(req)
    ) {
        throw createControllerError(
            'This system setting is protected.',
            'SYSTEM_SETTING_PROTECTED',
            403
        );
    }
}

/**
 * ============================================================================
 * ERROR RESPONSE
 * ============================================================================
 */

function sendControllerError(
    res,
    error,
    fallbackStatus = 500
) {
    const statusCode =
        Number.isInteger(
            error?.statusCode
        )
            ? error.statusCode
            : (
                error?.code ===
                'SYSTEM_SETTING_VERSION_CONFLICT'
                    ? 409
                    : fallbackStatus
            );

    const knownCodes = new Set([
        'SYSTEM_SETTING_PROTECTED',
        'SYSTEM_SETTING_VERSION_CONFLICT',
        'SYSTEM_SETTING_SYSTEM_SCOPE_FORBIDDEN',
        'SYSTEM_SETTING_SYSTEM_WRITE_FORBIDDEN',
        'SYSTEM_SETTING_CROSS_TENANT_FORBIDDEN',
        'SYSTEM_SETTING_IMMUTABLE_FIELDS',
        'TENANT_CONTEXT_REQUIRED',
        'INVALID_EXPECTED_VERSION',
        'SETTING_NOT_FOUND',
        'SETTING_ALREADY_EXISTS',
        'INVALID_SETTING_ID',
        'VALIDATION_ERROR'
    ]);

    const code =
        knownCodes.has(
            error?.code
        )
            ? error.code
            : 'SYSTEM_SETTING_OPERATION_FAILED';

    const response = {
        success: false,
        error: {
            code,
            message:
                error?.message ||
                'System setting operation failed.'
        }
    };

    /**
     * Validation details are useful to clients.
     * Internal database details are intentionally excluded.
     */
    if (
        error?.details &&
        typeof error.details === 'object'
    ) {
        response.error.details =
            error.details;
    }

    return res
        .status(statusCode)
        .json(response);
}

/**
 * ============================================================================
 * CREATE SETTING
 * ============================================================================
 *
 * POST /system-settings
 * ============================================================================
 */

async function createSetting(req, res) {
    try {
        const body =
            getBody(req);

        const tenantId =
            resolveTenantId(
                req,
                body.tenantId
            );

        assertCanMutateSetting(
            req,
            null,
            tenantId
        );

        const payload =
            sanitizeCreatePayload(
                req,
                tenantId
            );

        const userId =
            getAuthenticatedUserId(req);

        const requestId =
            getRequestId(req);

        /**
         * Prevent accidental duplicate creation and produce a deterministic
         * business error rather than exposing MongoDB E11000.
         */
        const existing =
            await SystemSetting
                .findOne({
                    tenantId,
                    key:
                        SystemSetting.normalizeKey(
                            payload.key
                        )
                })
                .select('_id');

        if (existing) {
            throw createControllerError(
                'A system setting with this tenant and key already exists.',
                'SETTING_ALREADY_EXISTS',
                409
            );
        }

        const setting =
            new SystemSetting({
                ...payload,

                tenantId,

                createdBy:
                    userId || null,

                updatedBy:
                    userId || null,

                lastRequestId:
                    requestId || null
            });

        await setting.validate();

        await setting.save();

        return res
            .status(201)
            .json({
                success: true,
                data: serializeSetting(
                    setting
                )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * GET SETTING
 * ============================================================================
 *
 * GET /system-settings/:key
 * ============================================================================
 */

async function getSetting(req, res) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        if (!key) {
            throw createControllerError(
                'System setting key is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const setting =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                })
                .lean();

        if (!setting) {
            throw createControllerError(
                'System setting not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        const includeSensitive =
            isPrivilegedSystemActor(req) &&
            parseBoolean(
                req.query?.includeSensitive,
                false
            ) === true;

        return res
            .status(200)
            .json({
                success: true,
                data: serializeSetting(
                    setting,
                    {
                        includeSensitive
                    }
                )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * GET EFFECTIVE SETTING
 * ============================================================================
 *
 * Resolves:
 *
 *   Tenant Override
 *          ↓
 *   SYSTEM Default
 *          ↓
 *   null
 *
 * GET /system-settings/:key/effective
 * ============================================================================
 */

async function getEffectiveSetting(
    req,
    res
) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        if (!key) {
            throw createControllerError(
                'System setting key is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const setting =
            await SystemSetting
                .getEffectiveSetting(
                    key,
                    tenantId
                );

        if (!setting) {
            throw createControllerError(
                'Effective system setting was not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        const isTenantOverride =
            setting.tenantId !==
            SYSTEM_TENANT_ID;

        const includeSensitive =
            isPrivilegedSystemActor(req) &&
            parseBoolean(
                req.query?.includeSensitive,
                false
            ) === true;

        return res
            .status(200)
            .json({
                success: true,

                data: serializeSetting(
                    setting,
                    {
                        includeSensitive
                    }
                ),

                resolution: {
                    tenantId,
                    source:
                        isTenantOverride
                            ? 'TENANT_OVERRIDE'
                            : 'SYSTEM_DEFAULT',
                    isTenantOverride
                }
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * GET EFFECTIVE VALUE
 * ============================================================================
 */

async function getEffectiveValue(
    req,
    res
) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        if (!key) {
            throw createControllerError(
                'System setting key is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const fallback =
            req.query?.fallback !== undefined
                ? req.query.fallback
                : null;

        const value =
            await SystemSetting
                .getEffectiveValue(
                    key,
                    tenantId,
                    fallback
                );

        return res
            .status(200)
            .json({
                success: true,
                data: {
                    key,
                    tenantId,
                    value
                }
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * LIST SETTINGS
 * ============================================================================
 *
 * GET /system-settings
 *
 * Supported:
 *
 *   tenantId
 *   category
 *   enabled
 *   complianceRelevant
 *   regulatoryCritical
 *   page
 *   limit
 *   search
 * ============================================================================
 */

async function listSettings(req, res) {
    try {
        const query =
            getQuery(req);

        const tenantId =
            resolveTenantId(
                req,
                query.tenantId
            );

        const page =
            parsePositiveInteger(
                query.page,
                DEFAULT_PAGE
            );

        const limit =
            parsePositiveInteger(
                query.limit,
                DEFAULT_LIMIT,
                MAX_LIMIT
            );

        const filter = {
            tenantId
        };

        if (query.category) {
            filter.category =
                String(query.category)
                    .trim()
                    .toUpperCase();
        }

        const enabled =
            parseBoolean(
                query.enabled
            );

        if (enabled !== undefined) {
            filter.enabled =
                enabled;
        }

        const complianceRelevant =
            parseBoolean(
                query.complianceRelevant
            );

        if (
            complianceRelevant !==
            undefined
        ) {
            filter.complianceRelevant =
                complianceRelevant;
        }

        const regulatoryCritical =
            parseBoolean(
                query.regulatoryCritical
            );

        if (
            regulatoryCritical !==
            undefined
        ) {
            filter.regulatoryCritical =
                regulatoryCritical;
        }

        if (query.search) {
            const escaped =
                String(query.search)
                    .trim()
                    .replace(
                        /[.*+?^${}()|[\]\\]/g,
                        '\\$&'
                    );

            if (escaped) {
                filter.$or = [
                    {
                        key: {
                            $regex:
                                escaped,
                            $options: 'i'
                        }
                    },
                    {
                        name: {
                            $regex:
                                escaped,
                            $options: 'i'
                        }
                    },
                    {
                        description: {
                            $regex:
                                escaped,
                            $options: 'i'
                        }
                    }
                ];
            }
        }

        const skip =
            (page - 1) * limit;

        const [
            settings,
            total
        ] = await Promise.all([
            SystemSetting
                .find(filter)
                .sort({
                    category: 1,
                    key: 1
                })
                .skip(skip)
                .limit(limit)
                .lean(),

            SystemSetting
                .countDocuments(filter)
        ]);

        const includeSensitive =
            isPrivilegedSystemActor(req) &&
            parseBoolean(
                query.includeSensitive,
                false
            ) === true;

        const data =
            settings.map(
                (setting) =>
                    serializeSetting(
                        setting,
                        {
                            includeSensitive
                        }
                    )
            );

        const totalPages =
            total === 0
                ? 0
                : Math.ceil(
                    total / limit
                );

        return res
            .status(200)
            .json({
                success: true,

                data,

                pagination: {
                    page,
                    limit,
                    total,
                    totalPages,
                    hasNextPage:
                        page <
                        totalPages,
                    hasPreviousPage:
                        page > 1
                }
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * LIST CATEGORY
 * ============================================================================
 */

async function listCategory(
    req,
    res
) {
    try {
        const category =
            String(
                req.params?.category || ''
            )
                .trim()
                .toUpperCase();

        if (!category) {
            throw createControllerError(
                'Setting category is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const settings =
            await SystemSetting
                .find({
                    tenantId,
                    category,
                    enabled: true
                })
                .sort({
                    key: 1
                })
                .lean();

        const includeSensitive =
            isPrivilegedSystemActor(req) &&
            parseBoolean(
                req.query?.includeSensitive,
                false
            ) === true;

        return res
            .status(200)
            .json({
                success: true,

                data:
                    settings.map(
                        (setting) =>
                            serializeSetting(
                                setting,
                                {
                                    includeSensitive
                                }
                            )
                    )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * CREATE / UPDATE VALUE
 * ============================================================================
 *
 * PUT /system-settings/:key/value
 *
 * This is the preferred endpoint for atomic configuration value updates.
 * ============================================================================
 */

async function setValue(
    req,
    res
) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        if (!key) {
            throw createControllerError(
                'System setting key is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const body =
            getBody(req);

        const tenantId =
            resolveTenantId(
                req,
                body.tenantId ||
                    req.query?.tenantId
            );

        const existing =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                })
                .select(
                    'editable isSystem version value valueType'
                );

        assertCanMutateSetting(
            req,
            existing,
            tenantId
        );

        if (
            !Object.prototype.hasOwnProperty.call(
                body,
                'value'
            )
        ) {
            throw createControllerError(
                'value is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const expectedVersion =
            parseExpectedVersion(
                body.expectedVersion ??
                    req.headers?.[
                        'if-match-version'
                    ]
            );

        const userId =
            getAuthenticatedUserId(req);

        const options = {
            expectedVersion,

            requestId:
                getRequestId(req),

            source:
                body.source ||
                req.headers?.[
                    'x-setting-source'
                ] ||
                'api',

            category:
                body.category,

            enabled:
                body.enabled,

            editable:
                body.editable,

            complianceRelevant:
                body.complianceRelevant,

            regulatoryCritical:
                body.regulatoryCritical,

            valueType:
                body.valueType,

            auditDetails:
                body.auditDetails,

            allowProtectedUpdate:
                isPrivilegedSystemActor(req)
        };

        const setting =
            await SystemSetting
                .setValue(
                    key,
                    body.value,
                    tenantId,
                    userId,
                    options
                );

        return res
            .status(
                existing
                    ? 200
                    : 201
            )
            .json({
                success: true,

                data:
                    serializeSetting(
                        setting
                    )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * UPDATE SETTING
 * ============================================================================
 *
 * PATCH /system-settings/:key
 * ============================================================================
 */

async function updateSetting(
    req,
    res
) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        if (!key) {
            throw createControllerError(
                'System setting key is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        const body =
            getBody(req);

        const tenantId =
            resolveTenantId(
                req,
                body.tenantId ||
                    req.query?.tenantId
            );

        const setting =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                });

        if (!setting) {
            throw createControllerError(
                'System setting not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        assertCanMutateSetting(
            req,
            setting,
            tenantId
        );

        const updates =
            sanitizeUpdatePayload(
                req
            );

        if (
            Object.keys(updates)
                .length === 0
        ) {
            throw createControllerError(
                'No mutable setting fields were supplied.',
                'VALIDATION_ERROR',
                400
            );
        }

        const expectedVersion =
            parseExpectedVersion(
                body.expectedVersion ??
                    req.headers?.[
                        'if-match-version'
                    ]
            );

        const updated =
            await SystemSetting
                .updateSetting(
                    key,
                    updates,
                    tenantId,
                    getAuthenticatedUserId(
                        req
                    ),
                    {
                        expectedVersion,

                        requestId:
                            getRequestId(req),

                        source:
                            body.source ||
                            'api',

                        auditDetails:
                            body.auditDetails,

                        allowProtectedUpdate:
                            isPrivilegedSystemActor(
                                req
                            )
                    }
                );

        return res
            .status(200)
            .json({
                success: true,

                data:
                    serializeSetting(
                        updated
                    )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * ENABLE SETTING
 * ============================================================================
 *
 * POST /system-settings/:key/enable
 * ============================================================================
 */

async function enableSetting(
    req,
    res
) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        const tenantId =
            resolveTenantId(
                req,
                req.body?.tenantId ||
                    req.query?.tenantId
            );

        const setting =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                });

        if (!setting) {
            throw createControllerError(
                'System setting not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        assertCanMutateSetting(
            req,
            setting,
            tenantId
        );

        const expectedVersion =
            parseExpectedVersion(
                req.body?.expectedVersion ??
                    req.headers?.[
                        'if-match-version'
                    ]
            );

        if (
            expectedVersion !==
            undefined &&
            setting.version !==
                expectedVersion
        ) {
            throw createControllerError(
                'System setting version conflict.',
                'SYSTEM_SETTING_VERSION_CONFLICT',
                409
            );
        }

        await setting.enable(
            getAuthenticatedUserId(
                req
            ),
            {
                requestId:
                    getRequestId(req),

                source:
                    req.body?.source ||
                    'api',

                allowProtectedUpdate:
                    isPrivilegedSystemActor(
                        req
                    )
            }
        );

        return res
            .status(200)
            .json({
                success: true,

                data:
                    serializeSetting(
                        setting
                    )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * DISABLE SETTING
 * ============================================================================
 *
 * POST /system-settings/:key/disable
 * ============================================================================
 */

async function disableSetting(
    req,
    res
) {
    try {
        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        const tenantId =
            resolveTenantId(
                req,
                req.body?.tenantId ||
                    req.query?.tenantId
            );

        const setting =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                });

        if (!setting) {
            throw createControllerError(
                'System setting not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        assertCanMutateSetting(
            req,
            setting,
            tenantId
        );

        const expectedVersion =
            parseExpectedVersion(
                req.body?.expectedVersion ??
                    req.headers?.[
                        'if-match-version'
                    ]
            );

        if (
            expectedVersion !==
            undefined &&
            setting.version !==
                expectedVersion
        ) {
            throw createControllerError(
                'System setting version conflict.',
                'SYSTEM_SETTING_VERSION_CONFLICT',
                409
            );
        }

        await setting.disable(
            getAuthenticatedUserId(
                req
            ),
            {
                requestId:
                    getRequestId(req),

                source:
                    req.body?.source ||
                    'api',

                allowProtectedUpdate:
                    isPrivilegedSystemActor(
                        req
                    )
            }
        );

        return res
            .status(200)
            .json({
                success: true,

                data:
                    serializeSetting(
                        setting
                    )
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * DISABLE TENANT OVERRIDE
 * ============================================================================
 *
 * POST /system-settings/:key/reset
 *
 * The tenant override is retained for audit/history but disabled so that the
 * effective resolver falls back to the SYSTEM value.
 * ============================================================================
 */

async function resetTenantOverride(
    req,
    res
) {
    try {
        const tenantId =
            resolveTenantId(
                req,
                req.body?.tenantId ||
                    req.query?.tenantId
            );

        if (
            tenantId ===
            SYSTEM_TENANT_ID
        ) {
            throw createControllerError(
                'SYSTEM settings cannot be reset as tenant overrides.',
                'SYSTEM_SETTING_SYSTEM_SCOPE_FORBIDDEN',
                400
            );
        }

        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        const existing =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                });

        if (!existing) {
            throw createControllerError(
                'Tenant setting override not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        assertCanMutateSetting(
            req,
            existing,
            tenantId
        );

        const expectedVersion =
            parseExpectedVersion(
                req.body?.expectedVersion ??
                    req.headers?.[
                        'if-match-version'
                    ]
            );

        if (
            expectedVersion !==
                undefined &&
            existing.version !==
                expectedVersion
        ) {
            throw createControllerError(
                'System setting version conflict.',
                'SYSTEM_SETTING_VERSION_CONFLICT',
                409
            );
        }

        const updated =
            await SystemSetting
                .disableTenantOverride(
                    key,
                    tenantId,
                    getAuthenticatedUserId(
                        req
                    ),
                    {
                        requestId:
                            getRequestId(req),

                        source:
                            req.body?.source ||
                            'api'
                    }
                );

        if (!updated) {
            throw createControllerError(
                'Tenant override could not be reset.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        return res
            .status(200)
            .json({
                success: true,

                data:
                    serializeSetting(
                        updated
                    ),

                resolution: {
                    tenantId,
                    fallback:
                        'SYSTEM_DEFAULT'
                }
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * HEALTH SUMMARY
 * ============================================================================
 */

async function getHealthSummary(
    req,
    res
) {
    try {
        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const summary =
            await SystemSetting
                .getHealthSummary(
                    tenantId
                );

        return res
            .status(200)
            .json({
                success: true,
                data: summary
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * AUDIT HISTORY
 * ============================================================================
 *
 * GET /system-settings/:key/audit
 *
 * Audit history is deliberately exposed separately from the ordinary setting
 * representation.
 * ============================================================================
 */

async function getAuditHistory(
    req,
    res
) {
    try {
        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const key =
            SystemSetting.normalizeKey(
                req.params?.key
            );

        const setting =
            await SystemSetting
                .findOne({
                    tenantId,
                    key
                })
                .select(
                    'tenantId key version auditLog'
                )
                .lean();

        if (!setting) {
            throw createControllerError(
                'System setting not found.',
                'SETTING_NOT_FOUND',
                404
            );
        }

        const limit =
            parsePositiveInteger(
                req.query?.limit,
                DEFAULT_AUDIT_LIMIT,
                DEFAULT_AUDIT_LIMIT
            );

        const auditLog =
            Array.isArray(
                setting.auditLog
            )
                ? setting.auditLog
                    .slice(-limit)
                    .reverse()
                : [];

        return res
            .status(200)
            .json({
                success: true,

                data: {
                    tenantId:
                        setting.tenantId,

                    key:
                        setting.key,

                    currentVersion:
                        setting.version,

                    auditLog
                }
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * BULK EFFECTIVE SETTINGS
 * ============================================================================
 *
 * GET /system-settings/effective
 *
 * Returns the effective tenant configuration for a requested set of keys.
 *
 * Query:
 *
 *   ?keys=AML_ENABLED,KYC_REQUIRED,...
 * ============================================================================
 */

async function getEffectiveSettings(
    req,
    res
) {
    try {
        const tenantId =
            resolveTenantId(
                req,
                req.query?.tenantId
            );

        const rawKeys =
            String(
                req.query?.keys || ''
            )
                .split(',')
                .map((key) =>
                    SystemSetting
                        .normalizeKey(
                            key
                        )
                )
                .filter(Boolean);

        const keys = [
            ...new Set(
                rawKeys
            )
        ];

        if (keys.length === 0) {
            throw createControllerError(
                'At least one setting key is required.',
                'VALIDATION_ERROR',
                400
            );
        }

        if (keys.length > 100) {
            throw createControllerError(
                'A maximum of 100 setting keys may be requested at once.',
                'VALIDATION_ERROR',
                400
            );
        }

        const settings =
            await SystemSetting
                .find({
                    tenantId: {
                        $in: [
                            tenantId,
                            SYSTEM_TENANT_ID
                        ]
                    },
                    key: {
                        $in: keys
                    },
                    enabled: true
                })
                .sort({
                    tenantId: 1,
                    key: 1
                })
                .lean();

        const byKey =
            new Map();

        for (
            const setting of settings
        ) {
            const existing =
                byKey.get(
                    setting.key
                );

            /**
             * Tenant setting takes precedence over SYSTEM.
             */
            if (
                !existing ||
                (
                    setting.tenantId ===
                    tenantId &&
                    tenantId !==
                    SYSTEM_TENANT_ID
                )
            ) {
                byKey.set(
                    setting.key,
                    setting
                );
            }
        }

        const includeSensitive =
            isPrivilegedSystemActor(req) &&
            parseBoolean(
                req.query?.includeSensitive,
                false
            ) === true;

        const data = {};

        for (
            const key of keys
        ) {
            const setting =
                byKey.get(key);

            data[key] =
                setting
                    ? serializeSetting(
                        setting,
                        {
                            includeSensitive
                        }
                    )
                    : null;
        }

        return res
            .status(200)
            .json({
                success: true,

                tenantId,

                data
            });
    } catch (error) {
        return sendControllerError(
            res,
            error,
            500
        );
    }
}

/**
 * ============================================================================
 * DELETE SETTING
 * ============================================================================
 *
 * Deliberately disabled as a standard API operation.
 *
 * Configuration is audit-sensitive state. Physical deletion should be handled
 * by a dedicated privileged lifecycle service with explicit retention policy.
 * ============================================================================
 */

async function deleteSetting(
    req,
    res
) {
    return sendControllerError(
        res,
        createControllerError(
            'System settings cannot be physically deleted through the standard API. Disable or retire the setting instead.',
            'SYSTEM_SETTING_DELETE_FORBIDDEN',
            405
        )
    );
}

/**
 * ============================================================================
 * CONTROLLER EXPORTS
 * ============================================================================
 */

module.exports = {
    createSetting,

    getSetting,

    getEffectiveSetting,

    getEffectiveValue,

    getEffectiveSettings,

    listSettings,

    listCategory,

    setValue,

    updateSetting,

    enableSetting,

    disableSetting,

    resetTenantOverride,

    getHealthSummary,

    getAuditHistory,

    deleteSetting
};