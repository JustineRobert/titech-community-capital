'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Controller
 * ============================================================================
 *
 * File:
 * backend/modules/onboarding/onboarding.controller.js
 *
 * Purpose:
 * HTTP controller layer for the enterprise SACCO onboarding lifecycle.
 *
 * Responsibilities:
 *   - Request validation boundary
 *   - Tenant context propagation
 *   - Authentication context propagation
 *   - Correlation/request tracing
 *   - Delegation to OnboardingService
 *   - Audit event recording
 *   - Structured logging
 *   - Standardized API responses
 *   - Centralized error propagation
 *
 * Architectural Rule:
 *   Controllers MUST NOT contain business logic.
 *
 * Flow:
 *
 * HTTP Request
 *      ↓
 * Controller
 *      ↓
 * OnboardingService
 *      ↓
 * Repository / Domain Services
 *      ↓
 * Persistence
 *
 * Audit:
 *
 * Controller
 *      ↓
 * AuditService
 *
 * Logging:
 *
 * Controller
 *      ↓
 * Structured Logger
 *
 * ============================================================================
 */

const httpStatus = require('http-status');

const OnboardingService = require('./onboarding.service');

const {
    successResponse
} = require('../../shared/utils/apiResponse');

const AuditService = require('../../audit/audit.service');

const logger = require('../../shared/logger');

/**
 * ============================================================================
 * CONTROLLER CONSTANTS
 * ============================================================================
 */

const ENTITY = Object.freeze({
    SACCO: 'SACCO',
    SUBSCRIPTION: 'SUBSCRIPTION',
    DOCUMENT: 'DOCUMENT'
});

const AUDIT_ACTIONS = Object.freeze({
    SACCO_REGISTERED: 'SACCO_REGISTERED',
    KYC_APPROVED: 'KYC_APPROVED',
    SUBSCRIPTION_CREATED: 'SUBSCRIPTION_CREATED',
    SACCO_GO_LIVE: 'SACCO_GO_LIVE',
    DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
    APPLICATION_REJECTED: 'APPLICATION_REJECTED'
});

/**
 * ============================================================================
 * REQUEST CONTEXT HELPERS
 * ============================================================================
 */

/**
 * Resolve the authenticated user ID.
 *
 * Supports both:
 *
 * req.user.id
 * req.user._id
 *
 * without changing the existing authentication contract.
 */
const getUserId = (req) => {
    return req?.user?.id || req?.user?._id || null;
};

/**
 * Resolve tenant ID from the request context.
 *
 * Tenant context should normally be established by tenant middleware.
 *
 * The controller intentionally does not attempt to derive tenant identity
 * from arbitrary request body fields because that could permit cross-tenant
 * access if upstream validation is bypassed.
 */
const getTenantId = (req, fallback = null) => {
    return req?.tenantId || fallback || null;
};

/**
 * Resolve correlation ID.
 *
 * Prefer middleware-generated correlation IDs where available.
 */
const getCorrelationId = (req) => {
    return (
        req?.correlationId ||
        req?.headers?.['x-correlation-id'] ||
        req?.headers?.['x-request-id'] ||
        null
    );
};

/**
 * Build standardized audit context.
 */
const buildAuditContext = (
    req,
    {
        tenantId,
        entity,
        entityId,
        action,
        metadata = {}
    }
) => ({
    tenantId,
    userId: getUserId(req),
    entity,
    entityId,
    action,
    ipAddress: req?.ip,
    userAgent: req?.headers?.['user-agent'],
    correlationId: getCorrelationId(req),
    metadata
});

/**
 * ============================================================================
 * AUDIT HELPER
 * ============================================================================
 *
 * Audit logging is centralized here so all onboarding endpoints generate
 * consistent audit records.
 *
 * Audit failure is intentionally allowed to propagate.
 *
 * For regulated financial systems, silently swallowing an audit failure can
 * create an operational state where a sensitive action succeeds without the
 * required audit evidence.
 */
const recordAudit = async (
    req,
    {
        tenantId,
        entity,
        entityId,
        action,
        metadata = {}
    }
) => {
    return AuditService.log(
        buildAuditContext(req, {
            tenantId,
            entity,
            entityId,
            action,
            metadata
        })
    );
};

/**
 * ============================================================================
 * STRUCTURED ERROR LOGGING
 * ============================================================================
 */

const logControllerError = (
    operation,
    error,
    req,
    additionalContext = {}
) => {
    logger.error(
        `OnboardingController.${operation} failed`,
        {
            operation,
            correlationId: getCorrelationId(req),
            tenantId: getTenantId(req),
            userId: getUserId(req),
            requestId: req?.id || null,
            error: error?.message,
            errorName: error?.name,
            errorCode: error?.code,
            ...additionalContext
        }
    );
};

/**
 * ============================================================================
 * REGISTER SACCO
 * ============================================================================
 *
 * POST /onboarding/sacco
 *
 * Registers a new SACCO onboarding application.
 */
exports.registerSacco = async (req, res, next) => {
    const correlationId = getCorrelationId(req);

    try {
        const tenantId = getTenantId(req);

        const payload = {
            ...req.body,

            createdBy: getUserId(req),

            tenantId
        };

        const sacco =
            await OnboardingService.registerSacco(payload);

        await recordAudit(req, {
            tenantId: sacco?.tenantId || tenantId,
            entity: ENTITY.SACCO,
            entityId: sacco?._id,
            action: AUDIT_ACTIONS.SACCO_REGISTERED,
            metadata: {
                saccoName: sacco?.saccoName,
                correlationId
            }
        });

        logger.info(
            'SACCO registered successfully',
            {
                correlationId,
                tenantId: sacco?.tenantId || tenantId,
                saccoId: sacco?._id,
                saccoName: sacco?.saccoName,
                userId: getUserId(req)
            }
        );

        return res
            .status(httpStatus.CREATED)
            .json(
                successResponse(
                    'SACCO registered successfully',
                    sacco
                )
            );
    } catch (error) {
        logControllerError(
            'registerSacco',
            error,
            req
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * GET SACCO BY ID
 * ============================================================================
 *
 * GET /onboarding/sacco/:id
 */
exports.getSaccoById = async (
    req,
    res,
    next
) => {
    try {
        const tenantId = getTenantId(req);

        const sacco =
            await OnboardingService.getSaccoById(
                req.params.id,
                tenantId
            );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'SACCO retrieved successfully',
                    sacco
                )
            );
    } catch (error) {
        logControllerError(
            'getSaccoById',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * LIST SACCOs
 * ============================================================================
 *
 * GET /onboarding/saccos
 *
 * Supports:
 *   - page
 *   - limit
 *   - search
 *   - status
 *
 * Tenant context is always propagated.
 */
exports.getAllSaccos = async (
    req,
    res,
    next
) => {
    try {
        const tenantId = getTenantId(req);

        const page = Number.parseInt(
            req.query.page,
            10
        ) || 1;

        const limit = Number.parseInt(
            req.query.limit,
            10
        ) || 20;

        const result =
            await OnboardingService.getAllSaccos({
                page,
                limit,
                search: req.query.search,
                status: req.query.status,
                tenantId
            });

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'SACCOs retrieved successfully',
                    result
                )
            );
    } catch (error) {
        logControllerError(
            'getAllSaccos',
            error,
            req
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * VERIFY KYC
 * ============================================================================
 *
 * POST /onboarding/sacco/:id/kyc/verify
 */
exports.verifyKYC = async (
    req,
    res,
    next
) => {
    try {
        const sacco =
            await OnboardingService.verifyKYC(
                req.params.id,
                req.body,
                req.user
            );

        const tenantId =
            sacco?.tenantId ||
            getTenantId(req);

        await recordAudit(req, {
            tenantId,
            entity: ENTITY.SACCO,
            entityId: sacco?._id || req.params.id,
            action: AUDIT_ACTIONS.KYC_APPROVED,
            metadata: {
                onboardingSaccoId:
                    req.params.id
            }
        });

        logger.info(
            'SACCO KYC verification completed',
            {
                correlationId:
                    getCorrelationId(req),
                tenantId,
                saccoId:
                    sacco?._id || req.params.id,
                userId:
                    getUserId(req)
            }
        );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'KYC verification completed',
                    sacco
                )
            );
    } catch (error) {
        logControllerError(
            'verifyKYC',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * SETUP SUBSCRIPTION
 * ============================================================================
 *
 * POST /onboarding/sacco/:id/subscription
 */
exports.setupSubscription = async (
    req,
    res,
    next
) => {
    try {
        const subscription =
            await OnboardingService.setupSubscription(
                req.params.id,
                req.body,
                req.user
            );

        const tenantId =
            subscription?.tenantId ||
            getTenantId(req);

        await recordAudit(req, {
            tenantId,
            entity: ENTITY.SUBSCRIPTION,
            entityId: subscription?._id,
            action: AUDIT_ACTIONS.SUBSCRIPTION_CREATED,
            metadata: {
                saccoId: req.params.id
            }
        });

        logger.info(
            'SACCO subscription configured successfully',
            {
                correlationId:
                    getCorrelationId(req),
                tenantId,
                saccoId:
                    req.params.id,
                subscriptionId:
                    subscription?._id,
                userId:
                    getUserId(req)
            }
        );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'Subscription configured successfully',
                    subscription
                )
            );
    } catch (error) {
        logControllerError(
            'setupSubscription',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * GO LIVE
 * ============================================================================
 *
 * POST /onboarding/sacco/:id/go-live
 */
exports.goLive = async (
    req,
    res,
    next
) => {
    try {
        const liveSacco =
            await OnboardingService.goLive(
                req.params.id,
                req.user
            );

        const tenantId =
            liveSacco?.tenantId ||
            getTenantId(req);

        await recordAudit(req, {
            tenantId,
            entity: ENTITY.SACCO,
            entityId:
                liveSacco?._id ||
                req.params.id,
            action: AUDIT_ACTIONS.SACCO_GO_LIVE,
            metadata: {
                previousStatus:
                    req.body?.previousStatus || null,
                newStatus: 'LIVE'
            }
        });

        logger.info(
            'SACCO transitioned to LIVE',
            {
                correlationId:
                    getCorrelationId(req),
                tenantId,
                saccoId:
                    liveSacco?._id ||
                    req.params.id,
                userId:
                    getUserId(req)
            }
        );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'SACCO is now LIVE',
                    liveSacco
                )
            );
    } catch (error) {
        logControllerError(
            'goLive',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * GET ONBOARDING PROGRESS
 * ============================================================================
 *
 * GET /onboarding/sacco/:id/progress
 */
exports.getOnboardingProgress = async (
    req,
    res,
    next
) => {
    try {
        const progress =
            await OnboardingService.getProgress(
                req.params.id
            );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'Onboarding progress retrieved',
                    progress
                )
            );
    } catch (error) {
        logControllerError(
            'getOnboardingProgress',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * UPLOAD KYC DOCUMENTS
 * ============================================================================
 *
 * POST /onboarding/sacco/:id/documents
 *
 * req.files is intentionally passed untouched to the service because the
 * configured upload middleware owns file normalization and validation.
 */
exports.uploadDocuments = async (
    req,
    res,
    next
) => {
    try {
        const documents =
            await OnboardingService.uploadDocuments(
                req.params.id,
                req.files,
                req.user
            );

        const tenantId =
            documents?.tenantId ||
            getTenantId(req);

        await recordAudit(req, {
            tenantId,
            entity: ENTITY.DOCUMENT,
            entityId: req.params.id,
            action: AUDIT_ACTIONS.DOCUMENT_UPLOADED,
            metadata: {
                saccoId: req.params.id,
                documentCount: Array.isArray(documents)
                    ? documents.length
                    : undefined
            }
        });

        logger.info(
            'SACCO onboarding documents uploaded',
            {
                correlationId:
                    getCorrelationId(req),
                tenantId,
                saccoId:
                    req.params.id,
                documentCount:
                    Array.isArray(documents)
                        ? documents.length
                        : undefined,
                userId:
                    getUserId(req)
            }
        );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'Documents uploaded successfully',
                    documents
                )
            );
    } catch (error) {
        logControllerError(
            'uploadDocuments',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * REJECT SACCO APPLICATION
 * ============================================================================
 *
 * POST /onboarding/sacco/:id/reject
 */
exports.rejectApplication = async (
    req,
    res,
    next
) => {
    try {
        const reason =
            typeof req.body?.reason === 'string'
                ? req.body.reason.trim()
                : req.body?.reason;

        const result =
            await OnboardingService.rejectApplication(
                req.params.id,
                reason,
                req.user
            );

        const tenantId =
            result?.tenantId ||
            getTenantId(req);

        await recordAudit(req, {
            tenantId,
            entity: ENTITY.SACCO,
            entityId:
                result?._id ||
                req.params.id,
            action: AUDIT_ACTIONS.APPLICATION_REJECTED,
            metadata: {
                reason
            }
        });

        logger.warn(
            'SACCO onboarding application rejected',
            {
                correlationId:
                    getCorrelationId(req),
                tenantId,
                saccoId:
                    result?._id ||
                    req.params.id,
                userId:
                    getUserId(req),
                reason
            }
        );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'Application rejected',
                    result
                )
            );
    } catch (error) {
        logControllerError(
            'rejectApplication',
            error,
            req,
            {
                saccoId: req.params.id
            }
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * ONBOARDING DASHBOARD METRICS
 * ============================================================================
 *
 * GET /onboarding/metrics
 */
exports.getOnboardingMetrics = async (
    req,
    res,
    next
) => {
    try {
        const tenantId = getTenantId(req);

        const metrics =
            await OnboardingService.metrics(
                tenantId
            );

        return res
            .status(httpStatus.OK)
            .json(
                successResponse(
                    'Metrics retrieved successfully',
                    metrics
                )
            );
    } catch (error) {
        logControllerError(
            'getOnboardingMetrics',
            error,
            req
        );

        return next(error);
    }
};

/**
 * ============================================================================
 * MODULE EXPORTS
 * ============================================================================
 *
 * CommonJS named exports are intentionally preserved so existing routes can
 * continue using:
 *
 *   const {
 *       registerSacco,
 *       getSaccoById,
 *       ...
 *   } = require('./onboarding.controller');
 *
 * ============================================================================
 */
