'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Chat Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/chat.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Secure routing boundary for TITech Community Capital conversations and
 * messaging functionality.
 *
 * Endpoints
 * ----------------------------------------------------------------------------
 *
 * Conversation:
 *   POST   /conversation
 *   GET    /conversations
 *   GET    /conversation/:id
 *   GET    /conversation/:id/messages
 *   POST   /conversation/:conversationId/pin/:messageId
 *   POST   /conversation/:id/archive
 *
 * Messages:
 *   POST   /message
 *   PUT    /message/:id
 *   DELETE /message/:id
 *
 * Search:
 *   GET    /messages/search
 *
 * Architecture
 * ----------------------------------------------------------------------------
 *
 *   HTTP Request
 *        ↓
 *   Request Metadata
 *        ↓
 *   Security Headers
 *        ↓
 *   Authentication
 *        ↓
 *   Tenant Context
 *        ↓
 *   Rate Limiting
 *        ↓
 *   Validation
 *        ↓
 *   Role / Permission Boundary
 *        ↓
 *   Controller
 *        ↓
 *   Chat Service
 *        ↓
 *   Repository
 *
 * This router MUST NOT:
 *
 *   ✗ access MongoDB directly
 *   ✗ manipulate conversations directly
 *   ✗ implement chat business rules
 *   ✗ bypass tenant isolation
 *   ✗ dynamically invoke arbitrary services
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All platform naming is kept consistent with TITech Community Capital.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

const rateLimit =
  require('express-rate-limit');

const chatController =
  require('../controllers/chatController');

const {
  createConversationValidator,
  sendMessageValidator,
  editMessageValidator,
} =
  require('../validators/chatValidator');

const {
  verifyToken,
  requireRole,
} =
  require('../middlewares/auth');

const asyncHandler =
  require('../utils/asyncHandler');

/**
 * ============================================================================
 * ROUTER
 * ============================================================================
 */

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
  'TITech Chat';

const DEFAULT_MESSAGE_RATE_LIMIT =
  60;

const DEFAULT_SEARCH_RATE_LIMIT =
  60;

const DEFAULT_READ_RATE_LIMIT =
  180;

const MAX_ROUTE_ID_LENGTH =
  200;

/**
 * ============================================================================
 * REQUIRED DEPENDENCY VALIDATION
 * ============================================================================
 */

if (
  typeof verifyToken !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] verifyToken middleware must be a function.`,
  );
}

if (
  typeof requireRole !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] requireRole middleware must be a function.`,
  );
}

if (
  typeof asyncHandler !==
  'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] asyncHandler must be a function.`,
  );
}

if (
  typeof createConversationValidator !==
    'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] createConversationValidator must be a function.`,
  );
}

if (
  typeof sendMessageValidator !==
    'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] sendMessageValidator must be a function.`,
  );
}

if (
  typeof editMessageValidator !==
    'function'
) {
  throw new TypeError(
    `[${ROUTER_NAME}] editMessageValidator must be a function.`,
  );
}

/**
 * ============================================================================
 * CONTROLLER CONTRACT
 * ============================================================================
 */

const REQUIRED_CONTROLLERS =
  Object.freeze([
    'createConversation',
    'listConversations',
    'getConversationById',
    'getConversationMessages',
    'sendMessage',
    'editMessage',
    'deleteMessageSoft',
    'searchMessages',
    'pinMessage',
    'archiveConversation',
  ]);

const controllers = {};

for (
  const name of
    REQUIRED_CONTROLLERS
) {
  const handler =
    chatController?.[
      name
    ];

  if (
    typeof handler !==
    'function'
  ) {
    throw new TypeError(
      `[${ROUTER_NAME}] Missing controller "${name}" export.`,
    );
  }

  controllers[name] =
    handler.bind(
      chatController,
    );
}

/**
 * ============================================================================
 * REQUEST METADATA
 * ============================================================================
 */

function normalizeString(
  value,
  fallback = null,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized =
    String(
      value,
    ).trim();

  return normalized || fallback;
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
     * Chat content may contain private communications.
     */
    res.setHeader(
      'Cache-Control',
      'no-store',
    );

    next();
  },
);

/**
 * ============================================================================
 * AUTHENTICATION
 * ============================================================================
 */

router.use(
  verifyToken,
);

/**
 * ============================================================================
 * TENANT / ADMIN CONTEXT
 * ============================================================================
 *
 * Uses the canonical TITech AdminContext when available. The fallback still
 * fails closed if no trusted tenant context exists.
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

if (
  adminContextMiddleware
) {
  router.use(
    adminContextMiddleware,
  );
} else {
  router.use(
    fallbackTenantContext,
  );
}

/**
 * ============================================================================
 * RATE LIMITERS
 * ============================================================================
 */

const messageRateLimit =
  createLimiter({
    max:
      getPositiveIntegerEnv(
        'TITECH_CHAT_MESSAGE_RATE_LIMIT',
        DEFAULT_MESSAGE_RATE_LIMIT,
      ),

    message:
      'Too many chat message requests. Please try again later.',

    code:
      'CHAT_MESSAGE_RATE_LIMITED',
  });

const searchRateLimit =
  createLimiter({
    max:
      getPositiveIntegerEnv(
        'TITECH_CHAT_SEARCH_RATE_LIMIT',
        DEFAULT_SEARCH_RATE_LIMIT,
      ),

    message:
      'Too many chat search requests. Please try again later.',

    code:
      'CHAT_SEARCH_RATE_LIMITED',
  });

const readRateLimit =
  createLimiter({
    max:
      getPositiveIntegerEnv(
        'TITECH_CHAT_READ_RATE_LIMIT',
        DEFAULT_READ_RATE_LIMIT,
      ),

    message:
      'Too many chat read requests. Please try again later.',

    code:
      'CHAT_READ_RATE_LIMITED',
  });

function getPositiveIntegerEnv(
  name,
  fallback,
) {
  const value =
    Number(
      process.env[name],
    );

  return Number.isInteger(
    value,
  ) &&
    value > 0
    ? value
    : fallback;
}

function createLimiter({
  max,
  message,
  code,
}) {
  return rateLimit({
    windowMs:
      60 * 1000,

    max,

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    keyGenerator(
      req,
    ) {
      return (
        normalizeString(
          req.user?.id ||
            req.user?._id ||
            req.user?.userId ||
            req.auth?.userId,
        ) ||
        normalizeString(
          req.ip,
        ) ||
        'unknown'
      );
    },

    handler(
      req,
      res,
    ) {
      const retryAfter =
        60;

      res.setHeader(
        'Retry-After',
        String(
          retryAfter,
        ),
      );

      return res.status(
        429,
      ).json({
        success:
          false,

        code,

        message,

        retryAfter,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,

        timestamp:
          new Date().toISOString(),
      });
    },
  });
}

/**
 * ============================================================================
 * ROUTE PARAMETER VALIDATION
 * ============================================================================
 */

function validateRouteId(
  paramName,
) {
  return (
    req,
    res,
    next,
  ) => {
    const value =
      normalizeString(
        req.params?.[
          paramName
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
          'ROUTE_PARAMETER_REQUIRED',

        message:
          `${paramName} is required.`,

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
          'ROUTE_PARAMETER_TOO_LONG',

        message:
          `${paramName} exceeds the maximum supported length.`,

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
          'INVALID_ROUTE_PARAMETER',

        message:
          `${paramName} contains unsupported characters.`,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    /**
     * Store the canonical value separately rather than mutating the raw
     * Express params object unexpectedly.
     */
    req.validatedParams =
      {
        ...(
          req.validatedParams ||
          {}
        ),

        [paramName]:
          value,
      };

    next();
  };
}

/**
 * ============================================================================
 * SEARCH QUERY VALIDATION
 * ============================================================================
 */

function validateSearchQuery(
  req,
  res,
  next,
) {
  const query =
    normalizeString(
      req.query?.q ||
        req.query?.search,
    );

  if (
    query &&
    query.length >
      200
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'CHAT_SEARCH_QUERY_TOO_LONG',

      message:
        'The chat search query is too long.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  if (
    query &&
    /[\u0000-\u001F\u007F]/.test(
      query,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'UNSAFE_CHAT_SEARCH_QUERY',

      message:
        'The chat search query contains unsupported characters.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  next();
}

/**
 * ============================================================================
 * TENANT CONTEXT FALLBACK
 * ============================================================================
 */

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
        'TENANT_CONTEXT_REQUIRED',

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
        'ACTOR_CONTEXT_REQUIRED',

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

  next();
}

/**
 * ============================================================================
 * WRITE CONTENT VALIDATION
 * ============================================================================
 *
 * Domain-specific validators remain authoritative. These route-level checks
 * prevent obviously invalid request bodies from reaching services.
 * ============================================================================
 */

function requireJsonBody(
  req,
  res,
  next,
) {
  if (
    !req.body ||
    typeof req.body !==
      'object' ||
    Array.isArray(
      req.body,
    )
  ) {
    return res.status(
      400,
    ).json({
      success:
        false,

      code:
        'INVALID_CHAT_REQUEST_BODY',

      message:
        'A JSON object request body is required.',

      requestId:
        req.requestId,

      correlationId:
        req.correlationId,
    });
  }

  next();
}

/**
 * ============================================================================
 * CONVERSATION ROUTES
 * ============================================================================
 */

/**
 * POST /conversation
 */
router.post(
  '/conversation',

  readRateLimit,

  requireJsonBody,

  createConversationValidator,

  asyncHandler(
    controllers.createConversation,
  ),
);

/**
 * GET /conversations
 */
router.get(
  '/conversations',

  readRateLimit,

  asyncHandler(
    controllers.listConversations,
  ),
);

/**
 * GET /conversation/:id
 */
router.get(
  '/conversation/:id',

  readRateLimit,

  validateRouteId(
    'id',
  ),

  asyncHandler(
    controllers.getConversationById,
  ),
);

/**
 * GET /conversation/:id/messages
 */
router.get(
  '/conversation/:id/messages',

  readRateLimit,

  validateRouteId(
    'id',
  ),

  asyncHandler(
    controllers.getConversationMessages,
  ),
);

/**
 * ============================================================================
 * PRIVILEGED CONVERSATION ACTIONS
 * ============================================================================
 */

/**
 * POST /conversation/:conversationId/pin/:messageId
 *
 * Pinning is deliberately restricted to administrators.
 */
router.post(
  '/conversation/:conversationId/pin/:messageId',

  messageRateLimit,

  validateRouteId(
    'conversationId',
  ),

  validateRouteId(
    'messageId',
  ),

  requireRole(
    'ADMIN',
  ),

  asyncHandler(
    controllers.pinMessage,
  ),
);

/**
 * POST /conversation/:id/archive
 *
 * Support staff may archive conversations, while ordinary members may not.
 */
router.post(
  '/conversation/:id/archive',

  messageRateLimit,

  validateRouteId(
    'id',
  ),

  requireRole(
    'ADMIN',
    'SUPPORT',
  ),

  asyncHandler(
    controllers.archiveConversation,
  ),
);

/**
 * ============================================================================
 * MESSAGE ROUTES
 * ============================================================================
 */

/**
 * POST /message
 */
router.post(
  '/message',

  messageRateLimit,

  requireJsonBody,

  sendMessageValidator,

  asyncHandler(
    controllers.sendMessage,
  ),
);

/**
 * PUT /message/:id
 */
router.put(
  '/message/:id',

  messageRateLimit,

  validateRouteId(
    'id',
  ),

  requireJsonBody,

  editMessageValidator,

  asyncHandler(
    controllers.editMessage,
  ),
);

/**
 * DELETE /message/:id
 *
 * Controller is expected to perform soft deletion only.
 */
router.delete(
  '/message/:id',

  messageRateLimit,

  validateRouteId(
    'id',
  ),

  asyncHandler(
    controllers.deleteMessageSoft,
  ),
);

/**
 * ============================================================================
 * SEARCH
 * ============================================================================
 */

router.get(
  '/messages/search',

  searchRateLimit,

  validateSearchQuery,

  asyncHandler(
    controllers.searchMessages,
  ),
);

/**
 * ============================================================================
 * HEALTH
 * ============================================================================
 */

router.get(
  '/health',

  readRateLimit,

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

      authenticated:
        true,

      tenantScoped:
        true,

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

    /**
     * Controlled details only.
     */
    if (
      clientError &&
      error?.details
    ) {
      response.details =
        error.details;
    }

    return res.status(
      statusCode,
    ).json(
      response,
    );
  },
);

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