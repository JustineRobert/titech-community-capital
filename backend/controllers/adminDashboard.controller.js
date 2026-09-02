"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Administrative Dashboard HTTP Controller
 * =============================================================================
 *
 * File:
 *   backend/controllers/adminDashboard.controller.js
 *
 * Purpose:
 *   Enterprise HTTP boundary for administrative and executive dashboard APIs.
 *
 * Architecture:
 * -----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        |
 *        v
 *   Route / Middleware
 *        |
 *        v
 *   adminDashboard.controller.js
 *        |
 *        v
 *   adminDashboard.service.js
 *        |
 *        +---- repositories
 *        +---- financial services
 *        +---- risk services
 *        +---- compliance services
 *        +---- observability
 *
 * Controller responsibilities:
 *   - Validate the HTTP request boundary.
 *   - Resolve authenticated principal.
 *   - Resolve tenant context.
 *   - Resolve dashboard service.
 *   - Delegate business/read-model work.
 *   - Produce consistent HTTP responses.
 *   - Preserve request/correlation metadata.
 *   - Never perform financial calculations directly.
 *   - Never query MongoDB directly.
 *   - Never mutate financial records.
 *   - Never bypass tenant isolation.
 *
 * Non-responsibilities:
 *   - MongoDB aggregation.
 *   - Financial calculations.
 *   - Portfolio/risk calculations.
 *   - Regulatory decisions.
 *   - Tenant discovery from arbitrary request parameters.
 *   - Authorization policy implementation.
 *   - Database transactions.
 *   - Cache implementation.
 *
 * Enterprise characteristics:
 *   - Multi-tenant safe.
 *   - Fail-closed tenant resolution.
 *   - Service dependency injection compatible.
 *   - Bootstrap/ServicesContext compatible.
 *   - Correlation/request ID propagation.
 *   - Safe error normalization.
 *   - Bounded pagination.
 *   - Bounded date ranges.
 *   - No sensitive error leakage.
 *   - Backward-compatible service method resolution.
 *   - Read-only dashboard boundary.
 *
 * IMPORTANT:
 *   This controller intentionally contains no ACFOS naming.
 *
 * =============================================================================
 */

const CONTROLLER_NAME = "adminDashboard.controller";

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;

const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 365;

const DEFAULT_PERIOD_DAYS = 30;
const MAX_PERIOD_DAYS = 366;

const DEFAULT_CURRENCY = "UGX";

const HTTP_STATUS = Object.freeze({
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    SERVICE_UNAVAILABLE: 503
});

const ERROR_CODES = Object.freeze({
    INVALID_REQUEST: "ADMIN_DASHBOARD_INVALID_REQUEST",
    UNAUTHENTICATED: "ADMIN_DASHBOARD_UNAUTHENTICATED",
    TENANT_REQUIRED: "ADMIN_DASHBOARD_TENANT_REQUIRED",
    TENANT_MISMATCH: "ADMIN_DASHBOARD_TENANT_MISMATCH",
    FORBIDDEN: "ADMIN_DASHBOARD_FORBIDDEN",
    SERVICE_UNAVAILABLE: "ADMIN_DASHBOARD_SERVICE_UNAVAILABLE",
    NOT_FOUND: "ADMIN_DASHBOARD_NOT_FOUND",
    INTERNAL_ERROR: "ADMIN_DASHBOARD_INTERNAL_ERROR"
});

const SERVICE_NAMES = Object.freeze([
    "adminDashboardService",
    "adminDashboard",
    "dashboardService"
]);

const METHOD_ALIASES = Object.freeze({
    overview: [
        "getOverview",
        "getDashboardOverview",
        "getAdminDashboard",
        "getDashboard"
    ],

    metrics: [
        "getMetrics",
        "getDashboardMetrics",
        "getAdminMetrics"
    ],

    portfolio: [
        "getPortfolio",
        "getPortfolioSummary",
        "getLoanPortfolio"
    ],

    risk: [
        "getRisk",
        "getRiskMetrics",
        "getDashboardRisk"
    ],

    trends: [
        "getTrends",
        "getDashboardTrends",
        "getAnalytics",
        "getDashboardAnalytics"
    ],

    executive: [
        "getExecutiveSummary",
        "getExecutiveDashboard",
        "getBoardSummary"
    ],

    health: [
        "getSystemHealth",
        "getDashboardHealth",
        "getOperationalHealth"
    ],

    activities: [
        "getRecentActivities",
        "getActivities",
        "getDashboardActivities"
    ]
});

/* =============================================================================
 * Generic helpers
 * ============================================================================= */

/**
 * Determine whether a value is a callable function.
 *
 * @param {*} value
 * @returns {boolean}
 */
function isFunction(value) {
    return typeof value === "function";
}

/**
 * Return the first non-null/non-undefined value.
 *
 * @param  {...any} values
 * @returns {*}
 */
function firstDefined(...values) {
    for (const value of values) {
        if (value !== undefined && value !== null) {
            return value;
        }
    }

    return undefined;
}

/**
 * Normalize a potentially unsafe string.
 *
 * @param {*} value
 * @param {string|null} fallback
 * @returns {string|null}
 */
function normalizeString(value, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized.length > 0
        ? normalized
        : fallback;
}

/**
 * Normalize positive integer values.
 *
 * @param {*} value
 * @param {number} fallback
 * @param {number} maximum
 * @returns {number}
 */
function normalizePositiveInteger(
    value,
    fallback,
    maximum
) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
        return fallback;
    }

    const integer = Math.floor(numeric);

    if (integer < 1) {
        return fallback;
    }

    return Math.min(integer, maximum);
}

/**
 * Safely normalize a date.
 *
 * @param {*} value
 * @returns {Date|null}
 */
function normalizeDate(value) {
    if (!value) {
        return null;
    }

    const date = value instanceof Date
        ? value
        : new Date(value);

    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

/**
 * Build a bounded dashboard period.
 *
 * @param {object} query
 * @returns {{from: Date, to: Date, days: number}}
 */
function normalizePeriod(query = {}) {
    const now = new Date();

    const explicitFrom = normalizeDate(
        firstDefined(
            query.from,
            query.startDate,
            query.start
        )
    );

    const explicitTo = normalizeDate(
        firstDefined(
            query.to,
            query.endDate,
            query.end
        )
    );

    if (explicitFrom && explicitTo) {
        if (explicitFrom > explicitTo) {
            const error = new Error(
                "The dashboard period start date cannot be after the end date."
            );

            error.code = ERROR_CODES.INVALID_REQUEST;

            throw error;
        }

        const difference =
            explicitTo.getTime() -
            explicitFrom.getTime();

        const days = Math.ceil(
            difference / 86400000
        );

        if (days > MAX_PERIOD_DAYS) {
            const error = new Error(
                `Dashboard date range cannot exceed ${MAX_PERIOD_DAYS} days.`
            );

            error.code = ERROR_CODES.INVALID_REQUEST;

            throw error;
        }

        return {
            from: explicitFrom,
            to: explicitTo,
            days: Math.max(days, 1)
        };
    }

    const requestedDays = normalizePositiveInteger(
        firstDefined(
            query.days,
            query.periodDays,
            query.range
        ),
        DEFAULT_PERIOD_DAYS,
        MAX_PERIOD_DAYS
    );

    const from = new Date(now);

    from.setDate(
        from.getDate() -
        (requestedDays - 1)
    );

    return {
        from,
        to: now,
        days: requestedDays
    };
}

/**
 * Normalize pagination.
 *
 * @param {object} query
 * @returns {{page: number, limit: number, skip: number}}
 */
function normalizePagination(query = {}) {
    const page = normalizePositiveInteger(
        query.page,
        DEFAULT_PAGE,
        Number.MAX_SAFE_INTEGER
    );

    const limit = normalizePositiveInteger(
        firstDefined(
            query.limit,
            query.pageSize,
            query.perPage
        ),
        DEFAULT_PAGE_SIZE,
        MAX_PAGE_SIZE
    );

    return {
        page,
        limit,
        skip: (page - 1) * limit
    };
}

/**
 * Normalize history limit.
 *
 * @param {object} query
 * @returns {number}
 */
function normalizeHistoryLimit(query = {}) {
    return normalizePositiveInteger(
        firstDefined(
            query.limit,
            query.historyLimit
        ),
        DEFAULT_HISTORY_LIMIT,
        MAX_HISTORY_LIMIT
    );
}

/* =============================================================================
 * Request context
 * ============================================================================= */

/**
 * Resolve authenticated principal.
 *
 * The controller deliberately supports the common authentication shapes used
 * by Express middleware without coupling itself to a particular auth module.
 *
 * @param {object} req
 * @returns {object|null}
 */
function resolvePrincipal(req) {
    if (!req) {
        return null;
    }

    return firstDefined(
        req.user,
        req.auth?.user,
        req.auth?.principal,
        req.principal,
        null
    );
}

/**
 * Resolve tenant from trusted request context.
 *
 * Tenant IDs supplied through arbitrary query/body fields are intentionally not
 * trusted as authorization context.
 *
 * @param {object} req
 * @returns {string|null}
 */
function resolveTenantId(req) {
    const principal = resolvePrincipal(req);

    const tenantId = firstDefined(
        req?.tenantId,
        req?.tenant?.id,
        req?.tenant?._id,
        req?.context?.tenantId,
        req?.requestContext?.tenantId,
        req?.auth?.tenantId,
        principal?.tenantId,
        principal?.tenant?.id,
        principal?.tenant?._id
    );

    return normalizeString(
        tenantId,
        null
    );
}

/**
 * Resolve request ID.
 *
 * @param {object} req
 * @returns {string|null}
 */
function resolveRequestId(req) {
    return normalizeString(
        firstDefined(
            req?.requestId,
            req?.id,
            req?.context?.requestId
        ),
        null
    );
}

/**
 * Resolve correlation ID.
 *
 * @param {object} req
 * @returns {string|null}
 */
function resolveCorrelationId(req) {
    return normalizeString(
        firstDefined(
            req?.correlationId,
            req?.context?.correlationId,
            req?.requestContext?.correlationId
        ),
        resolveRequestId(req)
    );
}

/**
 * Construct the safe service context.
 *
 * @param {object} req
 * @param {object} options
 * @returns {object}
 */
function buildRequestContext(req, options = {}) {
    const principal = resolvePrincipal(req);
    const tenantId = resolveTenantId(req);

    return {
        request: req,

        requestId:
            resolveRequestId(req),

        correlationId:
            resolveCorrelationId(req),

        tenantId,

        user: principal,

        actor: principal,

        operation:
            options.operation ||
            null,

        currency:
            normalizeString(
                options.currency,
                DEFAULT_CURRENCY
            ),

        period:
            options.period ||
            null,

        pagination:
            options.pagination ||
            null
    };
}

/* =============================================================================
 * Dependency resolution
 * ============================================================================= */

/**
 * Resolve the TITech services context from the request.
 *
 * @param {object} req
 * @returns {object|null}
 */
function resolveServicesContext(req) {
    return firstDefined(
        req?.servicesContext,
        req?.serviceContext,
        req?.context?.services,
        req?.services,
        req?.container,
        req?.app?.locals?.servicesContext,
        req?.app?.locals?.services,
        null
    );
}

/**
 * Resolve the dashboard service.
 *
 * Supports the current service-context architecture as well as conventional
 * Express dependency injection.
 *
 * @param {object} req
 * @returns {object|null}
 */
function resolveDashboardService(req) {
    const servicesContext =
        resolveServicesContext(req);

    if (servicesContext) {
        for (const name of SERVICE_NAMES) {
            try {
                if (
                    isFunction(
                        servicesContext.requireService
                    )
                ) {
                    const service =
                        servicesContext.requireService(
                            name
                        );

                    if (service) {
                        return service;
                    }
                }
            } catch (_error) {
                // Try the next supported service name.
            }

            try {
                if (
                    isFunction(
                        servicesContext.service
                    )
                ) {
                    const service =
                        servicesContext.service(
                            name
                        );

                    if (service) {
                        return service;
                    }
                }
            } catch (_error) {
                // Try the next supported service name.
            }

            try {
                if (
                    isFunction(
                        servicesContext.get
                    )
                ) {
                    const service =
                        servicesContext.get(
                            name
                        );

                    if (service) {
                        return service;
                    }
                }
            } catch (_error) {
                // Try the next supported service name.
            }

            if (
                servicesContext[name]
            ) {
                return servicesContext[name];
            }
        }
    }

    const locals =
        req?.app?.locals;

    if (locals) {
        for (const name of SERVICE_NAMES) {
            if (locals[name]) {
                return locals[name];
            }
        }
    }

    for (const name of SERVICE_NAMES) {
        if (req?.[name]) {
            return req[name];
        }
    }

    return null;
}

/**
 * Resolve a service method from an alias list.
 *
 * @param {object} service
 * @param {string} operation
 * @returns {Function|null}
 */
function resolveServiceMethod(
    service,
    operation
) {
    if (!service) {
        return null;
    }

    const aliases =
        METHOD_ALIASES[operation] ||
        [];

    for (const methodName of aliases) {
        if (
            isFunction(
                service[methodName]
            )
        ) {
            return service[methodName].bind(
                service
            );
        }
    }

    return null;
}

/* =============================================================================
 * Authorization boundary
 * ============================================================================= */

/**
 * Determine whether the authenticated principal has an administrative role.
 *
 * This is deliberately a defensive boundary only. Route-level authorization
 * middleware remains the preferred policy authority.
 *
 * @param {object|null} principal
 * @returns {boolean}
 */
function hasAdministrativeRole(principal) {
    if (!principal) {
        return false;
    }

    const roleValues = [];

    if (principal.role) {
        roleValues.push(
            principal.role
        );
    }

    if (Array.isArray(principal.roles)) {
        roleValues.push(
            ...principal.roles
        );
    }

    const normalizedRoles =
        roleValues
            .filter(Boolean)
            .map(role =>
                String(role)
                    .trim()
                    .toLowerCase()
            );

    return normalizedRoles.some(
        role =>
            role === "admin" ||
            role === "administrator" ||
            role === "superadmin" ||
            role === "super_admin" ||
            role === "tenant_admin" ||
            role === "manager"
    );
}

/**
 * Determine whether the authenticated principal has a dashboard permission.
 *
 * @param {object|null} principal
 * @returns {boolean}
 */
function hasDashboardPermission(principal) {
    if (!principal) {
        return false;
    }

    const permissions = Array.isArray(
        principal.permissions
    )
        ? principal.permissions
        : [];

    const normalized =
        permissions
            .filter(Boolean)
            .map(permission =>
                String(permission)
                    .trim()
                    .toLowerCase()
            );

    return normalized.some(
        permission =>
            permission === "admin.dashboard.read" ||
            permission === "dashboard.admin.read" ||
            permission === "dashboard.read" ||
            permission === "*"
    );
}

/**
 * Validate the HTTP authorization boundary.
 *
 * Route middleware should normally have already enforced authorization.
 * This second boundary prevents accidental exposure if the controller is
 * mounted incorrectly.
 *
 * @param {object} req
 */
function assertAuthorized(req) {
    const principal =
        resolvePrincipal(req);

    if (!principal) {
        const error = new Error(
            "Authentication is required."
        );

        error.statusCode =
            HTTP_STATUS.UNAUTHORIZED;

        error.code =
            ERROR_CODES.UNAUTHENTICATED;

        throw error;
    }

    if (
        hasAdministrativeRole(principal) ||
        hasDashboardPermission(principal)
    ) {
        return true;
    }

    /*
     * Some projects use route-level authorization middleware and expose a
     * trusted authorization decision on the request. Respect it when present.
     */
    if (
        req?.authorization?.allowed === true ||
        req?.authz?.allowed === true ||
        req?.permissionGranted === true
    ) {
        return true;
    }

    const error = new Error(
        "You do not have permission to access the administrative dashboard."
    );

    error.statusCode =
        HTTP_STATUS.FORBIDDEN;

    error.code =
        ERROR_CODES.FORBIDDEN;

    throw error;
}

/**
 * Ensure a tenant context exists.
 *
 * @param {object} req
 */
function assertTenantContext(req) {
    const tenantId =
        resolveTenantId(req);

    if (!tenantId) {
        const error = new Error(
            "A valid tenant context is required."
        );

        error.statusCode =
            HTTP_STATUS.FORBIDDEN;

        error.code =
            ERROR_CODES.TENANT_REQUIRED;

        throw error;
    }

    return tenantId;
}

/* =============================================================================
 * Response helpers
 * ============================================================================= */

/**
 * Send a successful response.
 *
 * @param {object} res
 * @param {*} data
 * @param {object} metadata
 * @param {number} statusCode
 * @returns {object}
 */
function sendSuccess(
    res,
    data,
    metadata = {},
    statusCode = HTTP_STATUS.OK
) {
    return res
        .status(statusCode)
        .json({
            success: true,

            code:
                metadata.code ||
                "ADMIN_DASHBOARD_SUCCESS",

            data,

            meta: {
                requestId:
                    metadata.requestId ??
                    null,

                correlationId:
                    metadata.correlationId ??
                    null,

                tenantId:
                    metadata.tenantId ??
                    null,

                ...(
                    metadata.meta ||
                    {}
                )
            }
        });
}

/**
 * Convert an error into a safe HTTP representation.
 *
 * @param {Error|object} error
 * @returns {{statusCode:number,code:string,message:string}}
 */
function normalizeHttpError(error) {
    const statusCode =
        Number(
            error?.statusCode ||
            error?.status ||
            0
        );

    if (
        statusCode >= 400 &&
        statusCode < 600
    ) {
        return {
            statusCode,
            code:
                error.code ||
                mapStatusToCode(
                    statusCode
                ),
            message:
                statusCode >= 500
                    ? "The dashboard request could not be completed."
                    : (
                        error.message ||
                        "The dashboard request is invalid."
                    )
        };
    }

    if (
        error?.code ===
        ERROR_CODES.INVALID_REQUEST
    ) {
        return {
            statusCode:
                HTTP_STATUS.BAD_REQUEST,

            code:
                ERROR_CODES.INVALID_REQUEST,

            message:
                error.message ||
                "The dashboard request is invalid."
        };
    }

    if (
        error?.code ===
        ERROR_CODES.TENANT_REQUIRED
    ) {
        return {
            statusCode:
                HTTP_STATUS.FORBIDDEN,

            code:
                ERROR_CODES.TENANT_REQUIRED,

            message:
                "A valid tenant context is required."
        };
    }

    if (
        error?.code ===
        ERROR_CODES.TENANT_MISMATCH
    ) {
        return {
            statusCode:
                HTTP_STATUS.FORBIDDEN,

            code:
                ERROR_CODES.TENANT_MISMATCH,

            message:
                "The requested tenant is not available in the current security context."
        };
    }

    return {
        statusCode:
            HTTP_STATUS.INTERNAL_SERVER_ERROR,

        code:
            ERROR_CODES.INTERNAL_ERROR,

        message:
            "The dashboard request could not be completed."
    };
}

/**
 * Map HTTP status to a stable application code.
 *
 * @param {number} statusCode
 * @returns {string}
 */
function mapStatusToCode(statusCode) {
    switch (statusCode) {
        case HTTP_STATUS.UNAUTHORIZED:
            return ERROR_CODES.UNAUTHENTICATED;

        case HTTP_STATUS.FORBIDDEN:
            return ERROR_CODES.FORBIDDEN;

        case HTTP_STATUS.NOT_FOUND:
            return ERROR_CODES.NOT_FOUND;

        case HTTP_STATUS.SERVICE_UNAVAILABLE:
            return ERROR_CODES.SERVICE_UNAVAILABLE;

        case HTTP_STATUS.BAD_REQUEST:
        case HTTP_STATUS.UNPROCESSABLE_ENTITY:
            return ERROR_CODES.INVALID_REQUEST;

        default:
            return ERROR_CODES.INTERNAL_ERROR;
    }
}

/**
 * Log an error without leaking sensitive request information.
 *
 * @param {object} req
 * @param {Error|object} error
 * @param {string} operation
 */
function logControllerError(
    req,
    error,
    operation
) {
    const logger =
        firstDefined(
            req?.logger,
            req?.servicesContext?.logger,
            req?.app?.locals?.logger
        );

    const payload = {
        controller:
            CONTROLLER_NAME,

        operation,

        requestId:
            resolveRequestId(req),

        correlationId:
            resolveCorrelationId(req),

        tenantId:
            resolveTenantId(req),

        error: {
            name:
                error?.name ||
                "Error",

            code:
                error?.code ||
                null,

            message:
                error?.message ||
                "Unknown dashboard error",

            statusCode:
                error?.statusCode ||
                error?.status ||
                null
        }
    };

    if (
        logger &&
        isFunction(
            logger.error
        )
    ) {
        logger.error(
            payload
        );

        return;
    }

    if (
        process.env.NODE_ENV !==
        "production"
    ) {
        // eslint-disable-next-line no-console
        console.error(
            `[${CONTROLLER_NAME}]`,
            payload
        );
    }
}

/**
 * Send a safe controller error.
 *
 * @param {object} req
 * @param {object} res
 * @param {Error|object} error
 * @param {string} operation
 * @returns {object}
 */
function sendError(
    req,
    res,
    error,
    operation
) {
    logControllerError(
        req,
        error,
        operation
    );

    const normalized =
        normalizeHttpError(
            error
        );

    return res
        .status(
            normalized.statusCode
        )
        .json({
            success: false,

            code:
                normalized.code,

            message:
                normalized.message,

            requestId:
                resolveRequestId(req),

            correlationId:
                resolveCorrelationId(req)
        });
}

/* =============================================================================
 * Service invocation
 * ============================================================================= */

/**
 * Invoke a dashboard service operation.
 *
 * @param {object} req
 * @param {string} operation
 * @param {object} payload
 * @returns {Promise<*>}
 */
async function invoke(
    req,
    operation,
    payload
) {
    const service =
        resolveDashboardService(
            req
        );

    if (!service) {
        const error = new Error(
            "The administrative dashboard service is unavailable."
        );

        error.statusCode =
            HTTP_STATUS.SERVICE_UNAVAILABLE;

        error.code =
            ERROR_CODES.SERVICE_UNAVAILABLE;

        throw error;
    }

    const method =
        resolveServiceMethod(
            service,
            operation
        );

    if (!method) {
        const error = new Error(
            `Dashboard service operation "${operation}" is not available.`
        );

        error.statusCode =
            HTTP_STATUS.SERVICE_UNAVAILABLE;

        error.code =
            ERROR_CODES.SERVICE_UNAVAILABLE;

        throw error;
    }

    const servicesContext =
        resolveServicesContext(
            req
        );

    /*
     * Preserve the enterprise ServicesContext where available.
     *
     * Services can therefore use:
     *
     *   context.assertReady()
     *   context.requireService()
     *   context.withRequest()
     *   context.forOperation()
     *   context.withCorrelation()
     *
     * without the controller knowing their infrastructure details.
     */
    let executionContext =
        buildRequestContext(
            req,
            {
                operation:
                    `adminDashboard.${operation}`,

                period:
                    payload.period ||
                    null,

                pagination:
                    payload.pagination ||
                    null
            }
        );

    if (
        servicesContext &&
        isFunction(
            servicesContext.forOperation
        )
    ) {
        executionContext =
            servicesContext.forOperation(
                `adminDashboard.${operation}`,
                {
                    request: req
                }
            );
    }

    if (
        servicesContext &&
        isFunction(
            servicesContext.assertReady
        )
    ) {
        await servicesContext.assertReady(
            `adminDashboard.${operation}`
        );
    }

    /*
     * The canonical service signature is:
     *
     *   serviceMethod(payload, executionContext)
     *
     * The service owns all business logic.
     */
    return method(
        payload,
        executionContext
    );
}

/* =============================================================================
 * Payload builders
 * ============================================================================= */

/**
 * Build common dashboard payload.
 *
 * @param {object} req
 * @returns {object}
 */
function buildDashboardPayload(req) {
    const tenantId =
        assertTenantContext(
            req
        );

    const period =
        normalizePeriod(
            req.query || {}
        );

    const pagination =
        normalizePagination(
            req.query || {}
        );

    return {
        tenantId,

        currency:
            normalizeString(
                req.query?.currency,
                DEFAULT_CURRENCY
            ),

        period,

        pagination,

        filters: {
            groupId:
                normalizeString(
                    req.query?.groupId
                ),

            branchId:
                normalizeString(
                    req.query?.branchId
                ),

            status:
                normalizeString(
                    req.query?.status
                )
        }
    };
}

/* =============================================================================
 * Controller operations
 * ============================================================================= */

/**
 * GET /admin/dashboard
 *
 * Primary administrative dashboard read model.
 */
async function getOverview(
    req,
    res
) {
    const operation =
        "overview";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_OVERVIEW_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/metrics
 */
async function getMetrics(
    req,
    res
) {
    const operation =
        "metrics";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_METRICS_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/portfolio
 */
async function getPortfolio(
    req,
    res
) {
    const operation =
        "portfolio";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_PORTFOLIO_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/risk
 */
async function getRisk(
    req,
    res
) {
    const operation =
        "risk";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_RISK_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/trends
 */
async function getTrends(
    req,
    res
) {
    const operation =
        "trends";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_TRENDS_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/executive
 */
async function getExecutiveSummary(
    req,
    res
) {
    const operation =
        "executive";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_EXECUTIVE_SUMMARY_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/health
 */
async function getHealth(
    req,
    res
) {
    const operation =
        "health";

    try {
        assertAuthorized(
            req
        );

        const payload =
            buildDashboardPayload(
                req
            );

        const result =
            await invoke(
                req,
                operation,
                payload
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_HEALTH_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId:
                    payload.tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/**
 * GET /admin/dashboard/activities
 */
async function getActivities(
    req,
    res
) {
    const operation =
        "activities";

    try {
        assertAuthorized(
            req
        );

        const tenantId =
            assertTenantContext(
                req
            );

        const limit =
            normalizeHistoryLimit(
                req.query || {}
            );

        const result =
            await invoke(
                req,
                operation,
                {
                    tenantId,

                    limit,

                    pagination:
                        normalizePagination(
                            req.query || {}
                        )
                }
            );

        return sendSuccess(
            res,
            result,
            {
                code:
                    "ADMIN_DASHBOARD_ACTIVITIES_RETRIEVED",

                requestId:
                    resolveRequestId(req),

                correlationId:
                    resolveCorrelationId(req),

                tenantId
            }
        );
    } catch (error) {
        return sendError(
            req,
            res,
            error,
            operation
        );
    }
}

/* =============================================================================
 * Aggregate endpoint
 * ============================================================================= */

/**
 * GET /admin/dashboard/summary
 *
 * Compatibility alias for consumers that call "summary" rather than
 * "overview".
 */
async function getSummary(
    req,
    res
) {
    return getOverview(
        req,
        res
    );
}

/**
 * GET /admin/dashboard
 *
 * Canonical dashboard endpoint.
 */
const getAdminDashboard =
    getOverview;

/* =============================================================================
 * Express middleware adapters
 * ============================================================================= */

/**
 * Generic async handler factory.
 *
 * This allows routes to use:
 *
 *   router.get(
 *       "/dashboard",
 *       adminDashboardController.getOverview
 *   );
 *
 * without Express-specific try/catch boilerplate elsewhere.
 *
 * @param {Function} handler
 * @returns {Function}
 */
function createHandler(
    handler
) {
    if (!isFunction(handler)) {
        throw new TypeError(
            "Admin dashboard controller handler must be a function."
        );
    }

    return function controllerHandler(
        req,
        res,
        next
    ) {
        Promise.resolve(
            handler(
                req,
                res
            )
        ).catch(
            error => {
                /*
                 * Handlers already normalize their errors. This fallback is
                 * intentionally defensive for unexpected failures outside the
                 * normal controller execution path.
                 */
                if (
                    res.headersSent
                ) {
                    if (
                        isFunction(next)
                    ) {
                        return next(
                            error
                        );
                    }

                    return undefined;
                }

                return sendError(
                    req,
                    res,
                    error,
                    "unknown"
                );
            }
        );
    };
}

/* =============================================================================
 * Health/readiness metadata
 * ============================================================================= */

/**
 * Controller metadata.
 *
 * @returns {object}
 */
function getControllerMetadata() {
    return Object.freeze({
        name:
            CONTROLLER_NAME,

        application:
            "TITech Community Capital LTD",

        domain:
            "administration",

        resource:
            "dashboard",

        readOnly:
            true,

        multiTenant:
            true,

        financialWrites:
            false,

        requiresAuthentication:
            true,

        serviceDriven:
            true,

        defaultCurrency:
            DEFAULT_CURRENCY,

        pagination: {
            defaultPage:
                DEFAULT_PAGE,

            defaultPageSize:
                DEFAULT_PAGE_SIZE,

            maxPageSize:
                MAX_PAGE_SIZE
        },

        period: {
            defaultDays:
                DEFAULT_PERIOD_DAYS,

            maxDays:
                MAX_PERIOD_DAYS
        }
    });
}

/* =============================================================================
 * Public API
 * ============================================================================= */

const controller = {
    /*
     * Canonical operations
     */
    getOverview:
        createHandler(
            getOverview
        ),

    getAdminDashboard:
        createHandler(
            getAdminDashboard
        ),

    getSummary:
        createHandler(
            getSummary
        ),

    getMetrics:
        createHandler(
            getMetrics
        ),

    getPortfolio:
        createHandler(
            getPortfolio
        ),

    getRisk:
        createHandler(
            getRisk
        ),

    getTrends:
        createHandler(
            getTrends
        ),

    getExecutiveSummary:
        createHandler(
            getExecutiveSummary
        ),

    getHealth:
        createHandler(
            getHealth
        ),

    getActivities:
        createHandler(
            getActivities
        ),

    /*
     * Metadata
     */
    getControllerMetadata
};

module.exports =
    Object.freeze(
        controller
    );