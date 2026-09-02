'use strict';

/**
 * ============================================================================
 * TITech Community Capital Ltd
 * Enterprise Email & Account Security Routes
 * ============================================================================
 *
 * File:
 *   backend/routes/email.js
 *
 * Purpose
 * ----------------------------------------------------------------------------
 * Canonical HTTP boundary for:
 *
 *   - email verification
 *   - password-reset initiation
 *   - password reset
 *   - password change
 *   - verification-email delivery
 *   - verification status
 *   - administrative email configuration tests
 *
 * Canonical endpoints
 * ----------------------------------------------------------------------------
 * Public:
 *
 *   POST /verify
 *   POST /request-password-reset
 *   POST /send-password-reset           (legacy alias)
 *   POST /reset-password
 *
 * Authenticated:
 *
 *   POST /send-verification
 *   POST /resend-verification
 *   GET  /verification-status
 *   POST /change-password
 *
 * Administrator:
 *
 *   POST /test
 *   POST /test-send
 *
 * ============================================================================
 *
 * Security architecture
 * ----------------------------------------------------------------------------
 *
 *   Request
 *      ↓
 *   Request / Correlation Metadata
 *      ↓
 *   Security Headers
 *      ↓
 *   Rate Limiting
 *      ↓
 *   Validation
 *      ↓
 *   Authentication / RBAC
 *      ↓
 *   Controller
 *      ↓
 *   Email / Authentication Service
 *
 * IMPORTANT
 * ----------------------------------------------------------------------------
 * This router does NOT:
 *
 *   ✗ generate password-reset tokens
 *   ✗ hash passwords
 *   ✗ persist verification state
 *   ✗ send SMTP messages directly
 *   ✗ modify user records directly
 *
 * Those responsibilities belong to the controller/service layer.
 *
 * TITech terminology
 * ----------------------------------------------------------------------------
 * All ACFOS terminology is replaced with TITech Community Capital.
 *
 * ============================================================================
 */

const express =
  require('express');

const crypto =
  require('node:crypto');

const rateLimit =
  require('express-rate-limit');

const {
  body,
} = require('express-validator');

const asyncHandler =
  require('../utils/asyncHandler');

const {
  handleValidationErrors,
} =
  require('../utils/validators');

const {
  verifyToken,
  requireRole,
} =
  require('../middleware/auth');

const emailController =
  require('../controllers/emailController');

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
  'TITechEmailRoutes';

const ROUTER_VERSION =
  '2026.1';

const SERVICE_NAME =
  'TITech Email Service';

const APPLICATION_NAME =
  'TITech Community Capital Ltd';

const DEFAULT_BODY_LIMIT =
  process.env.TITECH_EMAIL_BODY_LIMIT ||
  '256kb';

const MAX_SUBJECT_LENGTH =
  255;

const MAX_MESSAGE_LENGTH =
  10000;

const MIN_PASSWORD_LENGTH =
  12;

const MAX_PASSWORD_LENGTH =
  128;

const TOKEN_MIN_LENGTH =
  40;

const TOKEN_MAX_LENGTH =
  4096;

/**
 * ============================================================================
 * REQUIRED CONTROLLER CONTRACT
 * ============================================================================
 *
 * We intentionally validate the complete route/controller contract at startup
 * rather than allowing an undefined handler to fail only when a request arrives.
 * ============================================================================
 */

const REQUIRED_HANDLERS =
  Object.freeze([
    'verifyEmail',
    'requestPasswordReset',
    'resetPassword',
    'changePassword',
    'sendEmailVerification',
    'resendEmailVerification',
    'getEmailVerificationStatus',
    'testEmailConfiguration',
    'sendTestEmail',
  ]);

for (
  const handler of
    REQUIRED_HANDLERS
) {
  if (
    typeof emailController?.[
      handler
    ] !==
    'function'
  ) {
    throw new Error(
      `[${ROUTER_NAME}] Missing emailController export: ${handler}`,
    );
  }
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

function getRequestId(
  req,
) {
  return (
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
    crypto.randomUUID()
  );
}

function requestMetadata(
  req,
  res,
  next,
) {
  const requestId =
    getRequestId(
      req,
    );

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
    /**
     * Authentication/reset/verification responses must not be cached.
     */
    res.setHeader(
      'Cache-Control',
      'no-store',
    );

    res.setHeader(
      'Pragma',
      'no-cache',
    );

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

    next();
  },
);

/**
 * ============================================================================
 * BODY PARSER
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
 * DEPENDENCY CONTRACTS
 * ============================================================================
 */

if (
  typeof verifyToken !==
  'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] verifyToken middleware is required.`,
  );
}

if (
  typeof requireRole !==
  'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] requireRole middleware is required.`,
  );
}

if (
  typeof handleValidationErrors !==
  'function'
) {
  throw new Error(
    `[${ROUTER_NAME}] handleValidationErrors is required.`,
  );
}

/**
 * ============================================================================
 * CLIENT IDENTIFICATION
 * ============================================================================
 */

function getClientKey(
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
    normalizeString(
      req.socket?.remoteAddress,
    ) ||
    'unknown'
  );
}

/**
 * ============================================================================
 * RATE LIMITER FACTORY
 * ============================================================================
 */

function createLimiter({
  windowMs,
  max,
  code,
  message,
  keyBy =
    'ip',
}) {
  return rateLimit({
    windowMs,

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
      if (
        keyBy ===
        'user'
      ) {
        return (
          normalizeString(
            req.user?.id ||
              req.user?._id ||
              req.user?.userId ||
              req.auth?.userId,
          ) ||
          getClientKey(
            req,
          )
        );
      }

      return getClientKey(
        req,
      );
    },

    handler(
      req,
      res,
    ) {
      const retryAfter =
        Math.ceil(
          windowMs /
            1000,
        );

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
 * RATE LIMITERS
 * ============================================================================
 */

const verifyLimiter =
  emailController.verifyEmailLimiter ||
  createLimiter({
    windowMs:
      60 * 60 * 1000,

    max:
      5,

    code:
      'EMAIL_VERIFY_RATE_LIMITED',

    message:
      'Too many email verification attempts. Please try again later.',
  });

const passwordResetRequestLimiter =
  emailController.requestResetLimiter ||
  createLimiter({
    windowMs:
      60 * 60 * 1000,

    max:
      5,

    code:
      'PASSWORD_RESET_RATE_LIMITED',

    message:
      'Too many password reset requests. Please try again later.',
  });

const passwordResetLimiter =
  emailController.resetPasswordLimiter ||
  createLimiter({
    windowMs:
      60 * 60 * 1000,

    max:
      3,

    code:
      'PASSWORD_RESET_COMPLETION_RATE_LIMITED',

    message:
      'Too many password reset attempts. Please try again later.',
  });

const verificationRequestLimiter =
  emailController.requestVerificationLimiter ||
  createLimiter({
    windowMs:
      60 * 60 * 1000,

    max:
      5,

    code:
      'VERIFICATION_REQUEST_RATE_LIMITED',

    message:
      'Too many verification-email requests. Please try again later.',
  });

const passwordChangeLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      5,

    code:
      'PASSWORD_CHANGE_RATE_LIMITED',

    message:
      'Too many password-change attempts. Please try again later.',

    keyBy:
      'user',
  });

const adminEmailLimiter =
  createLimiter({
    windowMs:
      15 * 60 * 1000,

    max:
      20,

    code:
      'ADMIN_EMAIL_RATE_LIMITED',

    message:
      'Too many administrative email requests. Please try again later.',

    keyBy:
      'user',
  });

/**
 * ============================================================================
 * VALIDATION HELPERS
 * ============================================================================
 */

const emailValidator =
  body('email')
    .exists()
    .withMessage(
      'Email address is required.',
    )
    .bail()
    .isEmail()
    .withMessage(
      'A valid email address is required.',
    )
    .normalizeEmail();

const tokenValidator =
  body('token')
    .exists()
    .withMessage(
      'Token is required.',
    )
    .bail()
    .isString()
    .withMessage(
      'Token must be a string.',
    )
    .trim()
    .isLength({
      min:
        TOKEN_MIN_LENGTH,

      max:
        TOKEN_MAX_LENGTH,
    })
    .withMessage(
      'Token format is invalid.',
    );

/**
 * Stronger enterprise password policy.
 *
 * This route only validates the request shape. Password history, breached
 * password detection, MFA requirements and session invalidation remain service
 * responsibilities.
 */
const passwordValidator = (
  fieldName,
  label,
) =>
  body(fieldName)
    .exists()
    .withMessage(
      `${label} is required.`,
    )
    .bail()
    .isString()
    .withMessage(
      `${label} must be a string.`,
    )
    .isLength({
      min:
        MIN_PASSWORD_LENGTH,

      max:
        MAX_PASSWORD_LENGTH,
    })
    .withMessage(
      `${label} must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    )
    .matches(
      /[a-z]/,
    )
    .withMessage(
      `${label} must contain at least one lowercase letter.`,
    )
    .matches(
      /[A-Z]/,
    )
    .withMessage(
      `${label} must contain at least one uppercase letter.`,
    )
    .matches(
      /\d/,
    )
    .withMessage(
      `${label} must contain at least one number.`,
    )
    .matches(
      /[^A-Za-z0-9\s]/,
    )
    .withMessage(
      `${label} must contain at least one special character.`,
    );

/**
 * ============================================================================
 * CONFIRMATION VALIDATION
 * ============================================================================
 */

function confirmPassword(
  passwordField,
  confirmationField,
) {
  return body(
    confirmationField,
  )
    .exists()
    .withMessage(
      'Password confirmation is required.',
    )
    .bail()
    .custom(
      (
        value,
        {
          req,
        },
      ) => {
        if (
          value !==
          req.body[
            passwordField
          ]
        ) {
          throw new Error(
            'Password confirmation does not match.',
          );
        }

        return true;
      },
    );
}

/**
 * ============================================================================
 * PUBLIC EMAIL VERIFICATION
 * ============================================================================
 *
 * POST /api/email/verify
 * ============================================================================
 */

router.post(
  '/verify',

  verifyLimiter,

  [
    tokenValidator,
    handleValidationErrors,
  ],

  asyncHandler(
    emailController.verifyEmail,
  ),
);

/**
 * ============================================================================
 * PASSWORD RESET REQUEST
 * ============================================================================
 *
 * Canonical:
 *
 *   POST /request-password-reset
 *
 * Legacy compatibility:
 *
 *   POST /send-password-reset
 *
 * The controller should return the same external response whether the account
 * exists or not, preventing account enumeration.
 * ============================================================================
 */

const passwordResetRequestHandler =
  [
    passwordResetRequestLimiter,

    emailValidator,

    handleValidationErrors,

    asyncHandler(
      emailController.requestPasswordReset,
    ),
  ];

router.post(
  '/request-password-reset',
  ...passwordResetRequestHandler,
);

router.post(
  '/send-password-reset',
  ...passwordResetRequestHandler,
);

/**
 * ============================================================================
 * COMPLETE PASSWORD RESET
 * ============================================================================
 *
 * POST /api/email/reset-password
 *
 * Supports `password` as the canonical field.
 *
 * The controller may support `newPassword` for backward compatibility, but
 * clients should migrate to `password`.
 * ============================================================================
 */

router.post(
  '/reset-password',

  passwordResetLimiter,

  [
    tokenValidator,

    passwordValidator(
      'password',
      'Password',
    ),

    confirmPassword(
      'password',
      'confirmPassword',
    ),

    handleValidationErrors,
  ],

  asyncHandler(
    emailController.resetPassword,
  ),
);

/**
 * ============================================================================
 * AUTHENTICATED VERIFICATION EMAIL
 * ============================================================================
 *
 * POST /api/email/send-verification
 *
 * The authenticated identity should be authoritative. A caller must not be
 * able to use this endpoint to send verification messages for arbitrary
 * accounts.
 *
 * We intentionally do not use the body email as the trust boundary.
 * ============================================================================
 */

router.post(
  '/send-verification',

  verifyToken,

  verificationRequestLimiter,

  asyncHandler(
    async (
      req,
      res,
      next,
    ) => {
      /**
       * Prefer the explicit authenticated-user controller contract.
       */
      if (
        typeof emailController
          .sendEmailVerification ===
        'function'
      ) {
        return emailController.sendEmailVerification(
          req,
          res,
          next,
        );
      }

      /**
       * Backward-compatible fallback for installations that expose
       * sendVerificationEmailRequest.
       */
      if (
        typeof emailController
          .sendVerificationEmailRequest ===
        'function'
      ) {
        const email =
          normalizeString(
            req.user?.email,
          )?.toLowerCase();

        if (
          !email
        ) {
          return res.status(
            400,
          ).json({
            success:
              false,

            code:
              'AUTHENTICATED_EMAIL_REQUIRED',

            message:
              'An authenticated account email address is required.',

            requestId:
              req.requestId,

            correlationId:
              req.correlationId,
          });
        }

        req.body =
          {
            ...(
              req.body ||
              {}
            ),

            email,
          };

        return emailController.sendVerificationEmailRequest(
          req,
          res,
          next,
        );
      }

      const error =
        new Error(
          'No supported verification-email controller is available.',
        );

      error.statusCode =
        500;

      error.code =
        'EMAIL_VERIFICATION_CONTROLLER_UNAVAILABLE';

      throw error;
    },
  ),
);

/**
 * ============================================================================
 * RESEND VERIFICATION
 * ============================================================================
 */

router.post(
  '/resend-verification',

  verifyToken,

  verificationRequestLimiter,

  asyncHandler(
    async (
      req,
      res,
      next,
    ) => {
      /**
       * Prefer the explicit resend controller.
       */
      if (
        typeof emailController
          .resendEmailVerification ===
        'function'
      ) {
        return emailController.resendEmailVerification(
          req,
          res,
          next,
        );
      }

      /**
       * Backward-compatible fallback.
       */
      if (
        typeof emailController
          .sendVerificationEmailRequest ===
        'function'
      ) {
        const email =
          normalizeString(
            req.user?.email,
          )?.toLowerCase();

        if (
          !email
        ) {
          return res.status(
            400,
          ).json({
            success:
              false,

            code:
              'AUTHENTICATED_EMAIL_REQUIRED',

            message:
              'An authenticated account email address is required.',

            requestId:
              req.requestId,

            correlationId:
              req.correlationId,
          });
        }

        req.body =
          {
            ...(
              req.body ||
              {}
            ),

            email,
          };

        return emailController.sendVerificationEmailRequest(
          req,
          res,
          next,
        );
      }

      const error =
        new Error(
          'No supported verification resend controller is available.',
        );

      error.statusCode =
        500;

      error.code =
        'VERIFICATION_RESEND_CONTROLLER_UNAVAILABLE';

      throw error;
    },
  ),
);

/**
 * ============================================================================
 * EMAIL VERIFICATION STATUS
 * ============================================================================
 */

router.get(
  '/verification-status',

  verifyToken,

  asyncHandler(
    emailController.getEmailVerificationStatus,
  ),
);

/**
 * ============================================================================
 * CHANGE PASSWORD
 * ============================================================================
 *
 * POST /api/email/change-password
 * ============================================================================
 */

router.post(
  '/change-password',

  verifyToken,

  passwordChangeLimiter,

  [
    passwordValidator(
      'currentPassword',
      'Current password',
    )
      /**
       * Current password is validated as presence/type here. Do not impose the
       * new password complexity policy on the existing password.
       */
      .isLength({
        min:
          1,
      }),

    passwordValidator(
      'newPassword',
      'New password',
    ),

    confirmPassword(
      'newPassword',
      'confirmPassword',
    ),

    handleValidationErrors,
  ],

  asyncHandler(
    emailController.changePassword,
  ),
);

/**
 * ============================================================================
 * ADMIN EMAIL CONFIGURATION TEST
 * ============================================================================
 *
 * POST /api/email/test
 *
 * Administrative email infrastructure diagnostics.
 * ============================================================================
 */

router.post(
  '/test',

  verifyToken,

  requireRole(
    'admin',
  ),

  adminEmailLimiter,

  asyncHandler(
    emailController.testEmailConfiguration,
  ),
);

/**
 * ============================================================================
 * ADMIN TEST EMAIL
 * ============================================================================
 *
 * POST /api/email/test-send
 *
 * Restricted to administrators.
 *
 * Subject and message are bounded to prevent excessively large payloads.
 * ============================================================================
 */

router.post(
  '/test-send',

  verifyToken,

  requireRole(
    'admin',
  ),

  adminEmailLimiter,

  [
    body('to')
      .exists()
      .withMessage(
        'Recipient email is required.',
      )
      .bail()
      .isEmail()
      .withMessage(
        'A valid recipient email is required.',
      )
      .normalizeEmail(),

    body('subject')
      .exists()
      .withMessage(
        'Subject is required.',
      )
      .bail()
      .isString()
      .trim()
      .isLength({
        min:
          1,

        max:
          MAX_SUBJECT_LENGTH,
      })
      .withMessage(
        `Subject must be between 1 and ${MAX_SUBJECT_LENGTH} characters.`,
      ),

    body('message')
      .exists()
      .withMessage(
        'Message is required.',
      )
      .bail()
      .isString()
      .isLength({
        min:
          1,

        max:
          MAX_MESSAGE_LENGTH,
      })
      .withMessage(
        `Message must be between 1 and ${MAX_MESSAGE_LENGTH} characters.`,
      ),

    handleValidationErrors,
  ],

  asyncHandler(
    emailController.sendTestEmail,
  ),
);

/**
 * ============================================================================
 * HEALTH
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
 * ROUTE NOT FOUND
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
        'EMAIL_ROUTE_NOT_FOUND',

      message:
        'Email endpoint not found.',

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
      ) >=
        400 &&
      Number(
        error?.statusCode,
      ) <
        600
        ? Number(
            error.statusCode,
          )
        : 500;

    const clientError =
      statusCode >=
        400 &&
      statusCode <
        500;

    return res.status(
      statusCode,
    ).json({
      success:
        false,

      code:
        normalizeString(
          error?.code,
        ) ||
        (
          clientError
            ? 'EMAIL_REQUEST_ERROR'
            : 'EMAIL_INTERNAL_ERROR'
        ),

      message:
        clientError
          ? (
              error?.message ||
              'The email request could not be completed.'
            )
          : 'The email request could not be completed.',

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
 * ROUTER METADATA
 * ============================================================================
 */

router.routerName =
  ROUTER_NAME;

router.routerVersion =
  ROUTER_VERSION;

router.serviceName =
  SERVICE_NAME;

router.applicationName =
  APPLICATION_NAME;

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  router;