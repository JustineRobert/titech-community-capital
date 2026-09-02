// community-savings-app-backend/controllers/emailController.js

/**
 * Email Controller
 *
 * Handles email-related HTTP requests including:
 * - Email verification
 * - Password reset
 * - Email sending for notifications
 */

const asyncHandler = require('../utils/asyncHandler');
const emailService = require('../services/emailService');
const User = require('../models/User');
const logger = require('../utils/logger');
const crypto = require('crypto');
const EmailAudit = require('../models/EmailAudit');

const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../services/emailService');

// ✅ ADD THIS
const {
  requestVerificationLimiter,
  requestResetLimiter,
  resetPasswordLimiter,
  verifyEmailLimiter,
} = require('../middleware/rateLimiters');

/**
 * Send email verification
 * POST /api/email/send-verification
 */
async function sendEmailVerification(req, res) {
  try {
    const result = await emailService.sendEmailVerification(req.user._id);

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Send email verification error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to send verification email',
    });
  }
}

/**
 * Verify email with token
 * POST /api/email/verify
 */
async function verifyEmail(req, res) {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Verification token is required',
    });
  }

  try {
    const result = await emailService.verifyEmail(token);

    res.json({
      success: true,
      message: 'Email verified successfully',
      data: result.user,
    });
  } catch (error) {
    logger.error('Email verification error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Email verification failed',
    });
  }
}

/**
 * Send password reset email
 * POST /api/email/send-password-reset
 */
async function sendPasswordReset(req, res) {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: 'Email address is required',
    });
  }

  // Basic email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid email format',
    });
  }

  try {
    const result = await emailService.sendPasswordReset(email);

    // Always return success for security (don't reveal if email exists)
    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Send password reset error:', error);
    // Still return success for security
    res.json({
      success: true,
      message: 'If an account with that email exists, a reset link has been sent',
    });
  }
}

/**
 * Reset password with token
 * POST /api/email/reset-password
 */
async function resetPassword(req, res) {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({
      success: false,
      error: 'Token and new password are required',
    });
  }

  // Validate password strength
  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: 'Password must be at least 8 characters long',
    });
  }

  try {
    const result = await emailService.resetPassword(token, newPassword);

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Password reset error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Password reset failed',
    });
  }
}

/**
 * Resend email verification (if needed)
 * POST /api/email/resend-verification
 */
exports.resendEmailVerification = asyncHandler(async (req, res) => {
  try {
    // Check if user is already verified
    const user = await User.findById(req.user._id);
    if (user.isEmailVerified) {
      return res.status(400).json({
        success: false,
        error: 'Email is already verified',
      });
    }

    const result = await emailService.sendEmailVerification(req.user._id);

    res.json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    logger.error('Resend email verification error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Failed to resend verification email',
    });
  }
});

/**
 * Check email verification status
 * GET /api/email/verification-status
 */
exports.getEmailVerificationStatus = asyncHandler(async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('isEmailVerified emailVerifiedAt email');

    res.json({
      success: true,
      data: {
        email: user.email,
        isVerified: user.isEmailVerified,
        verifiedAt: user.emailVerifiedAt,
      },
    });
  } catch (error) {
    logger.error('Get email verification status error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get verification status',
    });
  }
});

/**
 * Test email configuration (admin only)
 * POST /api/email/test
 */
exports.testEmailConfiguration = asyncHandler(async (req, res) => {
  // Only allow admins to test email configuration
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
    });
  }

  try {
    const result = await emailService.testEmailConfiguration();

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error) {
    logger.error('Test email configuration error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Email configuration test failed',
    });
  }
});

/**
 * Send test email (admin only)
 * POST /api/email/test-send
 */
exports.sendTestEmail = asyncHandler(async (req, res) => {
  // Only allow admins to send test emails
  if (req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: 'Admin access required',
    });
  }

  const { to, subject, message } = req.body;

  if (!to || !subject || !message) {
    return res.status(400).json({
      success: false,
      error: 'Recipient email, subject, and message are required',
    });
  }

  try {
    const emailData = {
      to,
      subject,
      template: 'test_email',
      data: {
        message,
        sentBy: req.user.name,
        timestamp: new Date().toISOString(),
      },
    };

    await emailService.sendEmail(emailData);

    return res.json({
      success: true,
      message: 'Test email sent successfully',
    });
  } catch (error) {
    logger.error('Send test email error:', error);

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to send test email',
    });
  }
});

// ============================================================================
// Audit Logging
// ============================================================================

/**
 * Log email operations for security and debugging
 */
async function auditEmailEvent(event, userId, email, metadata = {}, success = true) {
  try {
    await EmailAudit.create({
      event,
      userId: userId || null,
      email: email?.toLowerCase() || null,
      ipAddress: metadata.ipAddress || null,
      userAgent: metadata.userAgent || null,
      status: success ? 'success' : 'failed',
      reason: metadata.reason || null,
      metadata,
      timestamp: new Date(),
    });
  } catch (err) {
    logger.error('[EmailAudit] Failed to log event', {
      event,
      error: err.message,
    });
  }
}

// ============================================================================
// Public Endpoints
// ============================================================================

/**
 * POST /api/auth/send-verification-email
 * Sends verification email to user (or authenticated user's email).
 * Rate limited to prevent abuse.
 */
async function sendVerificationEmailRequest(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: 'Email is required',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal user existence (security best practice)
      return res.status(200).json({
        message: 'If the email exists and is not verified, a verification link has been sent.',
      });
    }

    if (user.isVerified) {
      return res.status(200).json({
        message: 'Email is already verified.',
      });
    }

    // Generate verification token
    const verificationToken = user.generateVerificationToken();
    await user.save({ validateBeforeSave: false });

    // Send email
    const verificationUrl = `${process.env.FRONTEND_URL}/verify-email?token=${verificationToken}`;

    try {
      await sendVerificationEmail(user.email, user.name, verificationUrl);
      await auditEmailEvent(
        'send_verification_email',
        user._id,
        user.email,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
        },
        true
      );

      logger.info('[EmailController] Verification email sent', {
        userId: user._id,
        email: user.email,
      });

      return res.status(200).json({
        message: 'Verification email sent successfully.',
      });
    } catch (emailError) {
      // Rollback token if email fails
      user.verificationToken = null;
      user.verificationTokenExpires = null;
      await user.save({ validateBeforeSave: false });

      await auditEmailEvent(
        'send_verification_email',
        user._id,
        user.email,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          reason: emailError.message,
        },
        false
      );

      logger.error('[EmailController] Failed to send verification email', {
        userId: user._id,
        error: emailError.message,
      });

      return res.status(500).json({
        message: 'Failed to send verification email. Please try again later.',
      });
    }
  } catch (err) {
    logger.error('[EmailController] sendVerificationEmailRequest error', err);
    return res.status(500).json({
      message: 'Server error. Please try again later.',
    });
  }
}

/**
 * POST /api/auth/verify-email
 * Verifies email using the token sent to user's email.
 */
async function verifyEmail(req, res, next) {
  try {
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({
        message: 'Verification token is required.',
      });
    }

    // Hash token to match against stored hashed token
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      verificationToken: hashedToken,
      verificationTokenExpires: { $gt: Date.now() },
    });

    if (!user) {
      await auditEmailEvent(
        'verify_email',
        null,
        null,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          reason: 'Invalid or expired token',
        },
        false
      );

      return res.status(400).json({
        message: 'Invalid or expired verification token.',
      });
    }

    // Mark email as verified
    user.isVerified = true;
    user.verificationToken = null;
    user.verificationTokenExpires = null;
    await user.save({ validateBeforeSave: false });

    await auditEmailEvent(
      'verify_email',
      user._id,
      user.email,
      {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      },
      true
    );

    logger.info('[EmailController] Email verified successfully', {
      userId: user._id,
      email: user.email,
    });

    return res.status(200).json({
      message: 'Email verified successfully. You can now log in.',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        isVerified: user.isVerified,
      },
    });
  } catch (err) {
    logger.error('[EmailController] verifyEmail error', err);
    return res.status(500).json({
      message: 'Server error. Please try again later.',
    });
  }
}

/**
 * POST /api/auth/request-password-reset
 * Initiates password reset flow by sending reset link to email.
 */
async function requestPasswordReset(req, res, next) {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        message: 'Email is required.',
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal user existence (security best practice)
      return res.status(200).json({
        message: 'If an account exists for this email, a password reset link has been sent.',
      });
    }

    // Generate reset token
    const resetToken = user.generateResetToken();
    await user.save({ validateBeforeSave: false });

    // Send email
    const resetUrl = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;

    try {
      await sendPasswordResetEmail(user.email, user.name, resetUrl);

      await auditEmailEvent(
        'request_password_reset',
        user._id,
        user.email,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
        },
        true
      );

      logger.info('[EmailController] Password reset email sent', {
        userId: user._id,
        email: user.email,
      });

      return res.status(200).json({
        message: 'Password reset link has been sent to your email.',
      });
    } catch (emailError) {
      // Rollback token if email fails
      user.resetPasswordToken = null;
      user.resetPasswordExpires = null;
      await user.save({ validateBeforeSave: false });

      await auditEmailEvent(
        'request_password_reset',
        user._id,
        user.email,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          reason: emailError.message,
        },
        false
      );

      logger.error('[EmailController] Failed to send password reset email', {
        userId: user._id,
        error: emailError.message,
      });

      return res.status(500).json({
        message: 'Failed to send password reset email. Please try again later.',
      });
    }
  } catch (err) {
    logger.error('[EmailController] requestPasswordReset error', err);
    return res.status(500).json({
      message: 'Server error. Please try again later.',
    });
  }
}

/**
 * POST /api/auth/reset-password
 * Completes password reset using the token and new password.
 */
async function resetPassword(req, res, next) {
  try {
    const { token, password, confirmPassword } = req.body;

    if (!token || !password || !confirmPassword) {
      return res.status(400).json({
        message: 'Token, password, and password confirmation are required.',
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        message: 'Passwords do not match.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: 'Password must be at least 8 characters.',
      });
    }

    // Hash token to match against stored hashed token
    const hashedToken = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpires: { $gt: Date.now() },
    });

    if (!user) {
      await auditEmailEvent(
        'reset_password',
        null,
        null,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          reason: 'Invalid or expired token',
        },
        false
      );

      return res.status(400).json({
        message: 'Invalid or expired password reset token.',
      });
    }

    // Update password
    user.password = password;
    user.resetPasswordToken = null;
    user.resetPasswordExpires = null;

    // Reset failed login attempts on successful password change
    user.failedLoginAttempts = 0;
    user.lockUntil = null;

    await user.save();

    await auditEmailEvent(
      'reset_password',
      user._id,
      user.email,
      {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      },
      true
    );

    logger.info('[EmailController] Password reset successfully', {
      userId: user._id,
      email: user.email,
    });

    return res.status(200).json({
      message: 'Password reset successfully. You can now log in with your new password.',
    });
  } catch (err) {
    logger.error('[EmailController] resetPassword error', err);
    return res.status(500).json({
      message: 'Server error. Please try again later.',
    });
  }
}

/**
 * POST /api/auth/change-password
 * Changes password for authenticated user (requires old password).
 */
async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user?.id || req.user?._id;

    if (!userId) {
      return res.status(401).json({
        message: 'Not authenticated.',
      });
    }

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        message: 'Current password, new password, and confirmation are required.',
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        message: 'New passwords do not match.',
      });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({
        message: 'New password must be at least 8 characters.',
      });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({
        message: 'New password must be different from current password.',
      });
    }

    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({
        message: 'User not found.',
      });
    }

    const isMatch = await user.matchPassword(currentPassword);
    if (!isMatch) {
      await auditEmailEvent(
        'change_password',
        user._id,
        user.email,
        {
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
          reason: 'Invalid current password',
        },
        false
      );

      return res.status(401).json({
        message: 'Current password is incorrect.',
      });
    }

    user.password = newPassword;
    await user.save();

    await auditEmailEvent(
      'change_password',
      user._id,
      user.email,
      {
        ipAddress: req.ip,
        userAgent: req.get('User-Agent'),
      },
      true
    );

    logger.info('[EmailController] Password changed successfully', {
      userId: user._id,
      email: user.email,
    });

    return res.status(200).json({
      message: 'Password changed successfully.',
    });
  } catch (err) {
    logger.error('[EmailController] changePassword error', err);
    return res.status(500).json({
      message: 'Server error. Please try again later.',
    });
  }
}

module.exports = {
  // Rate limiters for use in routes
  requestVerificationLimiter,
  requestResetLimiter,
  resetPasswordLimiter,
  verifyEmailLimiter,

  // Controllers
  sendEmailVerification,
  sendVerificationEmailRequest,
  sendPasswordReset,
  verifyEmail,
  requestPasswordReset,
  resetPassword,
  changePassword,

  // Also export handlers attached via exports.* earlier
  resendEmailVerification: exports.resendEmailVerification,
  getEmailVerificationStatus: exports.getEmailVerificationStatus,
  testEmailConfiguration: exports.testEmailConfiguration,
  sendTestEmail: exports.sendTestEmail,
};
