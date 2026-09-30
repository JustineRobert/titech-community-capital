// tests/unit/services/emailService.test.js

const emailService = require('../../../services/emailService');
const User = require('../../../models/User');
const nodemailer = require('nodemailer');

// Mock dependencies
jest.mock('../../../models/User');
jest.mock('../../../utils/logger');
jest.mock('nodemailer');

describe('Email Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();

    // Mock nodemailer
    const mockTransporter = {
      sendMail: jest.fn().mockResolvedValue({ messageId: 'test-message-id' }),
      verify: jest.fn().mockResolvedValue(true),
    };

    nodemailer.createTransporter.mockReturnValue(mockTransporter);

    // Set up emailService with mocked transporter
    emailService.transporter = mockTransporter;
  });

  describe('sendEmailVerification', () => {
    const mockUser = {
      _id: 'user123',
      name: 'John Doe',
      email: 'john@example.com',
      isEmailVerified: false,
      save: jest.fn().mockResolvedValue(),
    };

    test('should send verification email successfully', async () => {
      User.findById.mockResolvedValue(mockUser);

      const result = await emailService.sendEmailVerification('user123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Verification email sent');
      expect(mockUser.emailVerificationToken).toBeDefined();
      expect(mockUser.emailVerificationExpires).toBeDefined();
      expect(mockUser.save).toHaveBeenCalled();
    });

    test('should throw error if user already verified', async () => {
      mockUser.isEmailVerified = true;

      await expect(emailService.sendEmailVerification('user123')).rejects.toThrow(
        'Email already verified'
      );
    });

    test('should throw error if user not found', async () => {
      User.findById.mockResolvedValue(null);

      await expect(emailService.sendEmailVerification('invalid')).rejects.toThrow('User not found');
    });
  });

  describe('verifyEmail', () => {
    const mockUser = {
      _id: 'user123',
      email: 'john@example.com',
      name: 'John Doe',
      isEmailVerified: false,
      emailVerificationToken: 'hashed-token',
      save: jest.fn().mockResolvedValue(),
    };

    test('should verify email successfully', async () => {
      User.findOne.mockResolvedValue(mockUser);

      // Mock crypto for token verification
      const crypto = require('crypto');
      jest.spyOn(crypto, 'createHash').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hashed-token'),
      });

      const result = await emailService.verifyEmail('raw-token');

      expect(result.success).toBe(true);
      expect(result.user.email).toBe('john@example.com');
      expect(mockUser.isEmailVerified).toBe(true);
      expect(mockUser.emailVerificationToken).toBeUndefined();
      expect(mockUser.emailVerifiedAt).toBeDefined();
    });

    test('should throw error for invalid or expired token', async () => {
      User.findOne.mockResolvedValue(null);

      await expect(emailService.verifyEmail('invalid-token')).rejects.toThrow(
        'Invalid or expired verification token'
      );
    });
  });

  describe('sendPasswordReset', () => {
    const mockUser = {
      _id: 'user123',
      name: 'John Doe',
      email: 'john@example.com',
      passwordResetToken: undefined,
      passwordResetExpires: undefined,
      save: jest.fn().mockResolvedValue(),
    };

    test('should send password reset email successfully', async () => {
      User.findOne.mockResolvedValue(mockUser);

      const result = await emailService.sendPasswordReset('john@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('reset link has been sent');
      expect(mockUser.passwordResetToken).toBeDefined();
      expect(mockUser.passwordResetExpires).toBeDefined();
    });

    test('should return success message even if user not found (security)', async () => {
      User.findOne.mockResolvedValue(null);

      const result = await emailService.sendPasswordReset('nonexistent@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('reset link has been sent');
    });
  });

  describe('resetPassword', () => {
    const mockUser = {
      _id: 'user123',
      email: 'john@example.com',
      passwordResetToken: 'hashed-token',
      passwordResetExpires: new Date(Date.now() + 3600000), // 1 hour from now
      password: 'oldpassword',
      save: jest.fn().mockResolvedValue(),
    };

    test('should reset password successfully', async () => {
      User.findOne.mockResolvedValue(mockUser);

      // Mock crypto for token verification
      const crypto = require('crypto');
      jest.spyOn(crypto, 'createHash').mockReturnValue({
        update: jest.fn().mockReturnThis(),
        digest: jest.fn().mockReturnValue('hashed-token'),
      });

      const result = await emailService.resetPassword('raw-token', 'NewPassword123!');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Password reset successful');
      expect(mockUser.password).toBe('NewPassword123!'); // Note: In real implementation, this would be hashed
      expect(mockUser.passwordResetToken).toBeUndefined();
      expect(mockUser.passwordChangedAt).toBeDefined();
    });

    test('should throw error for invalid or expired token', async () => {
      User.findOne.mockResolvedValue(null);

      await expect(emailService.resetPassword('invalid-token', 'NewPassword123!')).rejects.toThrow(
        'Invalid or expired reset token'
      );
    });

    test('should throw error for expired token', async () => {
      mockUser.passwordResetExpires = new Date(Date.now() - 3600000); // 1 hour ago
      User.findOne.mockResolvedValue(mockUser);

      await expect(emailService.resetPassword('raw-token', 'NewPassword123!')).rejects.toThrow(
        'Invalid or expired reset token'
      );
    });
  });

  describe('sendEmail', () => {
    test('should send email successfully', async () => {
      const emailData = {
        to: 'test@example.com',
        subject: 'Test Subject',
        template: 'test_template',
        data: { userName: 'John Doe' },
      };

      const result = await emailService.sendEmail(emailData);

      expect(result.messageId).toBe('test-message-id');
      expect(emailService.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'test@example.com',
          subject: 'Test Subject',
          html: expect.any(String),
          text: expect.any(String),
        })
      );
    });

    test('should throw error when email service not configured', async () => {
      emailService.transporter = null;

      await expect(
        emailService.sendEmail({ to: 'test@example.com', subject: 'Test' })
      ).rejects.toThrow('Email service not configured');
    });
  });

  describe('getEmailTemplate', () => {
    test('should return email verification template', () => {
      const template = emailService.getEmailTemplate('email_verification', {
        userName: 'John Doe',
        verificationUrl: 'http://example.com/verify',
        expiresIn: '24 hours',
      });

      expect(template.html).toContain('Welcome to Community Savings');
      expect(template.html).toContain('John Doe');
      expect(template.html).toContain('http://example.com/verify');
      expect(template.text).toContain('Please verify your email');
    });

    test('should return password reset template', () => {
      const template = emailService.getEmailTemplate('password_reset', {
        userName: 'John Doe',
        resetUrl: 'http://example.com/reset',
        expiresIn: '1 hour',
      });

      expect(template.html).toContain('Password Reset');
      expect(template.html).toContain('http://example.com/reset');
      expect(template.text).toContain('Reset your password');
    });

    test('should return welcome template', () => {
      const template = emailService.getEmailTemplate('welcome', {
        userName: 'John Doe',
        loginUrl: 'http://example.com/login',
        supportEmail: 'support@example.com',
      });

      expect(template.html).toContain('Welcome to Community Savings');
      expect(template.html).toContain('http://example.com/login');
      expect(template.text).toContain('Welcome');
    });

    test('should throw error for unknown template', () => {
      expect(() => {
        emailService.getEmailTemplate('unknown_template', {});
      }).toThrow("Email template 'unknown_template' not found");
    });
  });

  describe('testEmailConfiguration', () => {
    test('should return success when email service is configured', async () => {
      const result = await emailService.testEmailConfiguration();

      expect(result.success).toBe(true);
      expect(result.message).toBe('Email configuration is working');
    });

    test('should return error when email service fails', async () => {
      emailService.transporter.verify.mockRejectedValue(new Error('Connection failed'));

      const result = await emailService.testEmailConfiguration();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection failed');
    });

    test('should return error when transporter not initialized', async () => {
      emailService.transporter = null;

      const result = await emailService.testEmailConfiguration();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email transporter not initialized');
    });
  });

  describe('sendWelcomeEmail', () => {
    const mockUser = {
      _id: 'user123',
      name: 'John Doe',
      email: 'john@example.com',
    };

    test('should send welcome email successfully', async () => {
      User.findById.mockResolvedValue(mockUser);

      await emailService.sendWelcomeEmail('user123');

      expect(emailService.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'john@example.com',
          subject: 'Welcome to Community Savings!',
        })
      );
    });

    test('should not throw error if user not found', async () => {
      User.findById.mockResolvedValue(null);

      await expect(emailService.sendWelcomeEmail('invalid')).resolves.not.toThrow();
    });
  });

  describe('sendGroupInvitation', () => {
    test('should send group invitation email', async () => {
      await emailService.sendGroupInvitation(
        'invitee@example.com',
        'John Doe',
        'Test Group',
        'invite-token-123'
      );

      expect(emailService.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'invitee@example.com',
          subject: "You're invited to join Test Group",
        })
      );
    });
  });

  describe('sendPaymentConfirmation', () => {
    const mockUser = {
      _id: 'user123',
      email: 'john@example.com',
    };

    test('should send payment confirmation email', async () => {
      User.findById.mockResolvedValue(mockUser);

      const paymentDetails = {
        amount: 1000,
        method: 'mobile_money',
        transactionRef: 'TXN-123',
      };

      await emailService.sendPaymentConfirmation('user123', paymentDetails);

      expect(emailService.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'john@example.com',
          subject: 'Payment Confirmation - Community Savings',
        })
      );
    });
  });

  describe('sendLoanNotification', () => {
    const mockUser = {
      _id: 'user123',
      email: 'john@example.com',
    };

    test('should send loan approval notification', async () => {
      User.findById.mockResolvedValue(mockUser);

      const loanDetails = {
        amount: 5000,
        interestRate: 5,
        duration: 12,
      };

      await emailService.sendLoanNotification('user123', loanDetails, 'approved');

      expect(emailService.transporter.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'john@example.com',
          subject: 'Loan Approved - Community Savings',
        })
      );
    });
  });
});
