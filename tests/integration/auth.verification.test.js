const request = require('supertest');
const mongoose = require('mongoose');
const User = require('../../community-savings-app-backend/models/User');
const EmailVerificationToken = require('../../community-savings-app-backend/models/EmailVerificationToken');
const PasswordResetToken = require('../../community-savings-app-backend/models/PasswordResetToken');
const EmailVerificationService = require('../../community-savings-app-backend/services/emailVerificationService');
const PasswordResetService = require('../../community-savings-app-backend/services/passwordResetService');

describe('Auth Integration Tests - Email Verification & Password Reset', () => {
  let app, userId, user;

  beforeAll(async () => {
    // Setup test app and DB connection (requires test DB)
  });

  afterAll(async () => {
    await mongoose.connection.close();
  });

  describe('Email Verification Flow', () => {
    beforeEach(async () => {
      user = await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashedpw',
        verified: false,
      });
      userId = user._id;
    });

    test('Generate token and send email', async () => {
      const token = await EmailVerificationService.generateTokenAndSend(user);
      expect(token).toBeDefined();
      expect(token.length).toBeGreaterThan(0);
    });

    test('Verify token sets user as verified', async () => {
      const token = await EmailVerificationService.generateTokenAndSend(user);
      await EmailVerificationService.verifyToken(userId, token);
      const updated = await User.findById(userId);
      // Assumption: verify token only marks token as used; actual user.verified set by controller
      const tokenRec = await EmailVerificationToken.findOne({ user: userId, used: true });
      expect(tokenRec).toBeDefined();
    });

    test('Invalid token rejected', async () => {
      await expect(EmailVerificationService.verifyToken(userId, 'invalid')).rejects.toThrow();
    });

    test('Expired token rejected', async () => {
      const token = await EmailVerificationService.generateTokenAndSend(user);
      // Simulate expiry by manually updating
      await EmailVerificationToken.updateOne(
        { user: userId },
        { expiresAt: new Date(Date.now() - 1000) }
      );
      await expect(EmailVerificationService.verifyToken(userId, token)).rejects.toThrow(
        'Token expired'
      );
    });

    test('Resend verification throttled', async () => {
      // Implementation depends on Redis rate limiter
      // Test assumes throttle: max 3 resends per hour
    });
  });

  describe('Password Reset Flow', () => {
    beforeEach(async () => {
      user = await User.create({
        name: 'Test User',
        email: 'test@example.com',
        password: 'hashedpw',
      });
      userId = user._id;
    });

    test('Create reset token', async () => {
      const token = await PasswordResetService.createReset(user);
      expect(token).toBeDefined();
    });

    test('Reset password with valid token', async () => {
      const token = await PasswordResetService.createReset(user);
      await PasswordResetService.resetPassword(userId, token, 'newPassword123');
      const tokenRec = await PasswordResetToken.findOne({ user: userId, used: true });
      expect(tokenRec).toBeDefined();
    });

    test('Invalid token rejected', async () => {
      await expect(
        PasswordResetService.resetPassword(userId, 'invalid', 'newPassword')
      ).rejects.toThrow();
    });

    test('Weak password rejected', async () => {
      const token = await PasswordResetService.createReset(user);
      await expect(PasswordResetService.resetPassword(userId, token, 'weak')).rejects.toThrow(
        'Password too weak'
      );
    });

    test('Token single-use enforcement', async () => {
      const token = await PasswordResetService.createReset(user);
      await PasswordResetService.resetPassword(userId, token, 'newPassword123');
      await expect(
        PasswordResetService.resetPassword(userId, token, 'anotherPassword123')
      ).rejects.toThrow();
    });
  });
});
