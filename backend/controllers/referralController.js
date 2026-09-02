'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Referral Controller
 * ============================================================================
 *
 * File:
 *   backend/controllers/referralController.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Translate HTTP requests into application-service commands.
 * - Use trusted tenant/actor context established by middleware.
 * - Never trust userId / tenantId from request input.
 * - Never access the database directly.
 * - Never calculate referral rewards.
 * - Never perform financial mutations.
 * - Preserve request/correlation metadata.
 * - Return stable API responses.
 *
 * Expected route context
 * ----------------------------------------------------------------------------
 * req.tenantId
 * req.referralActorId
 * req.requestId
 * req.correlationId
 *
 * Expected service
 * ----------------------------------------------------------------------------
 * ../services/referral/referral.service
 *
 * The service owns:
 * - referral creation
 * - duplicate detection
 * - referral eligibility
 * - referral state transitions
 * - reward eligibility
 * - idempotency
 * - audit/event publication
 * - tenant-scoped persistence
 *
 * ============================================================================
 */

const referralService = require(
    '../services/referral/referral.service',
);

/**
 * ============================================================================
 * Contracts
 * ============================================================================
 */

if (
    !referralService ||
    typeof referralService.createReferral !== 'function' ||
    typeof referralService.getUserReferrals !== 'function'
) {
    throw new TypeError(
        '[TITechReferralController] Referral service contract is invalid.',
    );
}

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function normalizeString(value, fallback = null) {
    if (value === undefined || value === null) {
        return fallback;
    }

    const normalized = String(value).trim();

    return normalized || fallback;
}

function getTrustedContext(req) {
    const tenantId =
        normalizeString(req.tenantId) ??
        normalizeString(req.adminContext?.tenantId);

    const actorId =
        normalizeString(req.referralActorId) ??
        normalizeString(req.adminContext?.actorId);

    return {
        tenantId,
        actorId,
    };
}

function buildMeta(req) {
    return {
        requestId:
            normalizeString(req.requestId),

        correlationId:
            normalizeString(req.correlationId),
    };
}

function sendSuccess(
    res,
    statusCode,
    data,
    meta,
) {
    return res.status(statusCode).json({
        success: true,
        data,
        ...meta,
        timestamp: new Date().toISOString(),
    });
}

/**
 * ============================================================================
 * POST /api/referrals
 * ============================================================================
 */

exports.createReferral = async function createReferral(
    req,
    res,
    next,
) {
    try {
        const { tenantId, actorId } =
            getTrustedContext(req);

        if (!tenantId) {
            return res
                .status(403)
                .json({
                    success: false,
                    code:
                        'REFERRAL_TENANT_CONTEXT_REQUIRED',
                    message:
                        'A trusted tenant context is required.',
                    ...buildMeta(req),
                    timestamp:
                        new Date().toISOString(),
                });
        }

        if (!actorId) {
            return res
                .status(401)
                .json({
                    success: false,
                    code:
                        'REFERRAL_ACTOR_CONTEXT_REQUIRED',
                    message:
                        'An authenticated actor context is required.',
                    ...buildMeta(req),
                    timestamp:
                        new Date().toISOString(),
                });
        }

        /**
         * The route has already validated and normalized these fields.
         *
         * Do not read userId or tenantId from req.body.
         */

        const command = {
            tenantId,
            actorId,

            email: normalizeString(
                req.body?.email,
            )?.toLowerCase(),

            name: normalizeString(
                req.body?.name,
            ),

            phone: normalizeString(
                req.body?.phone,
            ),

            note: normalizeString(
                req.body?.note,
            ),

            requestId:
                normalizeString(
                    req.requestId,
                ),

            correlationId:
                normalizeString(
                    req.correlationId,
                ),

            /**
             * Keep idempotency input available to the application layer.
             *
             * The middleware should preferably expose a canonical value on
             * req.idempotencyKey rather than requiring the service to inspect
             * raw HTTP headers.
             */
            idempotencyKey:
                normalizeString(
                    req.idempotencyKey,
                ) ??
                normalizeString(
                    req.headers?.[
                        'idempotency-key'
                    ],
                ),
        };

        const result =
            await referralService.createReferral(
                command,
            );

        return sendSuccess(
            res,
            result?.created
                ? 201
                : 200,
            result,
            buildMeta(req),
        );
    } catch (error) {
        return next(error);
    }
};

/**
 * ============================================================================
 * GET /api/referrals
 * ============================================================================
 */

exports.getUserReferrals =
    async function getUserReferrals(
        req,
        res,
        next,
    ) {
        try {
            const { tenantId, actorId } =
                getTrustedContext(req);

            if (!tenantId) {
                return res
                    .status(403)
                    .json({
                        success: false,
                        code:
                            'REFERRAL_TENANT_CONTEXT_REQUIRED',
                        message:
                            'A trusted tenant context is required.',
                        ...buildMeta(req),
                        timestamp:
                            new Date().toISOString(),
                    });
            }

            if (!actorId) {
                return res
                    .status(401)
                    .json({
                        success: false,
                        code:
                            'REFERRAL_ACTOR_CONTEXT_REQUIRED',
                        message:
                            'An authenticated actor context is required.',
                        ...buildMeta(req),
                        timestamp:
                            new Date().toISOString(),
                    });
            }

            const page =
                Number.parseInt(
                    req.query?.page,
                    10,
                ) || 1;

            const limit =
                Number.parseInt(
                    req.query?.limit,
                    10,
                ) || 50;

            const result =
                await referralService.getUserReferrals({
                    tenantId,
                    actorId,
                    page,
                    limit,
                    requestId:
                        normalizeString(
                            req.requestId,
                        ),
                    correlationId:
                        normalizeString(
                            req.correlationId,
                        ),
                });

            return sendSuccess(
                res,
                200,
                result,
                buildMeta(req),
            );
        } catch (error) {
            return next(error);
        }
    };