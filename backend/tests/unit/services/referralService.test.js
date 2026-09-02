/**
 * Referral Service Unit Tests
 */

const referralService = require('../../../services/referralService');
const Referral = require('../../../models/Referral');
const User = require('../../../models/User');


jest.mock('../../../models/Payment');
jest.mock('../../../utils/logger');

jest.mock('../../../models/Referral');
jest.mock('../../../models/User');
jest.mock('../../../models/Payment');
jest.mock('../../../utils/logger');
jest.mock('crypto');
jest.mock('mongoose', () => ({
  startSession: jest.fn().mockResolvedValue({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  }),
  Types: {
    ObjectId: jest.fn(),
  },
}));

describe('Referral Service', () => {
  const mockUser = {
    _id: 'user_123',
    email: 'user@example.com',
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('generateCode', () => {
    it('should generate unique referral code', async () => {
      Referral.findOne.mockResolvedValue(null);
      Referral.create.mockResolvedValue({
        code: 'ABC123DEF',
        referrer: mockUser._id,
        status: 'active',
        createdAt: new Date(),
      });

      const result = await referralService.generateCode(mockUser._id);

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('referralLink');
      expect(Referral.create).toHaveBeenCalled();
    });

    it('should return existing code if available', async () => {
      const existingCode = 'EXISTING123';
      Referral.findOne.mockResolvedValue({
        code: existingCode,
        referrer: mockUser._id,
        createdAt: new Date(),
      });

      const result = await referralService.generateCode(mockUser._id);

      expect(result.code).toBe(existingCode);
    });
  });

  describe('redeemCode', () => {
    it('should redeem referral code successfully', async () => {
      const referral = {
        _id: 'referral_123',
        code: 'ABC123',
        referrer: 'referrer_123',
        redeemed: false,
        used: false,
        expiresAt: new Date(Date.now() + 1000),
        save: jest.fn().mockResolvedValue(true),
      };

      Referral.findOne.mockResolvedValue(referral);
      User.findByIdAndUpdate.mockResolvedValue({});

      const result = await referralService.redeemCode('ABC123', mockUser._id);

      expect(result).toHaveProperty('referralId');
      expect(referral.save).toHaveBeenCalled();
    });

    it('should prevent self-referral', async () => {
      const referral = {
        code: 'ABC123',
        referrer: 'user_123', // Same as referredUserId
        redeemed: false,
        expiresAt: new Date(Date.now() + 1000),
      };

      referral.referrer.equals = jest.fn().mockReturnValue(true);

      Referral.findOne.mockResolvedValue(referral);

      await expect(referralService.redeemCode('ABC123', 'user_123')).rejects.toThrow(
        'Self-referral'
      );
    });

    it('should reject invalid code', async () => {
      Referral.findOne.mockResolvedValue(null);

      await expect(referralService.redeemCode('INVALID', mockUser._id)).rejects.toThrow(
        'Invalid or expired'
      );
    });

    it('should reject expired code', async () => {
      const referral = {
        code: 'EXPIRED',
        referrer: 'other_user',
        redeemed: false,
        expiresAt: new Date(Date.now() - 1000), // Expired
      };

      Referral.findOne.mockResolvedValue(referral);

      await expect(referralService.redeemCode('EXPIRED', mockUser._id)).rejects.toThrow('expired');
    });
  });

  describe('getReferralStats', () => {
    it('should return referral statistics', async () => {
      const stats = {
        _id: 'referrer_123',
        referralCount: 5,
        activeReferrals: 2,
        completedReferrals: 3,
        totalRewardsEarned: 1500,
      };

      Referral.findOne.mockResolvedValue({
        code: 'CODE123',
        referrer: 'referrer_123',
        createdAt: new Date(),
      });

      Referral.aggregate.mockResolvedValue([stats]);

      const result = await referralService.getReferralStats('referrer_123');

      expect(result).toHaveProperty('code');
      expect(result).toHaveProperty('referralLink');
      expect(result.referralCount).toBe(5);
    });
  });

  describe('generateReferralLink', () => {
    it('should generate referral link with code', () => {
      const link = referralService.generateReferralLink('ABC123');

      expect(link).toContain('referral');
      expect(link).toContain('ABC123');
    });
  });
});
