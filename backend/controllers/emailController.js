/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/controllers/emailController.js
 *
 * Purpose:
 *   HTTP controllers for authentication/email lifecycle operations.
 *
 * Responsibilities:
 *   - Send email-verification messages
 *   - Verify email addresses
 *   - Request password-reset messages
 *   - Complete password resets
 *   - Change authenticated-user passwords
 *   - Check verification status
 *   - Administrative email configuration testing
 *   - Administrative test-email delivery
 *   - Security/audit logging around email/password operations
 *
 * Architecture:
 *   Route
 *      ↓
 *   Validation / Rate Limiting / Authentication
 *      ↓
 *   Controller
 *      ↓
 *   Service
 *      ↓
 *   Repository / Model / External Provider
 *
 * IMPORTANT:
 *   This controller does not own:
 *   - authorization policy
 *   - tenant policy
 *   - financial logic
 *   - ledger mutation
 *   - payment state transitions
 *   - token cryptographic policy
 *
 * Those remain in their respective middleware/services/domain boundaries.
 *
 * Security principles:
 *   - Never expose whether an account exists during public reset flows
 *   - Never return credentials/tokens/passwords in API responses
 *   - Never log passwords or reset/verification tokens
 *   - Use canonical password validation
 *   - Preserve trace/request identifiers
 *   - Delegate persistence/security-sensitive state changes to services
 *   - Avoid returning raw internal exception details for unexpected 5xx errors
 *
 * =============================================================================
 */

import crypto from 'node:crypto';

import asyncHandler from '../utils/asyncHandler.js';
import logger from '../utils/logger.js';

import User from '../models/User.js';
import RefreshToken from '../models/RefreshToken.js';
import EmailAudit from '../models/EmailAudit.js';
import PasswordResetToken from '../models/PasswordResetToken.js';

import PasswordResetService, {
  hashResetToken,
} from '../services/passwordResetService.js';

import * as emailServiceModule from '../services/emailService.js';

import {
  successResponse,
  errorResponse,
} from '../utils/response.js';

import {
  isStrongPassword,
  isValidEmail,
} from '../utils/validators.js';

import {
  requestVerificationLimiter,
  requestResetLimiter,
  resetPasswordLimiter,
  verifyEmailLimiter,
} from '../middleware/rateLimiters.js';

/**
 * =============================================================================
 * Service compatibility
 * =============================================================================
 *
 * Supports either:
 *
 *   export default emailService
 *
 * or a CommonJS-to-ESM-transitional namespace containing the service methods.
 *
 * This avoids forcing an unnecessary rewrite of emailService.js in the same
 * change while the backend is being migrated to canonical ESM.
 * =============================================================================
 */

const emailService =
  emailServiceModule.default ?? emailServiceModule;

const sendVerificationEmail =
  emailServiceModule.sendVerificationEmail ??
  emailService.sendVerificationEmail;

const sendPasswordResetEmail =
  emailServiceModule.sendPasswordResetEmail ??
  emailService.sendPasswordResetEmail;

/**
 * =============================================================================
 * Constants
 * =============================================================================
 */

const PUBLIC_RESET_MESSAGE =
  'If an account exists for this email, a password reset link has been sent.';

const PUBLIC_VERIFICATION_MESSAGE =
  'If the email exists and is not verified, a verification link has been sent.';

/**
 * =============================================================================
 * Internal helpers
 * =============================================================================
 */

/**
 * Resolve the authenticated user's identifier across current/legacy auth shapes.
 */
const getAuthenticatedUserId = (req) =>
  req.user?.id ??
  req.user?._id ??
  null;

/**
 * Resolve request/trace identifier through the canonical response helper.
 */
const resolveTraceId = (req) =>
  req.traceId ??
  req.requestId ??
  req.id ??
  req.headers?.['x-trace-id'] ??
  req.headers?.['x-request-id'] ??
  null;

/**
 * Safely normalize an email address.
 */
const normalizeEmail = (email) =>
  typeof email === 'string'
    ? email.trim().toLowerCase()
    : '';

/**
 * Normalize a public error without exposing internal details.
 */
const sendControllerError = (
  res,
  err,
  req,
  fallbackCode = 'INTERNAL_ERROR',
  fallbackMessage = 'An unexpected error occurred',
  fallbackStatus = 500,
) => {
  if (err) {
    logger.error(
      {
        err,
        traceId: resolveTraceId(req),
        path: req.originalUrl,
        method: req.method,
      },
      'Email controller request failed',
    );
  }

  return errorResponse(
    res,
    {
      ...err,
      errorCode:
        err?.errorCode ??
        err?.code ??
        fallbackCode,
      statusCode:
        err?.statusCode ??
        err?.status ??
        fallbackStatus,
      message:
        err?.statusCode && err.statusCode < 500
          ? err.message
          : fallbackMessage,
      expose:
        err?.expose ??
        (err?.statusCode && err.statusCode < 500),
      details: err?.details,
    },
    req,
  );
};

/**
 * Record an email/security audit event.
 *
 * Audit failure must not turn an otherwise successful user-facing operation
 * into a failure. Audit failure is logged separately.
 */
const auditEmailEvent = async (
  event,
  userId,
  email,
  metadata = {},
  successful = true,
) => {
  try {
    const safeEmail =
      typeof email === 'string'
        ? email.trim().toLowerCase()
        : null;

    const safeMetadata = {
      ipAddress:
        metadata.ipAddress ??
        null,
      userAgent:
        metadata.userAgent ??
        null,
      requestId:
        metadata.requestId ??
        null,
      traceId:
        metadata.traceId ??
        null,
      reason:
        metadata.reason ??
        null,
      ...metadata,
    };

    /**
     * Never permit secrets to enter the audit document by accident.
     */
    delete safeMetadata.token;
    delete safeMetadata.verificationToken;
    delete safeMetadata.resetToken;
    delete safeMetadata.password;
    delete safeMetadata.newPassword;
    delete safeMetadata.currentPassword;
    delete safeMetadata.refreshToken;
    delete safeMetadata.accessToken;

    await EmailAudit.create({
      event,
      userId: userId || null,
      email: safeEmail,
      ipAddress: safeMetadata.ipAddress,
      userAgent: safeMetadata.userAgent,
      status: successful ? 'success' : 'failed',
      reason: safeMetadata.reason,
      metadata: safeMetadata,
      timestamp: new Date(),
    });
  } catch (auditError) {
    logger.error(
      {
        err: auditError,
        event,
        userId: userId || null,
      },
      '[EmailAudit] Failed to persist audit event',
    );
  }
};

/**
 * Build common request metadata for audit/service calls.
 */
const requestMetadata = (req) => ({
  ipAddress: req.ip ?? null,
  userAgent: req.get('User-Agent') ?? null,
  requestId: req.requestId ?? req.id ?? null,
  traceId: resolveTraceId(req),
});

/**
 * =============================================================================
 * Email verification
 * =============================================================================
 */

/**
 * POST /api/email/send-verification
 *
 * Authenticated endpoint.
 */
export const sendEmailVerification = asyncHandler(
  async (req, res) => {
    const userId = getAuthenticatedUserId(req);

    if (!userId) {
      return errorResponse(
        res,
        {
          statusCode: 401,
          errorCode: 'AUTHENTICATION_REQUIRED',
          message: 'Authentication is required.',
          expose: true,
        },
        req,
      );
    }

    try {
      const result =
        await emailService.sendEmailVerification(
          userId,
        );

      await auditEmailEvent(
        'send_verification_email',
        userId,
        req.user?.email ?? null,
        requestMetadata(req),
        true,
      );

      return successResponse(
        res,
        null,
        result?.message ??
          'Verification email sent successfully.',
        req,
        200,
      );
    } catch (err) {
      await auditEmailEvent(
        'send_verification_email',
        userId,
        req.user?.email ?? null,
        {
          ...requestMetadata(req),
          reason: err?.message ?? 'Email delivery failed',
        },
        false,
      );

      return sendControllerError(
        res,
        err,
        req,
        'EMAIL_VERIFICATION_SEND_FAILED',
        'Failed to send verification email.',
        400,
      );
    }
  },
);

/**
 * POST /api/auth/send-verification-email
 *
 * Public endpoint.
 *
 * Account enumeration resistance is preserved.
 */
export const sendVerificationEmailRequest = asyncHandler(
  async (req, res) => {
    const normalizedEmail = normalizeEmail(
      req.body?.email,
    );

    /**
     * Route validation should normally catch this. This controller guard
     * protects callers that invoke the controller without the route validator.
     */
    if (
      !normalizedEmail ||
      !isValidEmail(normalizedEmail)
    ) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'INVALID_EMAIL',
          message: 'Please provide a valid email address.',
          expose: true,
        },
        req,
      );
    }

    const user = await User.findOne({
      email: normalizedEmail,
    });

    /**
     * Do not reveal whether the account exists.
     */
    if (!user) {
      return successResponse(
        res,
        null,
        PUBLIC_VERIFICATION_MESSAGE,
        req,
        200,
      );
    }

    const isVerified =
      Boolean(user.isEmailVerified) ||
      Boolean(user.isVerified);

    if (isVerified) {
      return successResponse(
        res,
        null,
        'Email is already verified.',
        req,
        200,
      );
    }

    try {
      /**
       * Existing User model is responsible for generating/storing the hashed
       * verification token and its expiry.
       */
      const verificationToken =
        user.generateVerificationToken();

      await user.save({
        validateBeforeSave: false,
      });

      const frontendUrl =
        process.env.FRONTEND_URL;

      if (!frontendUrl) {
        throw Object.assign(
          new Error(
            'Frontend URL is not configured.',
          ),
          {
            statusCode: 500,
            errorCode: 'FRONTEND_URL_NOT_CONFIGURED',
          },
        );
      }

      const verificationUrl =
        `${frontendUrl.replace(/\/+$/, '')}` +
        `/verify-email?token=${encodeURIComponent(
          verificationToken,
        )}`;

      if (typeof sendVerificationEmail !== 'function') {
        throw Object.assign(
          new Error(
            'Verification email service is unavailable.',
          ),
          {
            statusCode: 503,
            errorCode: 'EMAIL_SERVICE_UNAVAILABLE',
          },
        );
      }

      await sendVerificationEmail(
        user.email,
        user.name,
        verificationUrl,
      );

      await auditEmailEvent(
        'send_verification_email',
        user._id,
        user.email,
        requestMetadata(req),
        true,
      );

      logger.info(
        {
          userId: user._id,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Verification email sent',
      );

      return successResponse(
        res,
        null,
        'Verification email sent successfully.',
        req,
        200,
      );
    } catch (err) {
      /**
       * Revoke the just-created verification credential if delivery failed.
       */
      try {
        user.verificationToken = null;
        user.verificationTokenExpires = null;

        await user.save({
          validateBeforeSave: false,
        });
      } catch (rollbackError) {
        logger.error(
          {
            err: rollbackError,
            userId: user._id,
            traceId: resolveTraceId(req),
          },
          '[EmailController] Failed to rollback verification token',
        );
      }

      await auditEmailEvent(
        'send_verification_email',
        user._id,
        user.email,
        {
          ...requestMetadata(req),
          reason:
            err?.message ??
            'Verification email delivery failed',
        },
        false,
      );

      logger.error(
        {
          err,
          userId: user._id,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Verification email delivery failed',
      );

      return sendControllerError(
        res,
        err,
        req,
        'EMAIL_VERIFICATION_SEND_FAILED',
        'Failed to send verification email. Please try again later.',
        500,
      );
    }
  },
);

/**
 * POST /api/auth/verify-email
 *
 * Verifies the email address from a stored hashed token.
 */
export const verifyEmail = asyncHandler(
  async (req, res) => {
    const token = req.body?.token;

    if (
      typeof token !== 'string' ||
      token.trim().length === 0
    ) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'VERIFICATION_TOKEN_REQUIRED',
          message: 'Verification token is required.',
          expose: true,
        },
        req,
      );
    }

    try {
      /**
       * The raw token is never persisted.
       */
      const hashedToken = crypto
        .createHash('sha256')
        .update(token)
        .digest('hex');

      const user = await User.findOne({
        verificationToken: hashedToken,
        verificationTokenExpires: {
          $gt: new Date(),
        },
      });

      if (!user) {
        await auditEmailEvent(
          'verify_email',
          null,
          null,
          {
            ...requestMetadata(req),
            reason: 'Invalid or expired token',
          },
          false,
        );

        return errorResponse(
          res,
          {
            statusCode: 400,
            errorCode: 'INVALID_OR_EXPIRED_VERIFICATION_TOKEN',
            message:
              'Invalid or expired verification token.',
            expose: true,
          },
          req,
        );
      }

      user.isEmailVerified = true;

      /**
       * Keep legacy field synchronized where it exists in the current schema.
       */
      if (
        Object.prototype.hasOwnProperty.call(
          user.toObject(),
          'isVerified',
        ) ||
        typeof user.isVerified !== 'undefined'
      ) {
        user.isVerified = true;
      }

      if (
        Object.prototype.hasOwnProperty.call(
          user.toObject(),
          'emailVerifiedAt',
        ) ||
        typeof user.emailVerifiedAt !== 'undefined'
      ) {
        user.emailVerifiedAt = new Date();
      }

      user.verificationToken = null;
      user.verificationTokenExpires = null;

      await user.save({
        validateBeforeSave: false,
      });

      await auditEmailEvent(
        'verify_email',
        user._id,
        user.email,
        requestMetadata(req),
        true,
      );

      logger.info(
        {
          userId: user._id,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Email verified successfully',
      );

      return successResponse(
        res,
        {
          user: {
            id: String(user._id),
            email: user.email,
            name: user.name,
            isVerified:
              Boolean(user.isEmailVerified) ||
              Boolean(user.isVerified),
            verifiedAt:
              user.emailVerifiedAt ?? null,
          },
        },
        'Email verified successfully. You can now log in.',
        req,
        200,
      );
    } catch (err) {
      return sendControllerError(
        res,
        err,
        req,
        'EMAIL_VERIFICATION_FAILED',
        'Email verification failed.',
        500,
      );
    }
  },
);

/**
 * Legacy verification endpoint retained for compatibility.
 *
 * Existing routes can continue importing legacyVerifyEmail semantics through
 * verifyEmail without maintaining duplicate business logic.
 */
export const legacyVerifyEmail = verifyEmail;

/**
 * =============================================================================
 * Password reset request
 * =============================================================================
 */

/**
 * POST /api/auth/request-password-reset
 */
export const requestPasswordReset = asyncHandler(
  async (req, res) => {
    const normalizedEmail = normalizeEmail(
      req.body?.email,
    );

    if (
      !normalizedEmail ||
      !isValidEmail(normalizedEmail)
    ) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'INVALID_EMAIL',
          message: 'Please provide a valid email address.',
          expose: true,
        },
        req,
      );
    }

    const publicSuccess = () =>
      successResponse(
        res,
        null,
        PUBLIC_RESET_MESSAGE,
        req,
        200,
      );

    try {
      const user = await User.findOne({
        email: normalizedEmail,
      });

      /**
       * Account-enumeration resistance.
       */
      if (!user) {
        return publicSuccess();
      }

      await passwordResetService.createResetToken(
        user,
        {
          requestIp: req.ip,
          userAgent: req.get('User-Agent'),
          requestId:
            req.requestId ??
            req.id ??
            null,
          traceId:
            resolveTraceId(req),
        },
      );

      await auditEmailEvent(
        'request_password_reset',
        user._id,
        user.email,
        requestMetadata(req),
        true,
      );

      logger.info(
        {
          userId: user._id,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Password reset requested',
      );

      return publicSuccess();
    } catch (err) {
      await auditEmailEvent(
        'request_password_reset',
        null,
        normalizedEmail,
        {
          ...requestMetadata(req),
          reason:
            err?.message ??
            'Password reset request failed',
        },
        false,
      );

      /**
       * Never turn delivery/provider/database details into account-enumeration
       * signals. Return the same public response.
       */
      logger.error(
        {
          err,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Password reset request failed',
      );

      return publicSuccess();
    }
  },
);

/**
 * Legacy endpoint retained for compatibility.
 */
export const sendPasswordReset = requestPasswordReset;

/**
 * =============================================================================
 * Password reset completion
 * =============================================================================
 */

/**
 * POST /api/auth/reset-password
 */
export const resetPassword = asyncHandler(
  async (req, res) => {
    const token = req.body?.token;

    /**
     * Support both canonical "password" and legacy "newPassword".
     */
    const password =
      typeof req.body?.password === 'string' &&
      req.body.password.length > 0
        ? req.body.password
        : req.body?.newPassword;

    const confirmPassword =
      typeof req.body?.confirmPassword === 'string' &&
      req.body.confirmPassword.length > 0
        ? req.body.confirmPassword
        : password;

    if (
      typeof token !== 'string' ||
      token.trim().length === 0
    ) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'RESET_TOKEN_REQUIRED',
          message:
            'Password reset token is required.',
          expose: true,
        },
        req,
      );
    }

    if (
      typeof password !== 'string' ||
      !password
    ) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'PASSWORD_REQUIRED',
          message: 'New password is required.',
          expose: true,
        },
        req,
      );
    }

    if (password !== confirmPassword) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'PASSWORD_MISMATCH',
          message: 'Passwords do not match.',
          expose: true,
        },
        req,
      );
    }

    if (!isStrongPassword(password)) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'WEAK_PASSWORD',
          message:
            'Password must be at least 12 characters and contain at least one uppercase letter, one lowercase letter, and one number, with no spaces.',
          expose: true,
        },
        req,
      );
    }

    try {
      /**
       * Hash the supplied reset token before database lookup.
       *
       * The raw credential must never be persisted or logged.
       */
      const tokenHash =
        hashResetToken(token);

      const tokenRecord =
        await PasswordResetToken.findActiveByHash(
          tokenHash,
        );

      if (!tokenRecord?.user) {
        await auditEmailEvent(
          'reset_password',
          null,
          null,
          {
            ...requestMetadata(req),
            reason:
              'Invalid or expired password reset token',
          },
          false,
        );

        return errorResponse(
          res,
          {
            statusCode: 400,
            errorCode:
              'INVALID_OR_EXPIRED_RESET_TOKEN',
            message:
              'Invalid or expired password reset token.',
            expose: true,
          },
          req,
        );
      }

      const result =
        await passwordResetService.resetPassword(
          tokenRecord.user,
          token,
          password,
          {
            tenantId:
              tokenRecord.tenantId ??
              null,
            requestIp:
              req.ip ??
              null,
            userAgent:
              req.get('User-Agent') ??
              null,
            requestId:
              req.requestId ??
              req.id ??
              null,
            traceId:
              resolveTraceId(req),
          },
        );

      await auditEmailEvent(
        'reset_password',
        tokenRecord.user._id,
        tokenRecord.user.email,
        requestMetadata(req),
        true,
      );

      logger.info(
        {
          userId: tokenRecord.user._id,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Password reset completed',
      );

      /**
       * Normalize service return values while allowing the service to retain
       * additional non-sensitive data.
       */
      const responseData =
        result &&
        typeof result === 'object' &&
        !Array.isArray(result)
          ? result
          : null;

      return successResponse(
        res,
        responseData,
        result?.message ??
          'Password has been reset successfully.',
        req,
        200,
      );
    } catch (err) {
      await auditEmailEvent(
        'reset_password',
        null,
        null,
        {
          ...requestMetadata(req),
          reason:
            err?.message ??
            'Password reset failed',
        },
        false,
      );

      return sendControllerError(
        res,
        err,
        req,
        'PASSWORD_RESET_FAILED',
        'Unable to reset password.',
        400,
      );
    }
  },
);

/**
 * =============================================================================
 * Authenticated password change
 * =============================================================================
 */

/**
 * POST /api/auth/change-password
 */
export const changePassword = asyncHandler(
  async (req, res) => {
    const userId =
      getAuthenticatedUserId(req);

    if (!userId) {
      return errorResponse(
        res,
        {
          statusCode: 401,
          errorCode: 'AUTHENTICATION_REQUIRED',
          message: 'Not authenticated.',
          expose: true,
        },
        req,
      );
    }

    const currentPassword =
      req.body?.currentPassword;

    const newPassword =
      req.body?.newPassword;

    const confirmPassword =
      req.body?.confirmPassword;

    if (
      typeof currentPassword !== 'string' ||
      typeof newPassword !== 'string' ||
      typeof confirmPassword !== 'string' ||
      !currentPassword ||
      !newPassword ||
      !confirmPassword
    ) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'PASSWORD_FIELDS_REQUIRED',
          message:
            'Current password, new password, and confirmation are required.',
          expose: true,
        },
        req,
      );
    }

    if (newPassword !== confirmPassword) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'PASSWORD_MISMATCH',
          message:
            'New passwords do not match.',
          expose: true,
        },
        req,
      );
    }

    if (!isStrongPassword(newPassword)) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'WEAK_PASSWORD',
          message:
            'New password must be at least 12 characters and contain at least one uppercase letter, one lowercase letter, and one number, with no spaces.',
          expose: true,
        },
        req,
      );
    }

    if (currentPassword === newPassword) {
      return errorResponse(
        res,
        {
          statusCode: 400,
          errorCode: 'PASSWORD_UNCHANGED',
          message:
            'New password must be different from current password.',
          expose: true,
        },
        req,
      );
    }

    try {
      const user = await User.findById(
        userId,
      ).select('+password');

      if (!user) {
        return errorResponse(
          res,
          {
            statusCode: 404,
            errorCode: 'USER_NOT_FOUND',
            message: 'User not found.',
            expose: true,
          },
          req,
        );
      }

      const passwordMatches =
        await user.matchPassword(
          currentPassword,
        );

      if (!passwordMatches) {
        await auditEmailEvent(
          'change_password',
          user._id,
          user.email,
          {
            ...requestMetadata(req),
            reason:
              'Invalid current password',
          },
          false,
        );

        /**
         * Deliberately do not reveal additional authentication details.
         */
        return errorResponse(
          res,
          {
            statusCode: 401,
            errorCode: 'INVALID_CURRENT_PASSWORD',
            message:
              'Current password is incorrect.',
            expose: true,
          },
          req,
        );
      }

      /**
       * User model owns password hashing through its save middleware.
       */
      user.password = newPassword;

      await user.save();

      /**
       * Revoke active refresh sessions following a password change.
       *
       * This keeps the session lifecycle aligned with the password security
       * boundary.
       */
      await RefreshToken.updateMany(
        {
          userId: user._id,
          revokedAt: null,
        },
        {
          $set: {
            revokedAt: new Date(),
            revokedReason:
              'password_changed',
          },
        },
      );

      await auditEmailEvent(
        'change_password',
        user._id,
        user.email,
        requestMetadata(req),
        true,
      );

      logger.info(
        {
          userId: user._id,
          traceId: resolveTraceId(req),
        },
        '[EmailController] Password changed successfully',
      );

      return successResponse(
        res,
        null,
        'Password changed successfully.',
        req,
        200,
      );
    } catch (err) {
      await auditEmailEvent(
        'change_password',
        userId,
        req.user?.email ?? null,
        {
          ...requestMetadata(req),
          reason:
            err?.message ??
            'Password change failed',
        },
        false,
      );

      return sendControllerError(
        res,
        err,
        req,
        'PASSWORD_CHANGE_FAILED',
        'Unable to change password.',
        500,
      );
    }
  },
);

/**
 * =============================================================================
 * Verification status
 * =============================================================================
 */

/**
 * GET /api/email/verification-status
 */
export const getEmailVerificationStatus =
  asyncHandler(
    async (req, res) => {
      const userId =
        getAuthenticatedUserId(req);

      if (!userId) {
        return errorResponse(
          res,
          {
            statusCode: 401,
            errorCode:
              'AUTHENTICATION_REQUIRED',
            message: 'Not authenticated.',
            expose: true,
          },
          req,
        );
      }

      try {
        const user =
          await User.findById(userId)
            .select(
              'email isEmailVerified isVerified emailVerifiedAt',
            )
            .lean();

        if (!user) {
          return errorResponse(
            res,
            {
              statusCode: 404,
              errorCode: 'USER_NOT_FOUND',
              message: 'User not found.',
              expose: true,
            },
            req,
          );
        }

        const isVerified =
          Boolean(user.isEmailVerified) ||
          Boolean(user.isVerified);

        return successResponse(
          res,
          {
            email: user.email,
            isVerified,
            verifiedAt:
              user.emailVerifiedAt ??
              null,
          },
          'Email verification status retrieved successfully.',
          req,
          200,
        );
      } catch (err) {
        return sendControllerError(
          res,
          err,
          req,
          'EMAIL_VERIFICATION_STATUS_FAILED',
          'Failed to get verification status.',
          500,
        );
      }
    },
  );

/**
 * =============================================================================
 * Resend verification
 * =============================================================================
 */

/**
 * POST /api/email/resend-verification
 *
 * Authenticated endpoint.
 */
export const resendEmailVerification =
  asyncHandler(
    async (req, res) => {
      const userId =
        getAuthenticatedUserId(req);

      if (!userId) {
        return errorResponse(
          res,
          {
            statusCode: 401,
            errorCode:
              'AUTHENTICATION_REQUIRED',
            message: 'Authentication is required.',
            expose: true,
          },
          req,
        );
      }

      try {
        const user =
          await User.findById(userId);

        if (!user) {
          return errorResponse(
            res,
            {
              statusCode: 404,
              errorCode: 'USER_NOT_FOUND',
              message: 'User not found.',
              expose: true,
            },
            req,
          );
        }

        const isVerified =
          Boolean(user.isEmailVerified) ||
          Boolean(user.isVerified);

        if (isVerified) {
          return successResponse(
            res,
            null,
            'Email is already verified.',
            req,
            200,
          );
        }

        const result =
          await emailService.sendEmailVerification(
            user._id,
          );

        await auditEmailEvent(
          'resend_verification_email',
          user._id,
          user.email,
          requestMetadata(req),
          true,
        );

        return successResponse(
          res,
          null,
          result?.message ??
            'Verification email sent successfully.',
          req,
          200,
        );
      } catch (err) {
        await auditEmailEvent(
          'resend_verification_email',
          userId,
          req.user?.email ?? null,
          {
            ...requestMetadata(req),
            reason:
              err?.message ??
              'Failed to resend verification email',
          },
          false,
        );

        return sendControllerError(
          res,
          err,
          req,
          'EMAIL_VERIFICATION_RESEND_FAILED',
          'Failed to resend verification email.',
          400,
        );
      }
    },
  );

/**
 * =============================================================================
 * Administrative email configuration test
 * =============================================================================
 */

/**
 * POST /api/email/test
 *
 * Authorization should also normally be enforced by route middleware.
 * The controller retains the check as defense in depth.
 */
export const testEmailConfiguration =
  asyncHandler(
    async (req, res) => {
      if (
        req.user?.role !== 'admin'
      ) {
        return errorResponse(
          res,
          {
            statusCode: 403,
            errorCode: 'ADMIN_ACCESS_REQUIRED',
            message: 'Admin access required.',
            expose: true,
          },
          req,
        );
      }

      try {
        const result =
          await emailService.testEmailConfiguration();

        if (result?.success) {
          return successResponse(
            res,
            null,
            result.message ??
              'Email configuration is valid.',
            req,
            200,
          );
        }

        return errorResponse(
          res,
          {
            statusCode: 503,
            errorCode:
              'EMAIL_CONFIGURATION_INVALID',
            message:
              'Email configuration test failed.',
            details: {
              reason:
                result?.error ??
                undefined,
            },
            expose: true,
          },
          req,
        );
      } catch (err) {
        return sendControllerError(
          res,
          err,
          req,
          'EMAIL_CONFIGURATION_TEST_FAILED',
          'Email configuration test failed.',
          503,
        );
      }
    },
  );

/**
 * =============================================================================
 * Administrative test email
 * =============================================================================
 */

/**
 * POST /api/email/test-send
 */
export const sendTestEmail =
  asyncHandler(
    async (req, res) => {
      if (
        req.user?.role !== 'admin'
      ) {
        return errorResponse(
          res,
          {
            statusCode: 403,
            errorCode: 'ADMIN_ACCESS_REQUIRED',
            message: 'Admin access required.',
            expose: true,
          },
          req,
        );
      }

      const to = normalizeEmail(
        req.body?.to,
      );

      const subject =
        typeof req.body?.subject === 'string'
          ? req.body.subject.trim()
          : '';

      const message =
        typeof req.body?.message === 'string'
          ? req.body.message.trim()
          : '';

      if (
        !to ||
        !subject ||
        !message
      ) {
        return errorResponse(
          res,
          {
            statusCode: 400,
            errorCode:
              'TEST_EMAIL_FIELDS_REQUIRED',
            message:
              'Recipient email, subject, and message are required.',
            expose: true,
          },
          req,
        );
      }

      if (!isValidEmail(to)) {
        return errorResponse(
          res,
          {
            statusCode: 400,
            errorCode: 'INVALID_RECIPIENT_EMAIL',
            message:
              'Please provide a valid recipient email address.',
            expose: true,
          },
          req,
        );
      }

      if (subject.length > 200) {
        return errorResponse(
          res,
          {
            statusCode: 400,
            errorCode: 'INVALID_EMAIL_SUBJECT',
            message:
              'Subject must not exceed 200 characters.',
            expose: true,
          },
          req,
        );
      }

      if (message.length > 10_000) {
        return errorResponse(
          res,
          {
            statusCode: 400,
            errorCode: 'INVALID_EMAIL_MESSAGE',
            message:
              'Message must not exceed 10000 characters.',
            expose: true,
          },
          req,
        );
      }

      try {
        await emailService.sendEmail({
          to,
          subject,
          template: 'test_email',
          data: {
            message,
            sentBy:
              req.user?.name ??
              req.user?.email ??
              'TITech Community Capital Administrator',
            timestamp:
              new Date().toISOString(),
          },
        });

        await auditEmailEvent(
          'send_test_email',
          getAuthenticatedUserId(req),
          to,
          {
            ...requestMetadata(req),
            /**
             * Do not store the actual message body in the audit record.
             */
            subject,
          },
          true,
        );

        logger.info(
          {
            userId:
              getAuthenticatedUserId(req),
            traceId: resolveTraceId(req),
          },
          '[EmailController] Test email sent',
        );

        return successResponse(
          res,
          null,
          'Test email sent successfully.',
          req,
          200,
        );
      } catch (err) {
        await auditEmailEvent(
          'send_test_email',
          getAuthenticatedUserId(req),
          to,
          {
            ...requestMetadata(req),
            subject,
            reason:
              err?.message ??
              'Test email delivery failed',
          },
          false,
        );

        return sendControllerError(
          res,
          err,
          req,
          'TEST_EMAIL_SEND_FAILED',
          'Failed to send test email.',
          500,
        );
      }
    },
  );

/**
 * =============================================================================
 * Public export surface
 * =============================================================================
 *
 * Keep all current controller/rate-limiter names available to existing routes.
 * =============================================================================
 */

const emailController = {
  requestVerificationLimiter,
  requestResetLimiter,
  resetPasswordLimiter,
  verifyEmailLimiter,

  sendEmailVerification,
  sendVerificationEmailRequest,
  sendPasswordReset,
  legacyVerifyEmail,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  changePassword,

  resendEmailVerification,
  getEmailVerificationStatus,

  testEmailConfiguration,
  sendTestEmail,
};

export default emailController;