/**
 * Referral Service
 * Manages referral codes, tracking, and reward distribution
 * Features:
 * - Unique referral code generation
 * - Referral link tracking
 * - Reward distribution for referrer and referee
 * - Referral analytics and metrics
 */

const mongoose = require('mongoose');
const Referral = require('../models/Referral');
const User = require('../models/User');
const Payment = require('../models/Payment');
const crypto = require('crypto');
const logger = require('../utils/logger');

const REFERRAL_REWARDS = {
  REFERRER_BONUS: parseFloat(process.env.REFERRAL_BONUS_REFERRER || '500'), // KES
  REFEREE_BONUS: parseFloat(process.env.REFERRAL_BONUS_REFEREE || '250'), // KES
  MAX_REFERRALS: parseInt(process.env.REFERRAL_MAX_COUNT || '100'),
  BONUS_TRIGGER: process.env.REFERRAL_BONUS_TRIGGER || 'first_contribution', // When to award bonus
};

class ReferralService {
  /**
   * Generate unique referral code for user
   * @param {string} userId - User ID
   * @returns {Object} - { code, referralLink }
   */
  async generateCode(userId) {
    try {
      // Check if user already has an active code
      const existing = await Referral.findOne({
        referrer: userId,
        status: 'active',
        expiresAt: { $gt: new Date() },
      });

      if (existing) {
        logger.info('[ReferralService] Returning existing referral code', {
          userId,
          code: existing.code,
        });
        return {
          code: existing.code,
          referralLink: this.generateReferralLink(existing.code),
          createdAt: existing.createdAt,
        };
      }

      // Generate unique code
      let code;
      let isUnique = false;
      let attempts = 0;

      while (!isUnique && attempts < 10) {
        code = crypto.randomBytes(6).toString('hex').toUpperCase();
        const existing = await Referral.findOne({ code });
        isUnique = !existing;
        attempts++;
      }

      if (!isUnique) {
        throw new Error('Failed to generate unique referral code');
      }

      // Create referral record
      const referral = await Referral.create({
        code,
        referrer: userId,
        status: 'active',
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        referralCount: 0,
        totalRewardsEarned: 0,
        createdAt: new Date(),
      });

      logger.info('[ReferralService] Referral code generated', {
        userId,
        code,
        referralId: referral._id,
      });

      return {
        code: referral.code,
        referralLink: this.generateReferralLink(referral.code),
        createdAt: referral.createdAt,
        expiresAt: referral.expiresAt,
      };
    } catch (error) {
      logger.error('[ReferralService] Error generating code', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Redeem referral code and create referral relationship
   * @param {string} code - Referral code
   * @param {string} referredUserId - User redeeming the code
   * @returns {Object} - { referralId, referrerBonusEligible, refereeBonusEligible }
   */
  async redeemCode(code, referredUserId) {
    try {
      if (!code || !referredUserId) {
        throw new Error('Code and referred user ID are required');
      }

      // Find referral code
      const referral = await Referral.findOne({ code, status: 'active' });
      if (!referral) {
        throw new Error('Invalid or expired referral code');
      }

      // Prevent self-referral
      if (referral.referrer.equals(referredUserId)) {
        throw new Error('Self-referral is not allowed');
      }

      // Check if code has already been redeemed
      if (referral.redeemed) {
        throw new Error('Referral code has already been redeemed');
      }

      // Check if user already has a referrer
      const existingReferral = await Referral.findOne({
        referredUser: referredUserId,
      });

      if (existingReferral) {
        throw new Error('User has already redeemed a referral code');
      }

      // Check referral code expiration
      if (referral.expiresAt < new Date()) {
        throw new Error('Referral code has expired');
      }

      // Update referral record
      referral.referredUser = referredUserId;
      referral.redeemed = true;
      referral.redeemedAt = new Date();
      referral.referralCount = (referral.referralCount || 0) + 1;
      await referral.save();

      // Update referrer's referral count
      await User.findByIdAndUpdate(referral.referrer, {
        $inc: { referralCount: 1 },
      });

      logger.info('[ReferralService] Referral code redeemed', {
        code,
        referrer: referral.referrer,
        referredUser: referredUserId,
        referralId: referral._id,
      });

      return {
        referralId: referral._id,
        referrerBonusEligible: true,
        refereeBonusEligible: true,
        bonusTrigger: REFERRAL_REWARDS.BONUS_TRIGGER,
      };
    } catch (error) {
      logger.error('[ReferralService] Error redeeming code', {
        error: error.message,
        code,
        referredUserId,
      });
      throw error;
    }
  }

  /**
   * Award bonuses to referrer and referee
   * @param {string} referredUserId - User who triggered bonus
   * @returns {Object} - { referrerBonus, refereeBonus }
   */
  async awardBonuses(referredUserId) {
    try {
      const referral = await Referral.findOne({
        referredUser: referredUserId,
        redeemed: true,
        bonusAwarded: false,
      });

      if (!referral) {
        return { bonusAwarded: false, message: 'No eligible referral found' };
      }

      const session = require('mongoose').startSession();
      await session.startTransaction();

      try {
        // Award referrer bonus
        const referrerPayment = await Payment.create(
          [
            {
              user: referral.referrer,
              amount: REFERRAL_REWARDS.REFERRER_BONUS,
              type: 'referral_bonus',
              status: 'completed',
              description: `Referral bonus for referring user`,
              method: 'bonus',
              metadata: {
                referralId: referral._id,
                referredUser: referredUserId,
                awardedAt: new Date(),
              },
            },
          ],
          { session }
        );

        // Award referee bonus
        const refereePayment = await Payment.create(
          [
            {
              user: referredUserId,
              amount: REFERRAL_REWARDS.REFEREE_BONUS,
              type: 'referral_bonus',
              status: 'completed',
              description: `Referral bonus for joining with referral code`,
              method: 'bonus',
              metadata: {
                referralId: referral._id,
                referrer: referral.referrer,
                awardedAt: new Date(),
              },
            },
          ],
          { session }
        );

        // Update referral record
        referral.bonusAwarded = true;
        referral.bonusAwardedAt = new Date();
        referral.totalRewardsEarned =
          REFERRAL_REWARDS.REFERRER_BONUS + REFERRAL_REWARDS.REFEREE_BONUS;
        await referral.save({ session });

        // Update user referral statistics
        await User.findByIdAndUpdate(
          referral.referrer,
          {
            $inc: { totalReferralBonuses: REFERRAL_REWARDS.REFERRER_BONUS },
          },
          { session }
        );

        await User.findByIdAndUpdate(
          referredUserId,
          {
            $inc: { totalReferralBonuses: REFERRAL_REWARDS.REFEREE_BONUS },
          },
          { session }
        );

        await session.commitTransaction();

        logger.info('[ReferralService] Referral bonuses awarded', {
          referralId: referral._id,
          referrer: referral.referrer,
          referredUser: referredUserId,
          referrerBonus: REFERRAL_REWARDS.REFERRER_BONUS,
          refereeBonus: REFERRAL_REWARDS.REFEREE_BONUS,
        });

        return {
          bonusAwarded: true,
          referrerBonus: REFERRAL_REWARDS.REFERRER_BONUS,
          refereeBonus: REFERRAL_REWARDS.REFEREE_BONUS,
          message: 'Blonuses awarded successfully',
        };
      } catch (error) {
        await session.abortTransaction();
        throw error;
      } finally {
        session.endSession();
      }
    } catch (error) {
      logger.error('[ReferralService] Error awarding bonuses', {
        error: error.message,
        referredUserId,
      });
      throw error;
    }
  }

  /**
   * Get referral statistics for a user
   * @param {string} userId - User ID
   * @returns {Object} - Referral statistics
   */
  async getReferralStats(userId) {
    try {
      const referral = await Referral.findOne({ referrer: userId });

      if (!referral) {
        return {
          code: null,
          referralCount: 0,
          activeReferrals: 0,
          completedReferrals: 0,
          totalRewardsEarned: 0,
          bonusesAwarded: 0,
        };
      }

      const stats = await Referral.aggregate([
        {
          $match: { referrer: mongoose.Types.ObjectId(userId) },
        },
        {
          $group: {
            _id: '$referrer',
            referralCount: { $sum: 1 },
            activeReferrals: {
              $sum: { $cond: [{ $eq: ['$redeemed', false] }, 1, 0] },
            },
            completedReferrals: {
              $sum: { $cond: [{ $eq: ['$bonusAwarded', true] }, 1, 0] },
            },
            totalRewardsEarned: { $sum: '$totalRewardsEarned' },
          },
        },
      ]);

      const data = stats[0] || {};

      return {
        code: referral.code,
        referralLink: this.generateReferralLink(referral.code),
        referralCount: data.referralCount || 0,
        activeReferrals: data.activeReferrals || 0,
        completedReferrals: data.completedReferrals || 0,
        totalRewardsEarned: data.totalRewardsEarned || 0,
        createdAt: referral.createdAt,
        expiresAt: referral.expiresAt,
      };
    } catch (error) {
      logger.error('[ReferralService] Error getting referral stats', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Generate full referral link
   * @param {string} code - Referral code
   * @returns {string} - Full referral link URL
   */
  generateReferralLink(code) {
    const baseUrl = process.env.FRONTEND_URL || 'https://communitysavings.com';
    return `${baseUrl}/referral?code=${code}`;
  }
}

module.exports = new ReferralService();
