/**
 * Analytics Service
 * Comprehensive event tracking and metrics aggregation
 * Supports real-time events and historical analytics
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

const EVENT_TYPES = {
  // User events
  USER_REGISTERED: 'user.registered',
  USER_EMAIL_VERIFIED: 'user.email_verified',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  PASSWORD_RESET: 'user.password_reset',

  // Group events
  GROUP_CREATED: 'group.created',
  GROUP_MEMBER_JOINED: 'group.member_joined',
  GROUP_MEMBER_LEFT: 'group.member_left',

  // Payment events
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  // Contribution events
  CONTRIBUTION_MADE: 'contribution.made',
  CONTRIBUTION_FAILED: 'contribution.failed',

  // Loan events
  LOAN_REQUESTED: 'loan.requested',
  LOAN_APPROVED: 'loan.approved',
  LOAN_REJECTED: 'loan.rejected',
  LOAN_DISBURSED: 'loan.disbursed',
  LOAN_REPAID: 'loan.repaid',
  LOAN_DEFAULTED: 'loan.defaulted',

  // Chat events
  MESSAGE_SENT: 'message.sent',
  MESSAGE_READ: 'message.read',

  // Referral events
  REFERRAL_GENERATED: 'referral.generated',
  REFERRAL_USED: 'referral.used',
  REFERRAL_BONUS_AWARDED: 'referral.bonus_awarded',
};

class AnalyticsService extends EventEmitter {
  constructor(config = {}) {
    super();
    this.events = [];
    this.maxEvents = config.maxEvents || 10000;
    this.eventRetentionMs = config.eventRetentionMs || 24 * 60 * 60 * 1000; // 24 hours
    this.flushInterval = config.flushInterval || 5 * 60 * 1000; // 5 minutes

    // Start auto-cleanup
    this.startAutoCleanup();
  }

  /**
   * Track an event
   */
  trackEvent(eventType, userId, data = {}, metadata = {}) {
    const event = {
      id: `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: eventType,
      userId,
      data,
      metadata: {
        ...metadata,
        timestamp: new Date(),
        ip: metadata.ip,
        userAgent: metadata.userAgent,
      },
      createdAt: new Date(),
    };

    this.events.push(event);

    // Log event
    logger.info(`[Analytics] Event tracked: ${eventType}`, {
      eventId: event.id,
      userId,
      type: eventType,
      dataKeys: Object.keys(data),
    });

    // Emit event for real-time listeners
    this.emit(eventType, event);
    this.emit('event', event);

    // Limit array size
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    return event;
  }

  /**
   * Get payment metrics for a time period
   */
  async getPaymentMetrics(from, to, groupId = null) {
    try {
      const Transaction = require('../models/Transaction');

      const matchConditions = {
        createdAt: { $gte: from, $lte: to },
      };

      if (groupId) {
        matchConditions.group = require('mongoose').Types.ObjectId(groupId);
      }

      return await Transaction.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: {
              status: '$status',
              method: '$method',
            },
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            avgAmount: { $avg: '$amount' },
          },
        },
        {
          $group: {
            _id: null,
            byStatus: {
              $push: {
                status: '$_id.status',
                method: '$_id.method',
                count: '$count',
                totalAmount: '$totalAmount',
                avgAmount: '$avgAmount',
              },
            },
            totalCount: { $sum: '$count' },
            totalRevenue: { $sum: '$totalAmount' },
          },
        },
      ]);
    } catch (error) {
      logger.error('[Analytics] Error getting payment metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get user metrics
   */
  async getUserMetrics(days = 30) {
    try {
      const User = require('../models/User');
      const from = new Date(Date.now() - days * 24 * 3600 * 1000);

      return await User.aggregate([
        { $match: { createdAt: { $gte: from } } },
        {
          $group: {
            _id: null,
            totalNew: { $sum: 1 },
            totalVerified: {
              $sum: { $cond: ['$emailVerified', 1, 0] },
            },
            totalActive: {
              $sum: { $cond: [{ $gte: ['$lastLoginAt', from] }, 1, 0] },
            },
            verificationRate: {
              $avg: { $cond: ['$emailVerified', 1, 0] },
            },
          },
        },
      ]);
    } catch (error) {
      logger.error('[Analytics] Error getting user metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get loan metrics
   */
  async getLoanMetrics() {
    try {
      const Loan = require('../models/Loan');

      return await Loan.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            avgAmount: { $avg: '$amount' },
            activeLoans: {
              $sum: { $cond: [{ $eq: ['$status', 'active'] }, 1, 0] },
            },
          },
        },
        {
          $group: {
            _id: null,
            byStatus: {
              $push: {
                status: '$_id',
                count: '$count',
                totalAmount: '$totalAmount',
                avgAmount: '$avgAmount',
              },
            },
            totalCount: { $sum: '$count' },
            totalLent: { $sum: '$totalAmount' },
            activeCount: { $sum: '$activeLoans' },
          },
        },
      ]);
    } catch (error) {
      logger.error('[Analytics] Error getting loan metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get referral metrics
   */
  async getReferralMetrics() {
    try {
      const Referral = require('../models/Referral');

      return await Referral.aggregate([
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            redeemed: { $sum: { $cond: ['$redeemed', 1, 0] } },
            bonusAwarded: { $sum: { $cond: ['$bonusAwarded', 1, 0] } },
            conversionRate: { $avg: { $cond: ['$redeemed', 1, 0] } },
            totalRewardsDistributed: { $sum: '$totalRewardsEarned' },
          },
        },
      ]);
    } catch (error) {
      logger.error('[Analytics] Error getting referral metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get contribution metrics
   */
  async getContributionMetrics(groupId = null) {
    try {
      const Contribution = require('../models/Contribution');

      const matchConditions = {};
      if (groupId) {
        matchConditions.group = require('mongoose').Types.ObjectId(groupId);
      }

      return await Contribution.aggregate([
        { $match: matchConditions },
        {
          $group: {
            _id: {
              group: '$group',
              status: '$status',
            },
            count: { $sum: 1 },
            totalAmount: { $sum: '$amount' },
            avgAmount: { $avg: '$amount' },
          },
        },
        {
          $group: {
            _id: '$_id.group',
            byStatus: {
              $push: {
                status: '$_id.status',
                count: '$count',
                totalAmount: '$totalAmount',
                avgAmount: '$avgAmount',
              },
            },
            totalCount: { $sum: '$count' },
            totalContribution: { $sum: '$totalAmount' },
          },
        },
      ]);
    } catch (error) {
      logger.error('[Analytics] Error getting contribution metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get dashboard summary metrics
   */
  async getDashboardMetrics(timeframe = '24h') {
    try {
      const from = this.getFromDate(timeframe);
      const to = new Date();

      const [paymentMetrics, userMetrics, loanMetrics, referralMetrics, contributionMetrics] =
        await Promise.all([
          this.getPaymentMetrics(from, to),
          this.getUserMetrics(this.getDateDays(timeframe)),
          this.getLoanMetrics(),
          this.getReferralMetrics(),
          this.getContributionMetrics(),
        ]);

      return {
        timeframe,
        from,
        to,
        payments: paymentMetrics,
        users: userMetrics,
        loans: loanMetrics,
        referrals: referralMetrics,
        contributions: contributionMetrics,
        generatedAt: new Date(),
      };
    } catch (error) {
      logger.error('[Analytics] Error getting dashboard metrics', { error: error.message });
      throw error;
    }
  }

  /**
   * Get events for a user
   */
  getEventsByUser(userId, limit = 100) {
    return this.events
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Get events by type
   */
  getEventsByType(eventType, limit = 100) {
    return this.events
      .filter((e) => e.type === eventType)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit);
  }

  /**
   * Get recent events
   */
  getRecentEvents(limit = 100) {
    return this.events.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit);
  }

  /**
   * Helper: Get from date based on timeframe
   */
  getFromDate(timeframe) {
    const now = new Date();
    switch (timeframe) {
      case '24h':
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
      case '7d':
        return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      case '30d':
        return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      case '90d':
        return new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
      default:
        return new Date(now.getTime() - 24 * 60 * 60 * 1000);
    }
  }

  /**
   * Helper: Get days from timeframe
   */
  getDateDays(timeframe) {
    switch (timeframe) {
      case '24h':
        return 1;
      case '7d':
        return 7;
      case '30d':
        return 30;
      case '90d':
        return 90;
      default:
        return 1;
    }
  }

  /**
   * Start automatic cleanup of old events
   */
  startAutoCleanup() {
    setInterval(() => {
      const cutoff = Date.now() - this.eventRetentionMs;
      const beforeCount = this.events.length;

      this.events = this.events.filter((e) => e.createdAt.getTime() > cutoff);

      const removed = beforeCount - this.events.length;
      if (removed > 0) {
        logger.debug(`[Analytics] Cleaned up ${removed} old events`);
      }
    }, this.flushInterval);
  }
}

module.exports = new AnalyticsService();
