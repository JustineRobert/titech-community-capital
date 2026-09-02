/**
 * Email Verification Service Unit Tests
 */

const emailVerificationService = require('../../../services/emailVerificationService');
const EmailVerificationToken = require('../../../models/EmailVerificationToken');
const User = require('../../../models/User');
const logger = require('../../../utils/logger');

jest.mock('../../../models/EmailVerificationToken');
jest.mock('../../../models/User');
jest.mock('../../../utils/logger');
jest.mock('crypto');

describe('Email Verification Service', () => {
  let mockUser;
  let mockEmailService;

  beforeEach(() => {
    jest.clearAllMocks();

    mockUser = {
      _id: '123456789',
      email: 'test@example.com',
      name: 'Test User',
      emailVerified: false,
    };

    mockEmailService = {
      sendVerificationEmail: jest.fn().mockResolvedValue(true),
    };
  });

  describe('generateTokenAndSend', () => {
    it('should generate verification token and send email', async () => {
      const service = new emailVerificationService.constructor({
        emailService: mockEmailService,
      });

      EmailVerificationToken.findOne.mockResolvedValue(null);
      EmailVerificationToken.create.mockResolvedValue({
        _id: 'token123',
        user: mockUser._id,
        tokenHash: 'hashed_token',
      });

      const result = await service.generateTokenAndSend(mockUser);

      expect(result).toBeDefined();
      expect(EmailVerificationToken.create).toHaveBeenCalled();
      expect(mockEmailService.sendVerificationEmail).toHaveBeenCalled();
    });

    it('should throw error if email already verified', async () => {
      const verifiedUser = { ...mockUser, emailVerified: true };
      const service = new emailVerificationService.constructor({
        emailService: mockEmailService,
      });

      await expect(service.generateTokenAndSend(verifiedUser)).rejects.toThrow(
        'Email already verified'
      );
    });

    it('should enforce resend throttling', async () => {
      const service = new emailVerificationService.constructor({
        emailService: mockEmailService,
        resendThrottleTime: 5 * 60 * 1000, // 5 minutes
      });

      const recentToken = {
        createdAt: new Date(),
      };

      EmailVerificationToken.findOne.mockResolvedValue(recentToken);

      await expect(service.generateTokenAndSend(mockUser, true)).rejects.toThrow(
        'Too many resend attempts'
      );
    });
  });

  describe('verifyToken', () => {
    it('should verify token and update user email', async () => {
      const service = new emailVerificationService.constructor();

      const tokenRecord = {
        user: mockUser._id,
        tokenHash: 'hashed_token',
        used: false,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
        save: jest.fn().mockResolvedValue(true),
      };

      EmailVerificationToken.findOne.mockResolvedValue(tokenRecord);
      User.findByIdAndUpdate.mockResolvedValue({
        ...mockUser,
        emailVerified: true,
        emailVerifiedAt: new Date(),
      });

      const result = await service.verifyToken(mockUser._id, 'plaintoken');

      expect(result.success).toBe(true);
      expect(tokenRecord.used).toBe(true);
      expect(User.findByIdAndUpdate).toHaveBeenCalled();
    });

    it('should throw error for invalid token', async () => {
      const service = new emailVerificationService.constructor();

      EmailVerificationToken.findOne.mockResolvedValue(null);

      await expect(service.verifyToken(mockUser._id, 'invalid_token')).rejects.toThrow(
        'Invalid verification token'
      );
    });

    it('should throw error for expired token', async () => {
      const service = new emailVerificationService.constructor();

      const expiredToken = {
        user: mockUser._id,
        used: false,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };

      EmailVerificationToken.findOne.mockResolvedValue(expiredToken);

      await expect(service.verifyToken(mockUser._id, 'expired_token')).rejects.toThrow(
        'token has expired'
      );
    });
  });
});
