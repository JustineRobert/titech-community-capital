import crypto from "node:crypto";
import express from "express";
import rateLimit from "express-rate-limit";
import { param, validationResult } from "express-validator";
import authMiddleware from "../middleware/auth.js";
import groupController from "../controllers/groupController.js";

const router = express.Router({ caseSensitive: false, strict: false });
const { authenticate, requireRole } = authMiddleware;

function asyncHandler(handler) {
  return (req, res, next) =>
    Promise.resolve(handler(req, res, next)).catch(next);
}

function limiter({ windowMs = 60_000, max, code, message }) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) =>
      String(req.user?.id || req.ip || "unknown"),
    handler: (req, res) =>
      res.status(429).json({
        success: false,
        code,
        message,
        retryAfter: Math.ceil(windowMs / 1000),
        requestId: req.requestId,
        correlationId: req.correlationId,
      }),
  });
}

const readLimiter = limiter({
  max: Number(process.env.TITECH_GROUP_READ_RATE_LIMIT) || 120,
  code: "GROUP_READ_RATE_LIMITED",
  message: "Too many group queries. Please try again later.",
});
const writeLimiter = limiter({
  max: Number(process.env.TITECH_GROUP_WRITE_RATE_LIMIT) || 30,
  code: "GROUP_WRITE_RATE_LIMITED",
  message: "Too many group operation requests. Please try again later.",
});
const invitationLimiter = limiter({
  max: Number(process.env.TITECH_GROUP_INVITATION_RATE_LIMIT) || 10,
  code: "GROUP_INVITATION_RATE_LIMITED",
  message: "Too many group invitation requests. Please try again later.",
});

function validateGroupId(parameterName) {
  return [
    param(parameterName)
      .isMongoId()
      .withMessage(`${parameterName} must be a valid group ID`),
    (req, res, next) => {
      const errors = validationResult(req);
      if (errors.isEmpty()) {
        return next();
      }

      return res.status(400).json({
        success: false,
        code: "GROUP_ID_INVALID",
        message: "The group ID is invalid.",
        details: errors.array().map(({ path, msg }) => ({ path, msg })),
        requestId: req.requestId,
        correlationId: req.correlationId,
      });
    },
  ];
}

function requireTenantContext(req, res, next) {
  const tenantId =
    req.authenticatedTenantId ||
    req.auth?.tenantId ||
    req.user?.tenantId;

  if (!tenantId) {
    return res.status(403).json({
      success: false,
      code: "GROUP_TENANT_CONTEXT_REQUIRED",
      message:
        "Join an existing tenant with an invitation code before using groups.",
      requestId: req.requestId,
      correlationId: req.correlationId,
    });
  }

  req.tenantId = tenantId;
  return next();
}

function requestMetadata(req, res, next) {
  req.requestId =
    req.requestId ||
    req.headers["x-request-id"] ||
    crypto.randomUUID();
  req.correlationId =
    req.correlationId ||
    req.headers["x-correlation-id"] ||
    req.requestId;
  res.setHeader("X-Request-Id", req.requestId);
  res.setHeader("X-Correlation-Id", req.correlationId);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  return next();
}

router.use(requestMetadata);
router.use(
  express.json({
    limit: process.env.TITECH_GROUPS_BODY_LIMIT || "512kb",
    strict: true,
  })
);
router.use(authenticate);
router.use(requireTenantContext);

router.get(
  "/health",
  readLimiter,
  (_req, res) =>
    res.status(200).json({
      success: true,
      service: "TITech Groups API",
      status: "UP",
    })
);

router.post("/", writeLimiter, asyncHandler(groupController.createGroup));
router.post(
  "/join/:id",
  writeLimiter,
  ...validateGroupId("id"),
  asyncHandler(groupController.joinGroup)
);
router.get("/", readLimiter, asyncHandler(groupController.getGroups));
router.get(
  "/:id",
  readLimiter,
  ...validateGroupId("id"),
  asyncHandler(groupController.getGroupById)
);
router.post(
  "/:groupId/send-invitations",
  invitationLimiter,
  ...validateGroupId("groupId"),
  asyncHandler(groupController.sendBatchInvitations)
);
router.delete(
  "/:id/leave",
  writeLimiter,
  ...validateGroupId("id"),
  asyncHandler(groupController.leaveGroup)
);

router.use((req, res) =>
  res.status(404).json({
    success: false,
    code: "GROUP_ROUTE_NOT_FOUND",
    message: "Group endpoint not found.",
    requestId: req.requestId,
    correlationId: req.correlationId,
  })
);

router.use((error, req, res, next) => {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode =
    Number(error?.statusCode) >= 400 &&
    Number(error?.statusCode) < 600
      ? Number(error.statusCode)
      : 500;
  const clientError = statusCode < 500;

  if (!clientError) {
    console.error("[TITechGroupsRoutes] Group request failed", {
      requestId: req.requestId,
      error,
    });
  }

  return res.status(statusCode).json({
    success: false,
    code: error?.code || (clientError ? "GROUP_REQUEST_ERROR" : "GROUP_INTERNAL_ERROR"),
    message: clientError
      ? error.message || "The group request could not be completed."
      : "The group request could not be completed.",
    ...(clientError && error?.details ? { details: error.details } : {}),
    requestId: req.requestId,
    correlationId: req.correlationId,
  });
});

export default router;
