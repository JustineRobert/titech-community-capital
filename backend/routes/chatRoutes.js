'use strict';

/**
 * ============================================================================
 * TITechChat ROUTES
 * ============================================================================
 *
 * File:
 *   backend/routes/chatRoutes.js
 *
 * Organization:
 *   TITech Community Capital Ltd
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Enterprise routing boundary for TITechChat.
 *
 * Security / governance
 * ----------------------------------------------------------------------------
 * ✓ Authentication and RBAC
 * ✓ Tenant-aware conversation access
 * ✓ Conversation participant enforcement
 * ✓ Attachment validation
 * ✓ Message sanitization
 * ✓ Abuse/rate limiting
 * ✓ Entity-linked conversation governance
 * ✓ Support-thread controls
 * ✓ Announcement controls
 * ✓ Compliance/export controls
 * ✓ Request / correlation tracing
 * ✓ Fail-closed dependency validation
 * ✓ Centralized error normalization
 *
 * Architecture rule
 * ----------------------------------------------------------------------------
 * Routes remain thin.
 *
 * Business logic MUST remain in:
 *
 *   controllers
 *   services
 *   domain policies
 *   repositories
 *
 * This router MUST NOT:
 *
 *   ✗ access MongoDB directly
 *   ✗ modify conversations directly
 *   ✗ implement financial business rules
 *   ✗ trust client-supplied tenant identity
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All legacy ACFOS terminology has been replaced with TITech.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

const asyncHandler =
  require('../utils/asyncHandler');

const router =
  express.Router({
    strict: false,
    caseSensitive: false,
  });

/**
 * ============================================================================
 * METADATA
 * ============================================================================
 */

const ROUTER_NAME =
  'TITechChatRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITechChat';

const DEFAULT_BODY_LIMIT =
  process.env.TITECH_CHAT_BODY_LIMIT ||
  '2mb';

const MAX_ROUTE_ID_LENGTH =
  200;

/**
 * ============================================================================
 * CONTROLLERS
 * ============================================================================
 */

const conversationController =
  require('../controllers/chat/conversationController');

const messageController =
  require('../controllers/chat/messageController');

const supportController =
  require('../controllers/chat/supportThreadController');

const announcementController =
  require('../controllers/chat/announcementController');

const exportController =
  require('../controllers/chat/exportController');

/**
 * ============================================================================
 * CONTROLLER CONTRACT VALIDATION
 * ============================================================================
 */

const REQUIRED_CONTROLLERS = Object.freeze({
  conversationController: [
    'createConversation',
    'myConversations',
    'getConversation',
    'archiveConversation',
    'lockConversation',
  ],

  messageController: [
    'sendMessage',
    'editMessage',
    'deleteMessage',
  ],

  supportController: [
    'createSupportThread',
  ],

  announcementController: [
    'postAnnouncement',
    'getAnnouncements',
  ],

  exportController: [
    'requestExport',
    'getExport',
    'listExports',
  ],
});

function validateControllerContract(
  controller,
  controllerName,
  methods,
) {
  if (
    !controller ||
    typeof controller !==
      'object'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] ${controllerName} is not available.`,
    );
  }

  for (
    const method of methods
  ) {
    if (
      typeof controller[
        method
      ] !==
      'function'
    ) {
      throw new TypeError(
        `[${ROUTER_NAME}] Missing ${controllerName}.${method} export.`,
      );
    }
  }
}

for (
  const [
    name,
    methods,
  ] of Object.entries(
    REQUIRED_CONTROLLERS,
  )
) {
  const controller =
    {
      conversationController,
      messageController,
      supportController,
      announcementController,
      exportController,
    }[name];

  validateControllerContract(
    controller,
    name,
    methods,
  );
}

/**
 * ============================================================================
 * MIDDLEWARE
 * ============================================================================
 */

const chatAuth =
  require('../middleware/chatAuthorization');

const conversationAccess =
  require('../middleware/conversationAccess');

const {
  requireParticipant,
} =
  conversationAccess;

const attachmentValidation =
  require('../middleware/attachmentValidation');

const messageSanitizer =
  require('../middleware/messageSanitizer');

const chatRateLimit =
  require('../middleware/chatRateLimit');

/**
 * ============================================================================
 * MIDDLEWARE CONTRACT VALIDATION
 * ============================================================================
 */

function requireMiddleware(
  middleware,
  name,
) {
  if (
    typeof middleware !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] ${name} middleware must be a function.`,
    );
  }

  return middleware;
}

requireMiddleware(
  chatAuth,
  'chatAuth',
);

requireMiddleware(
  requireParticipant,
  'requireParticipant',
);

requireMiddleware(
  attachmentValidation,
  'attachmentValidation',
);

requireMiddleware(
  messageSanitizer,
  'messageSanitizer',
);

requireMiddleware(
  chatRateLimit,
  'chatRateLimit',
);

/**
 * ============================================================================
 * REQUEST / CORRELATION METADATA
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value ===
      undefined ||
    value ===
      null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return (
    normalized ||
    fallback
  );
}

function requestMetadata(
  req,
  res,
  next,
) {
  const requestId =
    normalizeString(
      req.requestId,
    ) ||
    normalizeString(
      req.id,
    ) ||
    normalizeString(
      req.headers?.[
        'x-request-id'
      ],
    ) ||
    crypto.randomUUID();

  const correlationId =
    normalizeString(
      req.correlationId,
    ) ||
    normalizeString(
      req.headers?.[
        'x-correlation-id'
      ],
    ) ||
    requestId;

  req.requestId =
    requestId;

  req.correlationId =
    correlationId;

  res.setHeader(
    'X-Request-Id',
    requestId,
  );

  res.setHeader(
    'X-Correlation-Id',
    correlationId,
  );

  next();
}

router.use(
  requestMetadata,
);

/**
 * ============================================================================
 * SECURITY HEADERS
 * ============================================================================
 */

router.use(
  (
    req,
    res,
    next,
  ) => {
    res.setHeader(
      'X-Content-Type-Options',
      'nosniff',
    );

    res.setHeader(
      'Referrer-Policy',
      'no-referrer',
    );

    res.setHeader(
      'X-Frame-Options',
      'DENY',
    );

    /**
     * Chat data is private communication and should not be browser/proxy
     * cached.
     */
    res.setHeader(
      'Cache-Control',
      'no-store',
    );

    res.setHeader(
      'Pragma',
      'no-cache',
    );

    next();
  },
);

/**
 * ============================================================================
 * BODY PARSER
 * ============================================================================
 *
 * The application may already configure express.json(). This router-level
 * parser is intentionally bounded for defense in depth.
 *
 * IMPORTANT:
 * If file uploads use multipart/form-data, the attachment middleware must
 * continue to own multipart parsing.
 * ============================================================================
 */

router.use(
  express.json({
    limit:
      DEFAULT_BODY_LIMIT,

    strict:
      true,
  }),
);

/**
 * ============================================================================
 * PARAMETER VALIDATION
 * ============================================================================
 */

function validateRouteId(
  parameterName,
) {
  return (
    req,
    res,
    next,
  ) => {
    const value =
      normalizeString(
        req.params?.[
          parameterName
        ],
      );

    if (
      !value
    ) {
      return res.status(
        400,
      ).json({
        success:
          false,

        code:
          'CHAT_ROUTE_PARAMETER_REQUIRED',

        message:
          `${parameterName} is required.`,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    if (
      value.length >
      MAX_ROUTE_ID_LENGTH
    ) {
      return res.status(
        400,
      ).json({
        success:
          false,

        code:
          'CHAT_ROUTE_PARAMETER_TOO_LONG',

        message:
          `${parameterName} exceeds the maximum supported length.`,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    if (
      /[\u0000-\u001F\u007F]/.test(
        value,
      )
    ) {
      return res.status(
        400,
      ).json({
        success:
          false,

        code:
          'CHAT_INVALID_ROUTE_PARAMETER',

        message:
          `${parameterName} contains unsupported characters.`,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    req.validatedParams =
      {
        ...(
          req.validatedParams ||
          {}
        ),

        [parameterName]:
          value,
      };

    return next();
  };
}

/**
 * ============================================================================
 * TENANT CONTEXT
 * ============================================================================
 *
 * Prefer the canonical TITech admin context when available.
 *
 * The fallback never trusts a tenantId supplied by the query/body.
 * ============================================================================
 */

let adminContextMiddleware =
  null;

try {
  const adminContext =
    require('../utils/admin/adminContext');

  if (
    typeof adminContext?.middleware ===
    'function'
  ) {
    adminContextMiddleware =
      adminContext.middleware({
        requiredTenant:
          true,

        requiredActor:
          true,

        service:
          'TITech Chat API',

        serviceVersion:
          ROUTER_VERSION,
      });
  }
} catch {
  adminContextMiddleware =
    null;
}

function fallbackTenantContext(
  req,
  res,
  next,
) {
  const tenantId =
    normalizeString(
      req.tenantId ||
        req.user?.tenantId ||
        req.auth?.tenantId,
    );

  const actorId =
    normalizeString(
      req.user?.id ||
        req.user?._id ||
        req.user?.userId ||
        req.auth?.userId,
    );

  if (
    !tenantId
  ) {
    return res.status(
      403,
    ).json({
      success:
        false,

      code:
        'CHAT_TENANT_CONTEXT_REQUIRED',

      message:
        'A trusted tenant context is required for chat operations.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    !actorId
  ) {
    return res.status(
      401,
    ).json({
      success:
        false,

      code:
        'CHAT_ACTOR_CONTEXT_REQUIRED',

      message:
        'An authenticated actor context is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  req.tenantId =
    tenantId;

  req.adminContext =
    {
      tenantId,

      actorId,

      userId:
        actorId,

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    };

  return next();
}

router.use(
  adminContextMiddleware ||
    fallbackTenantContext,
);

/**
 * ============================================================================
 * HEALTH CHECK
 * ============================================================================
 *
 * Health is intentionally lightweight.
 *
 * It confirms the router is mounted; deep dependency readiness belongs to a
 * system health service.
 * ============================================================================
 */

router.get(
  '/health',
  (
    req,
    res,
  ) => {
    return res.status(
      200,
    ).json({
      success:
        true,

      service:
        SERVICE_NAME,

      version:
        ROUTER_VERSION,

      status:
        'UP',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    });
  },
);

/**
 * ============================================================================
 * AUTHENTICATED CHAT ROUTES
 * ============================================================================
 *
 * Authentication/RBAC is handled centrally by chatAuth.
 * ============================================================================
 */

router.use(
  chatAuth,
);

/**
 * ============================================================================
 * CONVERSATIONS
 * ============================================================================
 */

/**
 * Create conversation.
 *
 * The controller must enforce that the requested conversation type is
 * permitted and that any entity linkage belongs to the current tenant.
 */
router.post(
  '/conversations',

  chatRateLimit,

  conversationControllerGuard(
    conversationController
      .createConversation,
  ),

  conversationController.createConversation,
);

/**
 * List current user's conversations.
 */
router.get(
  '/conversations',

  chatRateLimit,

  conversationControllerGuard(
    conversationController
      .myConversations,
  ),

  conversationController.myConversations,
);

/**
 * Get one conversation.
 *
 * `requireParticipant` remains mandatory so a valid conversation ID alone is
 * insufficient to access private content.
 */
router.get(
  '/conversations/:conversationId',

  chatRateLimit,

  validateRouteId(
    'conversationId',
  ),

  requireParticipant,

  conversationControllerGuard(
    conversationController
      .getConversation,
  ),

  conversationController.getConversation,
);

/**
 * Archive conversation.
 *
 * Participant-level access is retained; the service should enforce whether the
 * current participant has archive authority for that conversation.
 */
router.patch(
  '/conversations/:conversationId/archive',

  chatRateLimit,

  validateRouteId(
    'conversationId',
  ),

  requireParticipant,

  conversationControllerGuard(
    conversationController
      .archiveConversation,
  ),

  conversationController.archiveConversation,
);

/**
 * Lock conversation.
 *
 * Locking is a compliance-sensitive operation. The controller/service MUST
 * perform the final authorization decision based on actor role and conversation
 * state.
 */
router.patch(
  '/conversations/:conversationId/lock',

  chatRateLimit,

  validateRouteId(
    'conversationId',
  ),

  requireParticipant,

  conversationControllerGuard(
    conversationController
      .lockConversation,
  ),

  conversationController.lockConversation,
);

/**
 * ============================================================================
 * MESSAGES
 * ============================================================================
 */

/**
 * Send message.
 *
 * Pipeline:
 *
 *   auth
 *   participant access
 *   rate-limit
 *   sanitize
 *   attachment validation
 *   controller
 */
router.post(
  '/conversations/:id/messages',

  validateRouteId(
    'id',
  ),

  requireParticipant,

  chatRateLimit,

  messageSanitizer,

  attachmentValidation,

  messageControllerGuard(
    messageController
      .sendMessage,
  ),

  messageController.sendMessage,
);

/**
 * Edit message.
 *
 * The controller/service must enforce ownership/authorization and tenant scope.
 */
router.patch(
  '/messages/:messageId',

  validateRouteId(
    'messageId',
  ),

  chatRateLimit,

  messageSanitizer,

  messageControllerGuard(
    messageController
      .editMessage,
  ),

  messageController.editMessage,
);

/**
 * Delete message.
 *
 * The existing controller is expected to perform soft deletion rather than
 * physical destruction.
 */
router.delete(
  '/messages/:messageId',

  validateRouteId(
    'messageId',
  ),

  chatRateLimit,

  messageControllerGuard(
    messageController
      .deleteMessage,
  ),

  messageController.deleteMessage,
);

/**
 * ============================================================================
 * SUPPORT THREADS
 * ============================================================================
 */

router.post(
  '/support/threads',

  chatRateLimit,

  supportControllerGuard(
    supportController
      .createSupportThread,
  ),

  supportController.createSupportThread,
);

/**
 * ============================================================================
 * ANNOUNCEMENTS
 * ============================================================================
 *
 * `chatAuth` is retained as the primary RBAC boundary. The announcement
 * controller/service must distinguish who may publish versus merely read.
 */
router.post(
  '/announcements',

  chatRateLimit,

  announcementControllerGuard(
    announcementController
      .postAnnouncement,
  ),

  announcementController.postAnnouncement,
);

router.get(
  '/announcements/:conversationId',

  chatRateLimit,

  validateRouteId(
    'conversationId',
  ),

  requireParticipant,

  announcementControllerGuard(
    announcementController
      .getAnnouncements,
  ),

  announcementController.getAnnouncements,
);

/**
 * ============================================================================
 * EXPORTS / COMPLIANCE
 * ============================================================================
 */

/**
 * Request export.
 *
 * Participant access prevents arbitrary conversation exports.
 */
router.post(
  '/conversations/:conversationId/export',

  chatRateLimit,

  validateRouteId(
    'conversationId',
  ),

  requireParticipant,

  exportControllerGuard(
    exportController
      .requestExport,
  ),

  exportController.requestExport,
);

/**
 * Get export status.
 */
router.get(
  '/exports/:exportId',

  chatRateLimit,

  validateRouteId(
    'exportId',
  ),

  exportControllerGuard(
    exportController
      .getExport,
  ),

  exportController.getExport,
);

/**
 * List exports.
 */
router.get(
  '/exports',

  chatRateLimit,

  exportControllerGuard(
    exportController
      .listExports,
  ),

  exportController.listExports,
);

/**
 * ============================================================================
 * NOT FOUND
 * ============================================================================
 */

router.use(
  (
    req,
    res,
  ) => {
    return res.status(
      404,
    ).json({
      success:
        false,

      code:
        'CHAT_ROUTE_NOT_FOUND',

      message:
        'Chat endpoint not found.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    });
  },
);

/**
 * ============================================================================
 * CENTRALIZED ERROR HANDLER
 * ============================================================================
 */

router.use(
  (
    error,
    req,
    res,
    next,
  ) => {
    if (
      res.headersSent
    ) {
      return next(
        error,
      );
    }

    const statusCode =
      Number(
        error?.statusCode,
      ) >= 400 &&
      Number(
        error?.statusCode,
      ) < 600
        ? Number(
            error.statusCode,
          )
        : 500;

    const clientError =
      statusCode >= 400 &&
      statusCode < 500;

    const response = {
      success:
        false,

      code:
        normalizeString(
          error?.code,
        ) ||
        (
          clientError
            ? 'CHAT_REQUEST_ERROR'
            : 'CHAT_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The chat request could not be completed.'
            )
          : 'The chat request could not be completed.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,

      timestamp:
        new Date().toISOString(),
    };

    if (
      clientError &&
      error?.details
    ) {
      response.details =
        error.details;
    }

    return res
      .status(
        statusCode,
      )
      .json(
        response,
      );
  },
);

/**
 * ============================================================================
 * CONTROLLER GUARDS
 * ============================================================================
 *
 * These guards keep the router thin while ensuring that a malformed controller
 * import cannot silently result in an invalid route.
 * ============================================================================
 */

function conversationControllerGuard(
  handler,
) {
  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Invalid conversation controller handler.`,
    );
  }

  return (
    req,
    res,
    next,
  ) => {
    return next();
  };
}

function messageControllerGuard(
  handler,
) {
  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Invalid message controller handler.`,
    );
  }

  return (
    req,
    res,
    next,
  ) => {
    return next();
  };
}

function supportControllerGuard(
  handler,
) {
  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Invalid support controller handler.`,
    );
  }

  return (
    req,
    res,
    next,
  ) => {
    return next();
  };
}

function announcementControllerGuard(
  handler,
) {
  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Invalid announcement controller handler.`,
    );
  }

  return (
    req,
    res,
    next,
  ) => {
    return next();
  };
}

function exportControllerGuard(
  handler,
) {
  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Invalid export controller handler.`,
    );
  }

  return (
    req,
    res,
    next,
  ) => {
    return next();
  };
}

/**
 * ============================================================================
 * ROUTER METADATA
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

router.serviceName =
  SERVICE_NAME;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  router;