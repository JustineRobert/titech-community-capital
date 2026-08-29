"use strict";

/**

* =============================================================================
* TITech Community Capital LTD
* Enterprise Referral Reward Controller
* =============================================================================
*
* File:
* backend/controllers/referralRewardController.js
*
* Version:
* 2026.2
*
* Purpose:
* Enterprise HTTP/API controller for referral reward lifecycle operations.
*
* Architectural responsibilities:
*
* HTTP Request
* ```
     │
  ```
* ```
     ├── Authenticate
  ```
* ```
     ├── Authorize
  ```
* ```
     ├── Resolve trusted tenant context
  ```
* ```
     ├── Validate request input
  ```
* ```
     ├── Propagate correlation / request / idempotency metadata
  ```
* ```
     │
  ```
* ```
     ▼
  ```
* ReferralRewardService
* ```
     │
  ```
* ```
     ├── ReferralReward persistence
  ```
* ```
     ├── Fraud / Risk
  ```
* ```
     ├── Financial Transaction Service
  ```
* ```
     ├── Ledger
  ```
* ```
     ├── Audit
  ```
* ```
     └── Recovery / Reconciliation
  ```
*
* SECURITY MODEL
* =============================================================================
*
* This controller:
*
* ✓ Never trusts tenantId supplied by a normal client body/query parameter
* ✓ Resolves tenant identity from authenticated server-side context
* ✓ Never directly modifies wallet balances
* ✓ Never performs financial arithmetic
* ✓ Never creates ledger entries directly
* ✓ Propagates Idempotency-Key
* ✓ Propagates correlation/request/trace identifiers
* ✓ Uses consistent HTTP error semantics
* ✓ Prevents sensitive internal errors from leaking to clients
* ✓ Supports dependency injection for enterprise testing
* ✓ Supports Express 4 and Express 5 style async handlers
*
* IMPORTANT
* =============================================================================
*
* The exact authentication middleware may expose tenant/user context using
* different property names depending on the TITech application. The resolver
* below intentionally supports the common conventions:
*
* req.tenantId
* req.tenant?._id
* req.auth.tenantId
* req.auth.tenant?._id
* req.user.tenantId
* req.user.tenant?._id
*
* A client-supplied tenantId is NOT used as an authority when authenticated
* tenant context is available.
*
* =============================================================================
  */

const mongoose =
require("mongoose");

const {
ReferralRewardServiceError,
} =
require("../services/referralRewardService");

/**

* =============================================================================
* CONTROLLER METADATA
* =============================================================================
  */

const CONTROLLER_NAME =
"TITechReferralRewardController";

const CONTROLLER_VERSION =
"2026.2";

const DEFAULT_PAGE =
1;

const DEFAULT_LIMIT =
50;

const MAX_LIMIT =
100;

const MAX_REASON_LENGTH =
500;

const MAX_METADATA_KEYS =
50;

const MAX_TAGS =
50;

/**

* =============================================================================
* GENERIC ERROR CODES
* =============================================================================
  */

const ERROR_CODES =
Object.freeze({
AUTHENTICATION_REQUIRED:
"AUTHENTICATION_REQUIRED",


    TENANT_CONTEXT_REQUIRED:
        "TENANT_CONTEXT_REQUIRED",

    TENANT_CONTEXT_MISMATCH:
        "TENANT_CONTEXT_MISMATCH",

    FORBIDDEN:
        "FORBIDDEN",

    INVALID_REQUEST:
        "INVALID_REQUEST",

    INVALID_IDENTIFIER:
        "INVALID_IDENTIFIER",

    INVALID_PAGINATION:
        "INVALID_PAGINATION",

    INTERNAL_ERROR:
        "INTERNAL_ERROR",

    SERVICE_UNAVAILABLE:
        "SERVICE_UNAVAILABLE",

    IDEMPOTENCY_REQUIRED:
        "IDEMPOTENCY_REQUIRED",
});


/**

* =============================================================================
* SAFE RESPONSE HELPERS
* =============================================================================
  */

function success(
res,
data,
statusCode = 200
) {
return res
.status(statusCode)
.json({
success:
true,


        data,

        meta: {
            controller:
                CONTROLLER_NAME,

            version:
                CONTROLLER_VERSION,
        },
    });


}

function created(
res,
data
) {
return success(
res,
data,
201
);
}

/**

* =============================================================================
* REQUEST METADATA
* =============================================================================
  */

function getHeader(
req,
name
) {
if (
!req ||
!req.headers
) {
return null;
}


const direct =
    req.headers[name];

if (
    direct !== undefined &&
    direct !== null
) {
    return Array.isArray(
        direct
    )
        ? direct[0]
        : String(
            direct
        );
}

const lower =
    String(
        name
    ).toLowerCase();

const value =
    req.headers[lower];

if (
    value === undefined ||
    value === null
) {
    return null;
}

return Array.isArray(
    value
)
    ? value[0]
    : String(
        value
    );


}

function getCorrelationId(
req
) {
return (
getHeader(
req,
"x-correlation-id"
) ||
req?.correlationId ||
req?.requestContext?.correlationId ||
req?.context?.correlationId ||
null
);
}

function getRequestId(
req
) {
return (
getHeader(
req,
"x-request-id"
) ||
req?.requestId ||
req?.requestContext?.requestId ||
req?.context?.requestId ||
null
);
}

function getTraceId(
req
) {
return (
getHeader(
req,
"x-trace-id"
) ||
req?.traceId ||
req?.requestContext?.traceId ||
req?.context?.traceId ||
null
);
}

function getIdempotencyKey(
req
) {
return (
getHeader(
req,
"idempotency-key"
) ||
getHeader(
req,
"x-idempotency-key"
) ||
null
);
}

/**

* =============================================================================
* AUTHENTICATED USER CONTEXT
* =============================================================================
  */

function getAuthenticatedUser(
req
) {
return (
req?.user ||
req?.auth?.user ||
req?.auth ||
null
);
}

/**

* =============================================================================
* TENANT CONTEXT RESOLUTION
* =============================================================================
*
* SECURITY:
*
* tenant identity must originate from trusted authenticated middleware or a
* trusted request context established by the server.
*
* Body/query tenantId is deliberately excluded from this resolver.
* =============================================================================
  */

function resolveTenantId(
req
) {
const candidates = [
req?.tenantId,


    req?.tenant?._id,
    req?.tenant?.id,

    req?.auth?.tenantId,
    req?.auth?.tenant?._id,
    req?.auth?.tenant?.id,

    req?.user?.tenantId,
    req?.user?.tenant?._id,
    req?.user?.tenant?.id,

    req?.requestContext?.tenantId,

    req?.context?.tenantId,
];


const resolved =
    candidates.find(
        (value) =>
            value !== undefined &&
            value !== null &&
            String(
                value
            ).trim()
    );


if (
    !resolved
) {
    throw new ReferralRewardServiceError(
        "Authenticated tenant context is required.",
        ERROR_CODES.TENANT_CONTEXT_REQUIRED,
        401
    );
}


if (
    !mongoose
        .Types
        .ObjectId
        .isValid(
            resolved
        )
) {
    throw new ReferralRewardServiceError(
        "Authenticated tenant context is invalid.",
        ERROR_CODES.TENANT_CONTEXT_REQUIRED,
        401
    );
}


return String(
    resolved
);


}

/**

* =============================================================================
* TENANT SPOOF PROTECTION
* =============================================================================
*
* A supplied tenantId may be accepted only as a consistency assertion.
*
* It can never override the authenticated tenant.
* =============================================================================
  */

function assertTenantConsistency(
req,
tenantId
) {
const supplied =
req?.body?.tenantId ||
req?.query?.tenantId ||
req?.params?.tenantId;

if (
    supplied !== undefined &&
    supplied !== null &&
    String(
        supplied
    ).trim() &&
    String(
        supplied
    ) !== String(
        tenantId
    )
) {
    throw new ReferralRewardServiceError(
        "The supplied tenant context does not match the authenticated tenant.",
        ERROR_CODES.TENANT_CONTEXT_MISMATCH,
        403
    );
}


}

/**

* =============================================================================
* AUTHORIZATION HELPERS
* =============================================================================
  */

function hasPermission(
req,
permission
) {
const user =
getAuthenticatedUser(
req
);


const permissions = [
    ...(Array.isArray(
        user?.permissions
    )
        ? user.permissions
        : []),

    ...(Array.isArray(
        req?.permissions
    )
        ? req.permissions
        : []),

    ...(Array.isArray(
        req?.auth?.permissions
    )
        ? req.auth.permissions
        : []),
]
    .map(
        (value) =>
            String(
                value
            )
    );


return (
    permissions.includes(
        permission
    ) ||
    permissions.includes(
        "*"
    )
);


}

function hasRole(
req,
roles = []
) {
const user =
getAuthenticatedUser(
req
);


const normalizedRoles =
    new Set(
        [
            ...(Array.isArray(
                user?.roles
            )
                ? user.roles
                : []),

            ...(Array.isArray(
                req?.roles
            )
                ? req.roles
                : []),

            ...(Array.isArray(
                req?.auth?.roles
            )
                ? req.auth.roles
                : []),

            user?.role,
            req?.role,
        ]
            .filter(Boolean)
            .map(
                (role) =>
                    String(
                        role
                    ).toUpperCase()
            )
    );


return roles.some(
    (role) =>
        normalizedRoles.has(
            String(
                role
            ).toUpperCase()
        )
);


}

/**

* =============================================================================
* OPTIONAL AUTHORIZATION
* =============================================================================
*
* The application may already enforce authorization in route middleware.
*
* If req.authorize / req.requirePermission has already executed, this
* controller does not duplicate it.
*
* If explicit controller-level permission configuration is supplied, it is
* enforced here.
* =============================================================================
  */

function authorize(
req,
options = {}
) {
if (
typeof req?.authorize ===
"function"
) {
return req.authorize(
options.permission
);
}


if (
    typeof req?.requirePermission ===
    "function"
) {
    return req.requirePermission(
        options.permission
    );
}


if (
    !options.permission &&
    (!Array.isArray(
        options.roles
    ) ||
    options.roles.length === 0)
) {
    return;
}


if (
    options.permission &&
    hasPermission(
        req,
        options.permission
    )
) {
    return;
}


if (
    Array.isArray(
        options.roles
    ) &&
    hasRole(
        req,
        options.roles
    )
) {
    return;
}


/**
 * If authentication context exists but no explicit permission data is
 * available, route-level middleware remains authoritative.
 *
 * This avoids inventing an incompatible RBAC implementation.
 */
if (
    getAuthenticatedUser(
        req
    ) &&
    !req?.authorizationAlreadyChecked &&
    options.strict === true
) {
    throw new ReferralRewardServiceError(
        "You are not authorized to perform this referral reward operation.",
        ERROR_CODES.FORBIDDEN,
        403
    );
}


}

/**

* =============================================================================
* INPUT HELPERS
* =============================================================================
  */

function requireObjectId(
value,
field
) {
if (
value === undefined ||
value === null ||
!mongoose
.Types
.ObjectId
.isValid(
value
)
) {
throw new ReferralRewardServiceError(
`${field} is required and must be a valid MongoDB ObjectId.`,
ERROR_CODES.INVALID_IDENTIFIER,
400,
{
field,
}
);
}


return String(
    value
);


}

function optionalObjectId(
value,
field
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return null;
}


return requireObjectId(
    value,
    field
);


}

function normalizeString(
value,
field,
options = {}
) {
if (
value === undefined ||
value === null
) {
if (
options.required
) {
throw new ReferralRewardServiceError(
`${field} is required.`,
ERROR_CODES.INVALID_REQUEST,
400,
{
field,
}
);
}


    return null;
}


const normalized =
    String(
        value
    ).trim();


if (
    !normalized
) {
    if (
        options.required
    ) {
        throw new ReferralRewardServiceError(
            `${field} is required.`,
            ERROR_CODES.INVALID_REQUEST,
            400,
            {
                field,
            }
        );
    }

    return null;
}


const maxLength =
    Number(
        options.maxLength ||
        256
    );


if (
    normalized.length >
    maxLength
) {
    throw new ReferralRewardServiceError(
        `${field} exceeds the maximum allowed length.`,
        ERROR_CODES.INVALID_REQUEST,
        400,
        {
            field,
            maxLength,
        }
    );
}


return options.uppercase
    ? normalized.toUpperCase()
    : normalized;


}

function parseBoolean(
value
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return undefined;
}


if (
    typeof value === "boolean"
) {
    return value;
}


const normalized =
    String(
        value
    )
        .trim()
        .toLowerCase();


if (
    [
        "true",
        "1",
        "yes",
    ].includes(
        normalized
    )
) {
    return true;
}


if (
    [
        "false",
        "0",
        "no",
    ].includes(
        normalized
    )
) {
    return false;
}


throw new ReferralRewardServiceError(
    "Boolean query parameter is invalid.",
    ERROR_CODES.INVALID_REQUEST,
    400
);


}

function parseInteger(
value,
field,
defaults = {}
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return defaults.defaultValue;
}


const parsed =
    Number(
        value
    );


if (
    !Number.isInteger(
        parsed
    )
) {
    throw new ReferralRewardServiceError(
        `${field} must be an integer.`,
        ERROR_CODES.INVALID_REQUEST,
        400,
        {
            field,
        }
    );
}


const minimum =
    defaults.min !== undefined
        ? defaults.min
        : Number.MIN_SAFE_INTEGER;

const maximum =
    defaults.max !== undefined
        ? defaults.max
        : Number.MAX_SAFE_INTEGER;


if (
    parsed < minimum ||
    parsed > maximum
) {
    throw new ReferralRewardServiceError(
        `${field} is outside the allowed range.`,
        ERROR_CODES.INVALID_REQUEST,
        400,
        {
            field,
            min:
                minimum,
            max:
                maximum,
        }
    );
}


return parsed;


}

/**

* =============================================================================
* DATE VALIDATION
* =============================================================================
  */

function optionalDate(
value,
field
) {
if (
value === undefined ||
value === null ||
value === ""
) {
return undefined;
}


const date =
    new Date(
        value
    );


if (
    Number.isNaN(
        date.getTime()
    )
) {
    throw new ReferralRewardServiceError(
        `${field} must be a valid date.`,
        ERROR_CODES.INVALID_REQUEST,
        400,
        {
            field,
        }
    );
}


return date;


}

/**

* =============================================================================
* OBJECT SANITIZATION
* =============================================================================
  */

function sanitizeMetadata(
value
) {
if (
value === undefined ||
value === null
) {
return {};
}


if (
    typeof value !==
    "object" ||
    Array.isArray(
        value
    )
) {
    throw new ReferralRewardServiceError(
        "metadata must be an object.",
        ERROR_CODES.INVALID_REQUEST,
        400
    );
}


const keys =
    Object.keys(
        value
    );


if (
    keys.length >
    MAX_METADATA_KEYS
) {
    throw new ReferralRewardServiceError(
        "metadata contains too many fields.",
        ERROR_CODES.INVALID_REQUEST,
        400
    );
}


/**
 * Prevent obvious credential/token leakage through arbitrary metadata.
 */
const forbiddenKeys =
    new Set([
        "password",
        "passwordHash",
        "token",
        "accessToken",
        "refreshToken",
        "secret",
        "clientSecret",
        "privateKey",
    ]);


for (
    const key of keys
) {
    if (
        forbiddenKeys.has(
            String(
                key
            )
        )
    ) {
        throw new ReferralRewardServiceError(
            `metadata contains a prohibited field: ${key}.`,
            ERROR_CODES.INVALID_REQUEST,
            400
        );
    }
}


return value;

}

function sanitizeTags(
value
) {
if (
value === undefined ||
value === null
) {
return [];
}


if (
    !Array.isArray(
        value
    )
) {
    throw new ReferralRewardServiceError(
        "tags must be an array.",
        ERROR_CODES.INVALID_REQUEST,
        400
    );
}


if (
    value.length >
    MAX_TAGS
) {
    throw new ReferralRewardServiceError(
        "Too many reward tags were supplied.",
        ERROR_CODES.INVALID_REQUEST,
        400
    );
}


return value.map(
    (tag) =>
        normalizeString(
            tag,
            "tag",
            {
                required:
                    true,

                maxLength:
                    64,
            }
        )
);


}

/**

* =============================================================================
* REASON VALIDATION
* =============================================================================
  */

function requireReason(
value,
fallback
) {
return normalizeString(
value ||
fallback,
"reason",
{
required:
true,


        maxLength:
            MAX_REASON_LENGTH,
    }
);


}

/**

* =============================================================================
* REQUEST CONTEXT
* =============================================================================
  */

function buildRequestContext(
req
) {
return {
correlationId:
getCorrelationId(
req
),


    requestId:
        getRequestId(
            req
        ),

    traceId:
        getTraceId(
            req
        ),

    ipAddress:
        req?.ip ||
        req?.socket?.remoteAddress ||
        null,

    userAgent:
        normalizeString(
            getHeader(
                req,
                "user-agent"
            ),
            "user-agent",
            {
                maxLength:
                    1024,
            }
        ),

    idempotencyKey:
        getIdempotencyKey(
            req
        ),
};


}

/**

* =============================================================================
* SERVICE INVOCATION HELPER
* =============================================================================
  */

function invoke(
promiseFactory
) {
return Promise
.resolve()
.then(
promiseFactory
);
}

/**

* =============================================================================
* ERROR NORMALIZATION
* =============================================================================
  */

function normalizeError(
error
) {
if (
error instanceof
ReferralRewardServiceError
) {
return error;
}


if (
    error?.name ===
    "ValidationError"
) {
    return new ReferralRewardServiceError(
        "Referral reward request validation failed.",
        ERROR_CODES.INVALID_REQUEST,
        400,
        undefined,
        error
    );
}


if (
    error?.name ===
    "CastError"
) {
    return new ReferralRewardServiceError(
        "One or more supplied identifiers are invalid.",
        ERROR_CODES.INVALID_IDENTIFIER,
        400,
        undefined,
        error
    );
}


if (
    error?.code ===
    11000
) {
    return new ReferralRewardServiceError(
        "The referral reward request conflicts with an existing record.",
        "REFERRAL_REWARD_DUPLICATE",
        409,
        undefined,
        error
    );
}


return new ReferralRewardServiceError(
    "An unexpected referral reward error occurred.",
    ERROR_CODES.INTERNAL_ERROR,
    500,
    undefined,
    error
);


}

/**

* =============================================================================
* SAFE ERROR RESPONSE
* =============================================================================
  */

function sendError(
res,
error,
options = {}
) {
const normalized =
normalizeError(
error
);


const requestId =
    options.requestId ||
    null;


const body =
    {
        success:
            false,

        error: {
            code:
                normalized.code,

            message:
                normalized.statusCode >=
                500
                    ? (
                        options.exposeInternalErrors ===
                        true
                            ? normalized.message
                            : "An internal error occurred."
                    )
                    : normalized.message,
        },

        meta: {
            controller:
                CONTROLLER_NAME,

            version:
                CONTROLLER_VERSION,

            requestId,
        },
    };


/**
 * Never expose arbitrary service internals by default.
 */
if (
    normalized.statusCode <
    500 &&
    normalized.details
) {
    body.error.details =
        normalized.details;
}


return res
    .status(
        normalized.statusCode
    )
    .json(
        body
    );


}

/**

* =============================================================================
* CONTROLLER
* =============================================================================
  */

class ReferralRewardController {


/**
 * -------------------------------------------------------------------------
 * Constructor
 * -------------------------------------------------------------------------
 */

constructor(
    dependencies = {}
) {
    this.service =
        dependencies.service ||
        dependencies.referralRewardService ||
        null;

    this.logger =
        dependencies.logger ||
        {
            debug() {},
            info() {},
            warn() {},
            error() {},
        };

    this.metrics =
        dependencies.metrics ||
        {
            increment() {},
        };

    this.authorizer =
        dependencies.authorizer ||
        null;


    if (
        !this.service
    ) {
        throw new TypeError(
            `${CONTROLLER_NAME}: referralRewardService dependency is required.`
        );
    }
}


/**
 * =========================================================================
 * INTERNAL EXECUTION WRAPPER
 * =========================================================================
 */

async _execute(
    req,
    res,
    handler
) {
    const context =
        buildRequestContext(
            req
        );


    try {
        const result =
            await invoke(
                () =>
                    handler(
                        context
                    )
            );


        return result;

    } catch (
        error
    ) {
        const normalized =
            normalizeError(
                error
            );


        this.logger.error(
            `${CONTROLLER_NAME}: request failed`,
            {
                code:
                    normalized.code,

                statusCode:
                    normalized.statusCode,

                requestId:
                    context.requestId,

                correlationId:
                    context.correlationId,

                route:
                    req?.originalUrl ||
                    req?.url,

                method:
                    req?.method,

                error:
                    normalized.cause?.message ||
                    normalized.message,
            }
        );


        this.metrics.increment(
            `titech.referral.reward.controller.error.${normalized.statusCode}`
        );


        return sendError(
            res,
            normalized,
            {
                requestId:
                    context.requestId,
            }
        );
    }
}


/**
 * =========================================================================
 * AUTHENTICATION / TENANT CONTEXT
 * =========================================================================
 */

_tenant(
    req
) {
    const tenantId =
        resolveTenantId(
            req
        );


    assertTenantConsistency(
        req,
        tenantId
    );


    return tenantId;
}


/**
 * =========================================================================
 * AUTHORIZE
 * =========================================================================
 */

_authorize(
    req,
    options = {}
) {
    if (
        this.authorizer
    ) {
        if (
            typeof this.authorizer.authorize ===
            "function"
        ) {
            return this.authorizer.authorize(
                req,
                options
            );
        }

        if (
            typeof this.authorizer.check ===
            "function"
        ) {
            return this.authorizer.check(
                req,
                options
            );
        }
    }


    return authorize(
        req,
        options
    );
}


/**
 * =========================================================================
 * CREATE REWARD
 * =========================================================================
 *
 * POST /referral-rewards
 *
 * Creates durable reward intent.
 *
 * This endpoint does NOT directly issue money.
 * =========================================================================
 */

async createReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async (
            context
        ) => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:create",
                }
            );


            const body =
                req.body ||
                {};


            const referralId =
                requireObjectId(
                    body.referralId,
                    "referralId"
                );


            const referrerUserId =
                requireObjectId(
                    body.referrerUserId,
                    "referrerUserId"
                );


            const beneficiaryUserId =
                requireObjectId(
                    body.beneficiaryUserId,
                    "beneficiaryUserId"
                );


            const rewardType =
                normalizeString(
                    body.rewardType,
                    "rewardType",
                    {
                        required:
                            true,

                        maxLength:
                            64,

                        uppercase:
                            true,
                    }
                );


            const amount =
                normalizeString(
                    body.amount,
                    "amount",
                    {
                        required:
                            true,

                        maxLength:
                            64,
                    }
                );


            const currency =
                normalizeString(
                    body.currency,
                    "currency",
                    {
                        required:
                            true,

                        maxLength:
                            16,

                        uppercase:
                            true,
                    }
                );


            const idempotencyKey =
                context.idempotencyKey ||
                normalizeString(
                    body.idempotencyKey,
                    "idempotencyKey",
                    {
                        maxLength:
                            256,
                    }
                );


            const result =
                await this.service
                    .createReward(
                        {
                            ...body,

                            tenantId,

                            referralId,

                            referrerUserId,

                            beneficiaryUserId,

                            rewardType,

                            amount,

                            currency,

                            idempotencyKey,

                            correlationId:
                                context.correlationId ||
                                body.correlationId,

                            requestId:
                                context.requestId ||
                                body.requestId,

                            traceId:
                                context.traceId ||
                                body.traceId,

                            metadata:
                                sanitizeMetadata(
                                    body.metadata
                                ),

                            tags:
                                sanitizeTags(
                                    body.tags
                                ),
                        }
                    );


            this.metrics.increment(
                result?.created
                    ? "titech.referral.reward.controller.created"
                    : "titech.referral.reward.controller.idempotent_create"
            );


            return result?.created
                ? created(
                    res,
                    {
                        reward:
                            result.reward,

                        created:
                            true,

                        idempotent:
                            false,
                    }
                )
                : success(
                    res,
                    {
                        reward:
                            result.reward,

                        created:
                            false,

                        idempotent:
                            true,
                    }
                );
        }
    );
}


/**
 * =========================================================================
 * GET REWARD
 * =========================================================================
 *
 * GET /referral-rewards/:rewardId
 * =========================================================================
 */

async getReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:read",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const reward =
                await this.service
                    .getReward(
                        tenantId,
                        rewardId
                    );


            return success(
                res,
                {
                    reward,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * GET BY IDEMPOTENCY KEY
 * =========================================================================
 *
 * GET /referral-rewards/idempotency/:idempotencyKey
 * =========================================================================
 */

async getByIdempotencyKey(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:read",
                }
            );


            const idempotencyKey =
                normalizeString(
                    req.params?.idempotencyKey,
                    "idempotencyKey",
                    {
                        required:
                            true,

                        maxLength:
                            256,
                    }
                );


            const reward =
                await this.service
                    .getByIdempotencyKey(
                        tenantId,
                        idempotencyKey
                    );


            if (
                !reward
            ) {
                return success(
                    res,
                    {
                        reward:
                            null,
                    }
                );
            }


            return success(
                res,
                {
                    reward,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * MARK ELIGIBLE
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/eligible
 * =========================================================================
 */

async markEligible(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:approve",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const body =
                req.body ||
                {};


            const eligibleAt =
                optionalDate(
                    body.eligibleAt,
                    "eligibleAt"
                );


            const eligibilityReference =
                normalizeString(
                    body.eligibilityReference,
                    "eligibilityReference",
                    {
                        maxLength:
                            256,
                    }
                );


            const reward =
                await this.service
                    .markEligible(
                        tenantId,
                        rewardId,
                        {
                            eligibleAt,

                            eligibilityReference,

                            correlationId:
                                getCorrelationId(
                                    req
                                ),
                        }
                    );


            return success(
                res,
                {
                    reward,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * ISSUE REWARD
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/issue
 *
 * This is a privileged financial operation.
 * =========================================================================
 */

async issueReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async (
            context
        ) => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:issue",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const workerId =
                normalizeString(
                    req.body?.workerId ||
                    req.workerId ||
                    `titech-referral-http-${process.pid}`,
                    "workerId",
                    {
                        required:
                            true,

                        maxLength:
                            256,
                    }
                );


            const result =
                await this.service
                    .issueReward(
                        tenantId,
                        rewardId,
                        {
                            workerId,

                            correlationId:
                                context.correlationId,

                            requestId:
                                context.requestId,

                            traceId:
                                context.traceId,
                        }
                    );


            if (
                result?.fraudReview
            ) {
                return res
                    .status(202)
                    .json({
                        success:
                            true,

                        data:
                            result,

                        meta: {
                            controller:
                                CONTROLLER_NAME,

                            version:
                                CONTROLLER_VERSION,

                            requestId:
                                context.requestId,

                            outcome:
                                "FRAUD_REVIEW",
                        },
                    });
            }


            if (
                result?.busy
            ) {
                return res
                    .status(202)
                    .json({
                        success:
                            true,

                        data:
                            result,

                        meta: {
                            controller:
                                CONTROLLER_NAME,

                            version:
                                CONTROLLER_VERSION,

                            requestId:
                                context.requestId,

                            outcome:
                                "PROCESSING_BY_ANOTHER_WORKER",
                        },
                    });
            }


            return success(
                res,
                result
            );
        }
    );
}


/**
 * =========================================================================
 * RETRY REWARD
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/retry
 * =========================================================================
 */

async retryReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async (
            context
        ) => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:retry",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const result =
                await this.service
                    .retryReward(
                        tenantId,
                        rewardId,
                        {
                            workerId:
                                normalizeString(
                                    req.body?.workerId ||
                                    `titech-referral-retry-${process.pid}`,
                                    "workerId",
                                    {
                                        maxLength:
                                            256,
                                    }
                                ),

                            correlationId:
                                context.correlationId,

                            requestId:
                                context.requestId,

                            traceId:
                                context.traceId,
                        }
                    );


            return success(
                res,
                result
            );
        }
    );
}


/**
 * =========================================================================
 * CANCEL REWARD
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/cancel
 * =========================================================================
 */

async cancelReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:cancel",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const reason =
                requireReason(
                    req.body?.reason,
                    "Referral reward cancelled."
                );


            const reward =
                await this.service
                    .cancelReward(
                        tenantId,
                        rewardId,
                        {
                            reason,
                        }
                    );


            return success(
                res,
                {
                    reward,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * REVERSE REWARD
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/reverse
 *
 * This endpoint must be tightly authorized.
 * =========================================================================
 */

async reverseReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async (
            context
        ) => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:reverse",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const reason =
                requireReason(
                    req.body?.reason,
                    "Referral reward reversal."
                );


            const idempotencyKey =
                context.idempotencyKey ||
                normalizeString(
                    req.body?.idempotencyKey,
                    "idempotencyKey",
                    {
                        maxLength:
                            256,
                    }
                );


            const result =
                await this.service
                    .reverseReward(
                        tenantId,
                        rewardId,
                        {
                            reason,

                            idempotencyKey,

                            correlationId:
                                context.correlationId,

                            requestId:
                                context.requestId,

                            traceId:
                                context.traceId,
                        }
                    );


            return success(
                res,
                result
            );
        }
    );
}


/**
 * =========================================================================
 * RECONCILE REWARD
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/reconcile
 *
 * Privileged recovery operation.
 * =========================================================================
 */

async reconcileReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async (
            context
        ) => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:reconcile",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const result =
                await this.service
                    .reconcileReward(
                        tenantId,
                        rewardId,
                        {
                            correlationId:
                                context.correlationId,

                            requestId:
                                context.requestId,

                            traceId:
                                context.traceId,
                        }
                    );


            return success(
                res,
                result
            );
        }
    );
}


/**
 * =========================================================================
 * RECOVER STALE REWARD
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/recover
 * =========================================================================
 */

async recoverStaleReward(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:recover",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const reward =
                await this.service
                    .recoverStaleReward(
                        tenantId,
                        rewardId
                    );


            if (
                !reward
            ) {
                return success(
                    res,
                    {
                        reward:
                            null,

                        recovered:
                            false,
                    }
                );
            }


            return success(
                res,
                {
                    reward,

                    recovered:
                        true,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * RELEASE PROCESSING LEASE
 * =========================================================================
 *
 * POST /referral-rewards/:rewardId/release-lease
 * =========================================================================
 */

async releaseProcessingLease(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:recover",
                }
            );


            const rewardId =
                requireObjectId(
                    req.params?.rewardId,
                    "rewardId"
                );


            const workerId =
                normalizeString(
                    req.body?.workerId ||
                    req.workerId,
                    "workerId",
                    {
                        required:
                            true,

                        maxLength:
                            256,
                    }
                );


            const nextAttemptAt =
                optionalDate(
                    req.body?.nextAttemptAt,
                    "nextAttemptAt"
                );


            const reward =
                await this.service
                    .releaseProcessingLease(
                        tenantId,
                        rewardId,
                        workerId,
                        {
                            nextAttemptAt,
                        }
                    );


            if (
                !reward
            ) {
                return success(
                    res,
                    {
                        reward:
                            null,

                        released:
                            false,
                    }
                );
            }


            return success(
                res,
                {
                    reward,

                    released:
                        true,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * FIND RECOVERABLE
 * =========================================================================
 *
 * GET /referral-rewards/recoverable
 * =========================================================================
 */

async findRecoverable(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:recover",
                }
            );


            const limit =
                parseInteger(
                    req.query?.limit,
                    "limit",
                    {
                        defaultValue:
                            DEFAULT_LIMIT,

                        min:
                            1,

                        max:
                            MAX_LIMIT,
                    }
                );


            const rewards =
                await this.service
                    .findRecoverable(
                        tenantId,
                        {
                            limit,
                        }
                    );


            return success(
                res,
                {
                    rewards,

                    count:
                        rewards.length,

                    limit,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * FIND STALE PROCESSING
 * =========================================================================
 *
 * GET /referral-rewards/stale-processing
 * =========================================================================
 */

async findStaleProcessing(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:recover",
                }
            );


            const limit =
                parseInteger(
                    req.query?.limit,
                    "limit",
                    {
                        defaultValue:
                            DEFAULT_LIMIT,

                        min:
                            1,

                        max:
                            MAX_LIMIT,
                    }
                );


            const rewards =
                await this.service
                    .findStaleProcessing(
                        tenantId,
                        {
                            limit,
                        }
                    );


            return success(
                res,
                {
                    rewards,

                    count:
                        rewards.length,

                    limit,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * RECOVER BATCH
 * =========================================================================
 *
 * POST /referral-rewards/recovery/batch
 *
 * This endpoint should normally be invoked by a trusted internal worker,
 * scheduler, or operations service rather than an ordinary user.
 * =========================================================================
 */

async recoverBatch(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async (
            context
        ) => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:recover",
                }
            );


            const limit =
                parseInteger(
                    req.body?.limit ||
                    req.query?.limit,
                    "limit",
                    {
                        defaultValue:
                            DEFAULT_LIMIT,

                        min:
                            1,

                        max:
                            MAX_LIMIT,
                    }
                );


            const workerId =
                normalizeString(
                    req.body?.workerId ||
                    req.workerId ||
                    `titech-referral-recovery-${process.pid}`,
                    "workerId",
                    {
                        required:
                            true,

                        maxLength:
                            256,
                    }
                );


            const result =
                await this.service
                    .recoverBatch(
                        tenantId,
                        {
                            limit,

                            workerId,

                            correlationId:
                                context.correlationId,

                            requestId:
                                context.requestId,

                            traceId:
                                context.traceId,
                        }
                    );


            return success(
                res,
                result
            );
        }
    );
}


/**
 * =========================================================================
 * STATISTICS
 * =========================================================================
 *
 * GET /referral-rewards/statistics
 * =========================================================================
 */

async getStatistics(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const tenantId =
                this._tenant(
                    req
                );


            this._authorize(
                req,
                {
                    permission:
                        "referral_reward:read",
                }
            );


            const from =
                optionalDate(
                    req.query?.from,
                    "from"
                );


            const to =
                optionalDate(
                    req.query?.to,
                    "to"
                );


            if (
                from &&
                to &&
                from > to
            ) {
                throw new ReferralRewardServiceError(
                    "The 'from' date must not be later than the 'to' date.",
                    ERROR_CODES.INVALID_REQUEST,
                    400
                );
            }


            const statistics =
                await this.service
                    .getStatistics(
                        tenantId,
                        {
                            from,

                            to,
                        }
                    );


            return success(
                res,
                {
                    statistics,
                }
            );
        }
    );
}


/**
 * =========================================================================
 * HEALTH CHECK
 * =========================================================================
 *
 * GET /referral-rewards/health
 *
 * This should normally be protected or exposed only through an internal
 * health endpoint.
 * =========================================================================
 */

async healthCheck(
    req,
    res
) {
    return this._execute(
        req,
        res,
        async () => {
            const result =
                await this.service
                    .healthCheck();


            const statusCode =
                result.status ===
                "UP"
                    ? 200
                    : 503;


            return res
                .status(
                    statusCode
                )
                .json({
                    success:
                        result.status ===
                        "UP",

                    data:
                        result,

                    meta: {
                        controller:
                            CONTROLLER_NAME,

                        version:
                            CONTROLLER_VERSION,
                    },
                });
        }
    );
}


}

/**

* =============================================================================
* FACTORY
* =============================================================================
  */

function createReferralRewardController(
dependencies = {}
) {
return new ReferralRewardController(
dependencies
);
}

/**

* =============================================================================
* DEFAULT SINGLETON
* =============================================================================
*
* The default service export is loaded from the enterprise referral reward
* service. Application bootstrap can replace the controller with an injected
* instance when required.
* =============================================================================
  */

let defaultService;

try {
defaultService =
require(
"../services/referralRewardService"
);
} catch {
defaultService =
null;
}

const referralRewardService =
defaultService;

const referralRewardController =
referralRewardService
? createReferralRewardController({
service:
referralRewardService,
})
: null;

/**

* =============================================================================
* EXPRESS HANDLER BINDING
* =============================================================================
*
* Binding the singleton methods prevents `this` context loss when handlers are
* passed directly into Express routes.
* =============================================================================
  */

function bindController(
controller
) {
if (
!controller
) {
return {};
}


return {
    createReward:
        controller.createReward
            .bind(
                controller
            ),

    getReward:
        controller.getReward
            .bind(
                controller
            ),

    getByIdempotencyKey:
        controller.getByIdempotencyKey
            .bind(
                controller
            ),

    markEligible:
        controller.markEligible
            .bind(
                controller
            ),

    issueReward:
        controller.issueReward
            .bind(
                controller
            ),

    retryReward:
        controller.retryReward
            .bind(
                controller
            ),

    cancelReward:
        controller.cancelReward
            .bind(
                controller
            ),

    reverseReward:
        controller.reverseReward
            .bind(
                controller
            ),

    reconcileReward:
        controller.reconcileReward
            .bind(
                controller
            ),

    recoverStaleReward:
        controller.recoverStaleReward
            .bind(
                controller
            ),

    releaseProcessingLease:
        controller.releaseProcessingLease
            .bind(
                controller
            ),

    findRecoverable:
        controller.findRecoverable
            .bind(
                controller
            ),

    findStaleProcessing:
        controller.findStaleProcessing
            .bind(
                controller
            ),

    recoverBatch:
        controller.recoverBatch
            .bind(
                controller
            ),

    getStatistics:
        controller.getStatistics
            .bind(
                controller
            ),

    healthCheck:
        controller.healthCheck
            .bind(
                controller
            ),
};

}

const handlers =
bindController(
referralRewardController
);

/**

* =============================================================================
* EXPORTS
* =============================================================================
*
* Backward-compatible CommonJS exports.
*
* Supported usage:
*
* const referralRewardController =
* ```
    require("./referralRewardController");
  ```
*
* router.post(
* ```
    "/",
  ```
* ```
    referralRewardController.createReward
  ```
* );
*
* Or:
*
* const {
* ```
    ReferralRewardController,
  ```
* ```
    createReferralRewardController,
  ```
* } = require("./referralRewardController");
*
* =============================================================================
  */

module.exports =
handlers;

module.exports.referralRewardController =
referralRewardController;

module.exports.ReferralRewardController =
ReferralRewardController;

module.exports.createReferralRewardController =
createReferralRewardController;

module.exports.ReferralRewardServiceError =
ReferralRewardServiceError;

module.exports.CONTROLLER_NAME =
CONTROLLER_NAME;

module.exports.CONTROLLER_VERSION =
CONTROLLER_VERSION;