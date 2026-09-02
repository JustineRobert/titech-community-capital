'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Development Authentication Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/authRoutes.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Provides tightly controlled development/test authentication helpers.
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This file MUST NOT expose a test-token generator in production.
 *
 * The previous implementation accepted:
 *
 *   ?role=
 *   ?tenantId=
 *   ?userId=
 *
 * and signed those arbitrary claims using JWT_SECRET.
 *
 * That pattern is unsafe because a caller could potentially mint an
 * administrator token or impersonate another tenant.
 *
 * ============================================================================
 */

const express =
  require('express');

const jwt =
  require('jsonwebtoken');

const crypto =
  require('node:crypto');

const rateLimit =
  require('express-rate-limit');

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
  'TITechDevelopmentAuthRoutes';

const ROUTER_VERSION =
  '2026.1';

const APPLICATION_NAME =
  'TITech Community Capital Ltd';

const DEFAULT_ROLE =
  'AUDITOR';

const DEFAULT_EXPIRY =
  '5m';

const TEST_TOKEN_MAX_USER_ID_LENGTH =
  128;

const TEST_TOKEN_MAX_TENANT_ID_LENGTH =
  128;

/**
 * ============================================================================
 * ENVIRONMENT POLICY
 * ============================================================================
 */

const environment =
  String(
    process.env.NODE_ENV ||
      'development',
  ).toLowerCase();

const isProduction =
  environment === 'production';

const isTest =
  environment === 'test';

const isDevelopment =
  environment === 'development';

/**
 * Explicit opt-in.
 *
 * The endpoint is disabled unless:
 *
 *   TITECH_ENABLE_TEST_TOKEN_ROUTE=true
 *
 * and the environment is development/test.
 */
const testTokenRouteEnabled =
  !isProduction &&
  (
    isDevelopment ||
    isTest
  ) &&
  String(
    process.env
      .TITECH_ENABLE_TEST_TOKEN_ROUTE ||
      '',
  ).toLowerCase() ===
    'true';

/**
 * ============================================================================
 * TEST ROLE POLICY
 * ============================================================================
 *
 * Never permit arbitrary role injection.
 *
 * Keep the list aligned with the project's currently supported role model.
 * ============================================================================
 */

const ALLOWED_TEST_ROLES =
  Object.freeze([
    'AUDITOR',
    'TREASURER',
    'MEMBER',
    'ADMIN',
  ]);

/**
 * ============================================================================
 * DEVELOPMENT TOKEN SECRET
 * ============================================================================
 *
 * Prefer a dedicated secret:
 *
 *   TITECH_TEST_JWT_SECRET
 *
 * over the production JWT secret.
 */
const testJwtSecret =
  String(
    process.env
      .TITECH_TEST_JWT_SECRET ||
      '',
  ).trim();

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
    String(value).trim();

  return normalized || fallback;
}

function getRequestId(
  req,
) {
  return (
    normalizeString(
      req.requestId,
    ) ||
    normalizeString(
      req.headers?.[
        'x-request-id'
      ],
    ) ||
    crypto.randomUUID()
  );
}

function requestMetadata(
  req,
  res,
  next,
) {
  const requestId =
    getRequestId(req);

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

  res.setHeader(
    'Cache-Control',
    'no-store',
  );

  res.setHeader(
    'Pragma',
    'no-cache',
  );

  next();
}

router.use(
  requestMetadata,
);

/**
 * ============================================================================
 * TEST-TOKEN RATE LIMIT
 * ============================================================================
 */

const testTokenLimiter =
  rateLimit({
    windowMs:
      60 * 1000,

    max:
      20,

    standardHeaders:
      'draft-8',

    legacyHeaders:
      false,

    skipSuccessfulRequests:
      false,

    handler(
      req,
      res,
    ) {
      res.setHeader(
        'Retry-After',
        '60',
      );

      return res.status(
        429,
      ).json({
        success:
          false,

        code:
          'TEST_TOKEN_RATE_LIMITED',

        message:
          'Too many test-token requests.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    },
  });

/**
 * ============================================================================
 * VALIDATION HELPERS
 * ============================================================================
 */

function isValidMongoObjectId(
  value,
) {
  return /^[a-f\d]{24}$/i.test(
    value,
  );
}

function validateUserId(
  value,
) {
  const userId =
    normalizeString(
      value,
    );

  if (!userId) {
    throw createValidationError(
      'userId is required.',
      'USER_ID_REQUIRED',
    );
  }

  if (
    userId.length >
    TEST_TOKEN_MAX_USER_ID_LENGTH
  ) {
    throw createValidationError(
      'userId is too long.',
      'INVALID_USER_ID',
    );
  }

  if (
    /[\u0000-\u001F\u007F]/.test(
      userId,
    )
  ) {
    throw createValidationError(
      'userId contains unsupported characters.',
      'INVALID_USER_ID',
    );
  }

  return userId;
}

function validateTenantId(
  value,
) {
  const tenantId =
    normalizeString(
      value,
    );

  if (!tenantId) {
    throw createValidationError(
      'tenantId is required.',
      'TENANT_ID_REQUIRED',
    );
  }

  if (
    tenantId.length >
    TEST_TOKEN_MAX_TENANT_ID_LENGTH
  ) {
    throw createValidationError(
      'tenantId is too long.',
      'INVALID_TENANT_ID',
    );
  }

  /**
   * The project's production tenant model uses MongoDB identifiers.
   */
  if (
    !isValidMongoObjectId(
      tenantId,
    )
  ) {
    throw createValidationError(
      'tenantId must be a valid MongoDB ObjectId.',
      'INVALID_TENANT_ID',
    );
  }

  return tenantId;
}

function validateRole(
  value,
) {
  const role =
    String(
      value ||
        DEFAULT_ROLE,
    )
      .trim()
      .toUpperCase();

  if (
    !ALLOWED_TEST_ROLES.includes(
      role,
    )
  ) {
    throw createValidationError(
      'Unsupported test role.',
      'INVALID_TEST_ROLE',
    );
  }

  return role;
}

function createValidationError(
  message,
  code,
) {
  const error =
    new Error(
      message,
    );

  error.code =
    code;

  error.statusCode =
    400;

  return error;
}

/**
 * ============================================================================
 * TEST-TOKEN ENDPOINT
 * ============================================================================
 *
 * GET /auth/test-token
 *
 * Query:
 *   role=AUDITOR
 *   tenantId=<tenant ObjectId>
 *   userId=<test user>
 *
 * SECURITY:
 *   - Disabled by default
 *   - Disabled in production
 *   - Requires dedicated test secret
 *   - Restricts roles
 *   - Validates tenant identifier
 * ============================================================================
 */

router.get(
  '/auth/test-token',
  testTokenLimiter,
  (
    req,
    res,
  ) => {
    /**
     * ------------------------------------------------------------------------
     * Runtime kill switch
     * ------------------------------------------------------------------------
     */

    if (
      !testTokenRouteEnabled
    ) {
      return res.status(
        404,
      ).json({
        success:
          false,

        code:
          'TEST_TOKEN_ROUTE_DISABLED',

        message:
          'The development test-token endpoint is disabled.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    /**
     * ------------------------------------------------------------------------
     * Dedicated test secret
     * ------------------------------------------------------------------------
     */

    if (
      !testJwtSecret
    ) {
      return res.status(
        503,
      ).json({
        success:
          false,

        code:
          'TEST_JWT_SECRET_NOT_CONFIGURED',

        message:
          'The development JWT test secret is not configured.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }

    try {
      const role =
        validateRole(
          req.query.role,
        );

      const tenantId =
        validateTenantId(
          req.query.tenantId,
        );

      const userId =
        validateUserId(
          req.query.userId ||
            'test-user',
        );

      /**
       * ----------------------------------------------------------------------
       * Safety boundary
       * ----------------------------------------------------------------------
       *
       * Keep issuer/audience explicit so this test token cannot accidentally
       * masquerade as a token issued for a different JWT trust domain.
       * ----------------------------------------------------------------------
       */

      const issuer =
        process.env
          .TITECH_TEST_JWT_ISSUER ||
        `${APPLICATION_NAME}:test`;

      const audience =
        process.env
          .TITECH_TEST_JWT_AUDIENCE ||
        'titech-test';

      const payload = {
        sub:
          userId,

        id:
          userId,

        tenantId,

        role,

        tokenType:
          'test',

        environment:
          environment,

        jti:
          crypto.randomUUID(),
      };

      const token =
        jwt.sign(
          payload,
          testJwtSecret,
          {
            expiresIn:
              DEFAULT_EXPIRY,

            issuer,

            audience,
          },
        );

      /**
       * ----------------------------------------------------------------------
       * Never return the signing secret.
       * ----------------------------------------------------------------------
       */

      return res.status(
        200,
      ).json({
        success:
          true,

        environment,

        tokenType:
          'test',

        role,

        tenantId,

        userId,

        token,

        expiresIn:
          DEFAULT_EXPIRY,

        issuer,

        audience,

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    } catch (
      error
    ) {
      const statusCode =
        Number(
          error?.statusCode,
        ) >=
          400 &&
        Number(
          error?.statusCode,
        ) <
          500
          ? Number(
              error.statusCode,
            )
          : 500;

      return res.status(
        statusCode,
      ).json({
        success:
          false,

        code:
          error?.code ||
          'TEST_TOKEN_GENERATION_FAILED',

        message:
          statusCode >=
            400 &&
          statusCode <
            500
            ? error.message
            : 'Test token generation failed.',

        requestId:
          req.requestId,

        correlationId:
          req.correlationId,
      });
    }
  },
);

/**
 * ============================================================================
 * ROUTER STATUS
 * ============================================================================
 *
 * This does NOT mint a token.
 * ============================================================================
 */

router.get(
  '/auth/test-token/status',
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
        ROUTER_NAME,

      environment,

      enabled:
        testTokenRouteEnabled,

      tokenSecretConfigured:
        Boolean(
          testJwtSecret,
        ),

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
        'AUTH_TEST_ROUTE_NOT_FOUND',

      message:
        'Authentication development endpoint not found.',

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
 * EXPORTS
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

module.exports =
  router;

module.exports.ROUTER_NAME =
  ROUTER_NAME;

module.exports.ROUTER_VERSION =
  ROUTER_VERSION;