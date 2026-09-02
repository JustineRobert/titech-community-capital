"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Referral Reward Routes
 * =============================================================================
 *
 * File:
 *   backend/routes/referralRewardRoutes.js
 *
 * Version:
 *   2026.3
 *
 * Purpose:
 *   Enterprise HTTP routing layer for the TITech referral reward subsystem.
 *
 * =============================================================================
 * ARCHITECTURAL POSITION
 * =============================================================================
 *
 *   HTTP Request
 *       │
 *       ▼
 *   Security Middleware
 *       │
 *       ├── Authentication
 *       ├── Tenant Resolution
 *       ├── RBAC
 *       ├── Rate Limiting
 *       ├── Request Validation
 *       └── Idempotency
 *       │
 *       ▼
 *   ReferralRewardController
 *       │
 *       ▼
 *   ReferralRewardService
 *       │
 *       ├── ReferralReward
 *       ├── Fraud / Risk
 *       ├── Financial Transaction Service
 *       ├── Ledger
 *       ├── Audit
 *       └── Recovery / Reconciliation
 *
 * =============================================================================
 * FINANCIAL SAFETY
 * =============================================================================
 *
 * These routes NEVER:
 *
 *   - modify wallet balances directly
 *   - accept tenantId as an authoritative client identity
 *   - trust beneficiary/referrer authorization supplied by the client
 *   - expose internal financial-service credentials
 *   - bypass the ReferralRewardService
 *   - perform financial calculations
 *
 * All financial state changes must pass through:
 *
 *   ReferralRewardController
 *          ↓
 *   ReferralRewardService
 *          ↓
 *   Authoritative Financial Transaction Service
 *          ↓
 *   Double-entry Ledger
 *
 * =============================================================================
 * SECURITY PRINCIPLES
 * =============================================================================
 *
 *   ✓ Authentication required
 *   ✓ Tenant isolation
 *   ✓ RBAC
 *   ✓ Input validation
 *   ✓ Idempotency support
 *   ✓ Rate limiting hooks
 *   ✓ Request correlation IDs
 *   ✓ Financial-operation separation
 *   ✓ Recovery endpoints restricted
 *   ✓ Reversal restricted
 *   ✓ No client-controlled tenant identity
 *   ✓ No arbitrary status mutation endpoint
 *   ✓ No arbitrary amount mutation endpoint
 *
 * =============================================================================
 */

const express =
    require("express");

const router =
    express.Router();


/**
 * =============================================================================
 * CONTROLLER
 * =============================================================================
 */

const referralRewardController =
    require(
        "../controllers/referralRewardController"
    );


/**
 * =============================================================================
 * OPTIONAL MIDDLEWARE RESOLUTION
 * =============================================================================
 *
 * TITech installations may have different middleware filenames.
 *
 * The route layer therefore attempts conventional locations while remaining
 * fail-closed for security-critical middleware.
 * =============================================================================
 */

function optionalRequire(
    candidates = []
) {
    for (
        const candidate of candidates
    ) {
        try {
            return require(
                candidate
            );
        } catch (
            error
        ) {
            /**
             * Only ignore module-not-found errors for the candidate itself.
             *
             * If the candidate exists but contains another dependency error,
             * rethrow it so application startup does not hide a real defect.
             */
            if (
                error?.code !==
                "MODULE_NOT_FOUND"
            ) {
                throw error;
            }
        }
    }

    return null;
}


/**
 * =============================================================================
 * AUTHENTICATION MIDDLEWARE
 * =============================================================================
 */

const authMiddleware =
    optionalRequire([
        "../middleware/auth",
        "../middleware/authMiddleware",
        "../middleware/authenticate",
        "../middleware/authentication",
    ]);


/**
 * =============================================================================
 * TENANT MIDDLEWARE
 * =============================================================================
 */

const tenantMiddleware =
    optionalRequire([
        "../middleware/tenant",
        "../middleware/tenantMiddleware",
        "../middleware/tenantContext",
        "../middleware/tenantResolver",
    ]);


/**
 * =============================================================================
 * RBAC MIDDLEWARE
 * =============================================================================
 */

const rbacMiddleware =
    optionalRequire([
        "../middleware/rbac",
        "../middleware/rbacMiddleware",
        "../middleware/authorize",
        "../middleware/authorization",
    ]);


/**
 * =============================================================================
 * VALIDATION MIDDLEWARE
 * =============================================================================
 */

const validationMiddleware =
    optionalRequire([
        "../middleware/validation",
        "../middleware/validate",
        "../middleware/requestValidation",
    ]);


/**
 * =============================================================================
 * RATE LIMITING
 * =============================================================================
 */

const rateLimitMiddleware =
    optionalRequire([
        "../middleware/rateLimiter",
        "../middleware/rateLimit",
        "../middleware/rateLimitMiddleware",
    ]);


/**
 * =============================================================================
 * IDEMPOTENCY MIDDLEWARE
 * =============================================================================
 */

const idempotencyMiddleware =
    optionalRequire([
        "../middleware/idempotency",
        "../middleware/idempotencyMiddleware",
    ]);


/**
 * =============================================================================
 * REQUEST CONTEXT / CORRELATION
 * =============================================================================
 */

const requestContextMiddleware =
    optionalRequire([
        "../middleware/requestContext",
        "../middleware/requestContextMiddleware",
        "../middleware/correlationId",
        "../middleware/correlationIdMiddleware",
    ]);


/**
 * =============================================================================
 * ERROR HANDLER
 * =============================================================================
 */

const errorHandler =
    optionalRequire([
        "../middleware/errorHandler",
        "../middleware/errorMiddleware",
        "../middleware/errorHandlerMiddleware",
    ]);


/**
 * =============================================================================
 * MIDDLEWARE HELPERS
 * =============================================================================
 */

function normalizeMiddleware(
    middleware
) {
    if (
        !middleware
    ) {
        return null;
    }

    /**
     * Support:
     *
     *   module.exports = middleware
     *
     * and:
     *
     *   module.exports = { authenticate }
     *
     * and common default exports.
     */
    if (
        typeof middleware ===
        "function"
    ) {
        return middleware;
    }

    if (
        typeof middleware.default ===
        "function"
    ) {
        return middleware.default;
    }

    const preferredNames = [
        "authenticate",
        "auth",
        "authenticateUser",
        "requireAuth",
        "resolveTenant",
        "tenant",
        "tenantMiddleware",
        "authorize",
        "requireRole",
        "validate",
        "validateRequest",
        "rateLimiter",
        "idempotency",
        "requestContext",
    ];

    for (
        const name of preferredNames
    ) {
        if (
            typeof middleware[name] ===
            "function"
        ) {
            return middleware[name];
        }
    }

    return null;
}


const authenticate =
    normalizeMiddleware(
        authMiddleware
    );

const resolveTenant =
    normalizeMiddleware(
        tenantMiddleware
    );

const authorize =
    normalizeMiddleware(
        rbacMiddleware
    );

const validate =
    normalizeMiddleware(
        validationMiddleware
    );

const rateLimit =
    normalizeMiddleware(
        rateLimitMiddleware
    );

const idempotency =
    normalizeMiddleware(
        idempotencyMiddleware
    );

const requestContext =
    normalizeMiddleware(
        requestContextMiddleware
    );


/**
 * =============================================================================
 * SECURITY REQUIREMENT
 * =============================================================================
 *
 * Authentication must exist in production.
 *
 * We intentionally fail startup when this router is mounted in a production
 * environment without an authentication middleware.
 *
 * Development/test environments may provide authentication at the parent
 * router/application level.
 * =============================================================================
 */

function requireAuthenticationMiddleware(
    req,
    res,
    next
) {
    if (
        authenticate
    ) {
        return authenticate(
            req,
            res,
            next
        );
    }

    if (
        process.env.NODE_ENV ===
        "production"
    ) {
        return res
            .status(500)
            .json({
                success:
                    false,

                code:
                    "TITECH_AUTH_MIDDLEWARE_NOT_CONFIGURED",

                message:
                    "Authentication middleware is not configured.",
            });
    }

    return next();
}


/**
 * =============================================================================
 * TENANT CONTEXT
 * =============================================================================
 *
 * The controller should obtain tenant identity from the authenticated request
 * context, not from an arbitrary body/query/path value.
 *
 * Supported conventional locations:
 *
 *   req.tenantId
 *   req.tenant.id
 *   req.tenant._id
 *   req.user.tenantId
 *
 * The middleware is preferred when available.
 * =============================================================================
 */

function requireTenantContext(
    req,
    res,
    next
) {
    if (
        resolveTenant
    ) {
        return resolveTenant(
            req,
            res,
            next
        );
    }

    const tenantId =
        req.tenantId ||
        req.tenant?.id ||
        req.tenant?._id ||
        req.user?.tenantId;

    if (
        tenantId
    ) {
        return next();
    }

    return res
        .status(403)
        .json({
            success:
                false,

            code:
                "TITECH_TENANT_CONTEXT_REQUIRED",

            message:
                "A valid authenticated tenant context is required.",
        });
}


/**
 * =============================================================================
 * REQUEST CONTEXT
 * =============================================================================
 */

function applyRequestContext(
    req,
    res,
    next
) {
    if (
        requestContext
    ) {
        return requestContext(
            req,
            res,
            next
        );
    }

    /**
     * Generate a correlation ID when the application's global middleware has
     * not already supplied one.
     */
    if (
        !req.correlationId
    ) {
        const crypto =
            require("node:crypto");

        req.correlationId =
            crypto.randomUUID();
    }

    return next();
}


/**
 * =============================================================================
 * RATE LIMITER
 * =============================================================================
 *
 * Financial endpoints should have substantially stricter limits than ordinary
 * read endpoints.
 *
 * If the application's rate limiter supports route-specific configuration,
 * callers can replace this middleware with a configured instance.
 * =============================================================================
 */

function applyRateLimit(
    req,
    res,
    next
) {
    if (
        rateLimit
    ) {
        return rateLimit(
            req,
            res,
            next
        );
    }

    return next();
}


/**
 * =============================================================================
 * IDEMPOTENCY
 * =============================================================================
 *
 * Idempotency is especially important for:
 *
 *   POST /:rewardId/issue
 *   POST /:rewardId/retry
 *   POST /:rewardId/reverse
 *
 * The ReferralRewardService also enforces database/financial idempotency.
 *
 * Middleware is therefore an additional protection layer rather than the sole
 * source of truth.
 * =============================================================================
 */

function applyIdempotency(
    req,
    res,
    next
) {
    if (
        idempotency
    ) {
        return idempotency(
            req,
            res,
            next
        );
    }

    return next();
}


/**
 * =============================================================================
 * RBAC HELPERS
 * =============================================================================
 *
 * Because TITech installations may expose different authorization middleware
 * APIs, this helper supports several common conventions.
 *
 * Production deployments should configure the application's canonical RBAC
 * middleware.
 * =============================================================================
 */

function requireRoles(
    roles = []
) {
    return function (
        req,
        res,
        next
    ) {
        if (
            !authorize
        ) {
            /**
             * Fail closed for privileged financial operations.
             */
            return res
                .status(500)
                .json({
                    success:
                        false,

                    code:
                        "TITECH_RBAC_MIDDLEWARE_NOT_CONFIGURED",

                    message:
                        "Authorization middleware is not configured.",
                });
        }


        try {
            /**
             * Factory-style RBAC:
             *
             * authorize(["ADMIN", "FINANCE"])
             */
            if (
                authorize.length <=
                1
            ) {
                const middleware =
                    authorize(
                        roles
                    );

                if (
                    typeof middleware ===
                    "function"
                ) {
                    return middleware(
                        req,
                        res,
                        next
                    );
                }
            }


            /**
             * Middleware-style RBAC:
             *
             * authorize(req, res, next, roles)
             */
            return authorize(
                req,
                res,
                next,
                roles
            );

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
 * =============================================================================
 * VALIDATION HELPER
 * =============================================================================
 *
 * Validation middleware is optional at this route layer because the controller
 * remains responsible for domain validation.
 *
 * If a canonical validator is installed, it is applied here.
 * =============================================================================
 */

function applyValidation(
    schema
) {
    return function (
        req,
        res,
        next
    ) {
        if (
            !validate
        ) {
            return next();
        }

        try {
            /**
             * Common factory pattern:
             *
             * validate(schema)
             */
            if (
                validate.length <=
                1
            ) {
                const middleware =
                    validate(
                        schema
                    );

                if (
                    typeof middleware ===
                    "function"
                ) {
                    return middleware(
                        req,
                        res,
                        next
                    );
                }
            }

            /**
             * Common direct middleware:
             */
            return validate(
                req,
                res,
                next,
                schema
            );

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
 * =============================================================================
 * BODY NORMALIZATION
 * =============================================================================
 *
 * Prevent accidental acceptance of client-controlled tenant identity.
 *
 * The controller/service may still use tenantId internally when supplied by
 * trusted application context, but the public API must not accept a body
 * tenantId as authoritative identity.
 * =============================================================================
 */

function rejectClientTenantOverride(
    req,
    res,
    next
) {
    const body =
        req.body;

    if (
        body &&
        Object.prototype.hasOwnProperty.call(
            body,
            "tenantId"
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    "TITECH_CLIENT_TENANT_OVERRIDE_FORBIDDEN",

                message:
                    "tenantId must be derived from the authenticated tenant context.",
            });
    }

    return next();
}


/**
 * =============================================================================
 * REQUEST SIZE / PARAMETER SAFETY
 * =============================================================================
 */

function sanitizeParameter(
    req,
    res,
    next
) {
    /**
     * Reject prototype-pollution style parameter names where applicable.
     */
    const dangerousKeys =
        [
            "__proto__",
            "prototype",
            "constructor",
        ];

    const containsDangerousKey =
        (value) => {
            if (
                !value ||
                typeof value !==
                    "object"
            ) {
                return false;
            }

            return Object.keys(
                value
            ).some(
                (key) =>
                    dangerousKeys.includes(
                        key
                    )
            );
        };


    if (
        containsDangerousKey(
            req.body
        ) ||
        containsDangerousKey(
            req.query
        ) ||
        containsDangerousKey(
            req.params
        )
    ) {
        return res
            .status(400)
            .json({
                success:
                    false,

                code:
                    "TITECH_INVALID_REQUEST_PARAMETERS",

                message:
                    "Invalid request parameters.",
            });
    }

    return next();
}


/**
 * =============================================================================
 * COMMON ROUTE STACK
 * =============================================================================
 */

const authenticatedTenantRoute =
    [
        applyRequestContext,

        requireAuthenticationMiddleware,

        requireTenantContext,

        sanitizeParameter,
    ];


/**
 * =============================================================================
 * PUBLIC READ ROUTES
 * =============================================================================
 *
 * Even read operations require authentication and tenant context.
 * =============================================================================
 */


/**
 * GET /referral-rewards/:rewardId
 *
 * Retrieve one referral reward.
 */
router.get(
    "/:rewardId",

    ...authenticatedTenantRoute,

    requireRoles([
        "MEMBER",
        "USER",
        "STAFF",
        "SUPPORT",
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyValidation(
        "referralRewardId"
    ),

    referralRewardController.getReward
);


/**
 * GET /referral-rewards/idempotency/:idempotencyKey
 *
 * Retrieve a reward using its idempotency key.
 *
 * This route is intentionally authenticated because an idempotency key is an
 * internal business identifier and must not become a public enumeration API.
 */
router.get(
    "/idempotency/:idempotencyKey",

    ...authenticatedTenantRoute,

    requireRoles([
        "STAFF",
        "SUPPORT",
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyValidation(
        "referralRewardIdempotencyKey"
    ),

    referralRewardController.getByIdempotencyKey
);


/**
 * =============================================================================
 * REWARD CREATION
 * =============================================================================
 *
 * POST /
 *
 * Creates durable reward intent.
 *
 * It does NOT directly move money.
 *
 * Idempotency is mandatory/recommended for financial workflows.
 * =============================================================================
 */

router.post(
    "/",

    ...authenticatedTenantRoute,

    requireRoles([
        "STAFF",
        "REFERRAL_MANAGER",
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    rejectClientTenantOverride,

    applyRateLimit,

    applyIdempotency,

    applyValidation(
        "createReferralReward"
    ),

    referralRewardController.createReward
);


/**
 * =============================================================================
 * ELIGIBILITY
 * =============================================================================
 *
 * POST /:rewardId/eligible
 *
 * Moves a reward into ELIGIBLE state.
 *
 * This operation should only be available to trusted referral/business
 * workflows.
 * =============================================================================
 */

router.post(
    "/:rewardId/eligible",

    ...authenticatedTenantRoute,

    requireRoles([
        "REFERRAL_MANAGER",
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyValidation(
        "markReferralRewardEligible"
    ),

    referralRewardController.markEligible
);


/**
 * =============================================================================
 * ISSUE REWARD
 * =============================================================================
 *
 * POST /:rewardId/issue
 *
 * Financial operation.
 *
 * Strictly restricted.
 *
 * The controller must pass:
 *
 *   tenantId
 *   rewardId
 *   workerId / actor context
 *   correlationId
 *   idempotency key
 *   request context
 *
 * to ReferralRewardService.issueReward().
 * =============================================================================
 */

router.post(
    "/:rewardId/issue",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "REFERRAL_MANAGER",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyIdempotency,

    applyValidation(
        "issueReferralReward"
    ),

    referralRewardController.issueReward
);


/**
 * =============================================================================
 * RETRY REWARD
 * =============================================================================
 *
 * POST /:rewardId/retry
 *
 * Allows controlled retry of failed/retryable rewards.
 *
 * It must NOT be interpreted as permission to bypass fraud review or maximum
 * retry limits.
 * =============================================================================
 */

router.post(
    "/:rewardId/retry",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "REFERRAL_MANAGER",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyIdempotency,

    applyValidation(
        "retryReferralReward"
    ),

    referralRewardController.retryReward
);


/**
 * =============================================================================
 * CANCEL REWARD
 * =============================================================================
 *
 * POST /:rewardId/cancel
 *
 * Cancellation is permitted before financial issuance.
 *
 * Issued rewards must use reversal.
 * =============================================================================
 */

router.post(
    "/:rewardId/cancel",

    ...authenticatedTenantRoute,

    requireRoles([
        "REFERRAL_MANAGER",
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyValidation(
        "cancelReferralReward"
    ),

    referralRewardController.cancelReward
);


/**
 * =============================================================================
 * REVERSE ISSUED REWARD
 * =============================================================================
 *
 * POST /:rewardId/reverse
 *
 * High-risk financial operation.
 *
 * MUST pass through the authoritative financial service and ledger.
 * =============================================================================
 */

router.post(
    "/:rewardId/reverse",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyIdempotency,

    applyValidation(
        "reverseReferralReward"
    ),

    referralRewardController.reverseReward
);


/**
 * =============================================================================
 * RECONCILIATION
 * =============================================================================
 *
 * POST /:rewardId/reconcile
 *
 * Used when financial posting may have succeeded but ReferralReward state did
 * not finalize.
 *
 * This endpoint is NOT a second issuance mechanism.
 * =============================================================================
 */

router.post(
    "/:rewardId/reconcile",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyIdempotency,

    applyValidation(
        "reconcileReferralReward"
    ),

    referralRewardController.reconcileReward
);


/**
 * =============================================================================
 * STALE PROCESSING RECOVERY
 * =============================================================================
 *
 * POST /:rewardId/recover
 *
 * Explicitly recovers a stale processing lease.
 *
 * This is an operational endpoint and must not be exposed to ordinary members.
 * =============================================================================
 */

router.post(
    "/:rewardId/recover",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyValidation(
        "recoverReferralReward"
    ),

    referralRewardController.recoverStaleReward
);


/**
 * =============================================================================
 * RELEASE PROCESSING LEASE
 * =============================================================================
 *
 * POST /:rewardId/release-lease
 *
 * Used by workers/operators when a processing lease must be relinquished.
 * =============================================================================
 */

router.post(
    "/:rewardId/release-lease",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyRateLimit,

    applyValidation(
        "releaseReferralRewardLease"
    ),

    referralRewardController.releaseProcessingLease
);


/**
 * =============================================================================
 * RECOVERY BATCH
 * =============================================================================
 *
 * POST /recovery/batch
 *
 * Operational recovery endpoint.
 *
 * This route is primarily intended for:
 *
 *   - internal worker
 *   - scheduler
 *   - administrator
 *   - controlled recovery tooling
 *
 * In production, prefer invoking recoverBatch from a trusted background job
 * rather than exposing it publicly.
 * =============================================================================
 */

router.post(
    "/recovery/batch",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
        "SYSTEM",
    ]),

    applyRateLimit,

    applyValidation(
        "recoverReferralRewardBatch"
    ),

    referralRewardController.recoverBatch
);


/**
 * =============================================================================
 * FIND RECOVERABLE
 * =============================================================================
 *
 * GET /recovery/recoverable
 *
 * Operational visibility into rewards requiring recovery.
 * =============================================================================
 */

router.get(
    "/recovery/recoverable",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
        "SYSTEM",
    ]),

    applyValidation(
        "findRecoverableReferralRewards"
    ),

    referralRewardController.findRecoverable
);


/**
 * =============================================================================
 * FIND STALE PROCESSING
 * =============================================================================
 *
 * GET /recovery/stale-processing
 * =============================================================================
 */

router.get(
    "/recovery/stale-processing",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "ADMIN",
        "SUPER_ADMIN",
        "SYSTEM",
    ]),

    applyValidation(
        "findStaleReferralRewards"
    ),

    referralRewardController.findStaleProcessing
);


/**
 * =============================================================================
 * STATISTICS
 * =============================================================================
 *
 * GET /statistics
 *
 * Tenant-scoped operational reporting.
 * =============================================================================
 */

router.get(
    "/statistics",

    ...authenticatedTenantRoute,

    requireRoles([
        "FINANCE",
        "REPORTING",
        "ADMIN",
        "SUPER_ADMIN",
    ]),

    applyValidation(
        "referralRewardStatistics"
    ),

    referralRewardController.getStatistics
);


/**
 * =============================================================================
 * HEALTH CHECK
 * =============================================================================
 *
 * GET /health
 *
 * IMPORTANT:
 *
 * This route should normally be mounted behind internal infrastructure
 * authentication if exposed outside localhost/private service networking.
 *
 * It intentionally does not expose financial records.
 * =============================================================================
 */

router.get(
    "/health",

    applyRateLimit,

    referralRewardController.healthCheck
);


/**
 * =============================================================================
 * ROUTER-LEVEL ERROR HANDLER
 * =============================================================================
 *
 * Only applies when the application's global error handler has not already
 * handled the error.
 * =============================================================================
 */

if (
    errorHandler
) {
    router.use(
        errorHandler
    );
}


/**
 * =============================================================================
 * ROUTER METADATA
 * =============================================================================
 */

router.serviceName =
    "TITechReferralRewardRoutes";

router.serviceVersion =
    "2026.3";


/**
 * =============================================================================
 * EXPORT
 * =============================================================================
 */

module.exports =
    router;