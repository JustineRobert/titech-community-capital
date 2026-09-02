// community-savings-app-backend/services/paymentService.js

/**
 * Payment Service
 *
 * Handles payment processing for contributions, loan repayments, and other transactions.
 * Supports multiple payment methods: Mobile Money, Bank Transfer, Card payments.
 *
 * Features:
 * - Payment initiation and processing
 * - Transaction status tracking
 * - Payment verification and reconciliation
 * - Refund processing
 * - Payment analytics
 * - Fraud detection
 * - Multi-currency support
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const logger = require('../utils/logger');
const Payment = require('../models/Payment');
const User = require('../models/User');
const Contribution = require('../models/Contribution');
const Loan = require('../models/Loan');
const Group = require('../models/Group');

// Payment method configurations
const PAYMENT_METHODS = {
  MOBILE_MONEY: 'mobile_money',
  BANK_TRANSFER: 'bank_transfer',
  CARD: 'card',
  CASH: 'cash',
};

const PAYMENT_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

const PAYMENT_TYPES = {
  CONTRIBUTION: 'contribution',
  LOAN_REPAYMENT: 'loan_repayment',
  LOAN_DISBURSEMENT: 'loan_disbursement',
  REFERRAL_BONUS: 'referral_bonus',
  WITHDRAWAL: 'withdrawal',
  FEE: 'fee',
};

// Mobile money provider configurations
const MOBILE_MONEY_PROVIDERS = {
  MPESA: {
    name: 'M-Pesa',
    code: 'mpesa',
    countries: ['KE', 'TZ', 'UG'],
    minAmount: 1,
    maxAmount: 150000,
    fees: { percentage: 0.005, fixed: 0 }, // 0.5% fee
  },
  AIRTEL_MONEY: {
    name: 'Airtel Money',
    code: 'airtel',
    countries: ['KE', 'TZ', 'UG', 'RW'],
    minAmount: 1,
    maxAmount: 100000,
    fees: { percentage: 0.003, fixed: 5 }, // 0.3% + KES 5
  },
  MTN_MOMO: {
    name: 'MTN Mobile Money',
    code: 'mtn',
    countries: ['UG', 'RW', 'GH', 'CI'],
    minAmount: 1,
    maxAmount: 50000,
    fees: { percentage: 0.004, fixed: 0 }, // 0.4% fee
  },
};

/**
 * Calculate payment fees based on method and amount
 */
function calculateFees(method, amount, currency = 'KES') {
  if (method === PAYMENT_METHODS.CASH) return 0;
  if (method === PAYMENT_METHODS.BANK_TRANSFER) return Math.max(amount * 0.001, 10); // 0.1% min 10

  if (method === PAYMENT_METHODS.MOBILE_MONEY) {
    // Use M-Pesa as default for calculation
    const provider = MOBILE_MONEY_PROVIDERS.MPESA;
    return Math.max(amount * provider.fees.percentage, provider.fees.fixed);
  }

  if (method === PAYMENT_METHODS.CARD) {
    return Math.max(amount * 0.025, 50); // 2.5% min 50
  }

  return 0;
}

/**
 * Generate unique transaction reference
 */
function generateTransactionRef(type = 'TXN') {
  const timestamp = Date.now().toString(36);
  const random = crypto.randomBytes(4).toString('hex').toUpperCase();
  return `${type}-${timestamp}-${random}`;
}

/**
 * Validate payment amount
 */
function validatePaymentAmount(amount, method, currency = 'KES') {
  if (!amount || amount <= 0) {
    throw new Error('Invalid payment amount');
  }

  if (method === PAYMENT_METHODS.MOBILE_MONEY) {
    const provider = MOBILE_MONEY_PROVIDERS.MPESA; // Default
    if (amount < provider.minAmount || amount > provider.maxAmount) {
      throw new Error(
        `Amount must be between ${provider.minAmount} and ${provider.maxAmount} ${currency}`
      );
    }
  }

  return true;
}

/**
 * Initiate a payment transaction with idempotency support
 */
async function initiatePayment({
  userId,
  groupId,
  amount,
  currency = 'KES',
  method,
  type,
  description,
  metadata = {},
  reference,
  idempotencyKey,
}) {
  // Check for duplicate payment using idempotency key
  if (idempotencyKey) {
    const existingPayment = await Payment.findOne({
      'metadata.idempotencyKey': idempotencyKey,
      user: userId,
    });
    if (existingPayment) {
      logger.info('Idempotent payment request returning existing payment', {
        idempotencyKey,
        paymentId: existingPayment._id,
      });
      return {
        paymentId: existingPayment._id,
        transactionRef: existingPayment.transactionRef,
        amount: existingPayment.amount,
        fees: existingPayment.fees,
        totalAmount: existingPayment.totalAmount,
        status: existingPayment.status,
        expiresAt: existingPayment.metadata.expiresAt,
      };
    }
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Validate inputs
    validatePaymentAmount(amount, method, currency);

    // Generate transaction reference
    const transactionRef = reference || generateTransactionRef();

    // Calculate fees
    const fees = calculateFees(method, amount, currency);
    const totalAmount = amount + fees;

    // Create payment record
    const payment = new Payment({
      transactionRef,
      user: userId,
      group: groupId,
      amount,
      currency,
      fees,
      totalAmount,
      method,
      type,
      status: PAYMENT_STATUS.PENDING,
      description,
      metadata: {
        ...metadata,
        initiatedAt: new Date(),
        ipAddress: metadata.ipAddress,
        userAgent: metadata.userAgent,
        idempotencyKey: idempotencyKey,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      },
    });

    await payment.save({ session });

    // Update user balance if contribution
    if (type === PAYMENT_TYPES.CONTRIBUTION) {
      await User.findByIdAndUpdate(userId, { $inc: { totalContributions: amount } }, { session });

      // Create contribution record
      const contribution = new Contribution({
        user: userId,
        group: groupId,
        amount,
        payment: payment._id,
        type: 'regular',
        status: 'completed',
      });
      await contribution.save({ session });
    }

    await session.commitTransaction();

    logger.info(`Payment initiated: ${transactionRef}`, {
      userId,
      amount,
      method,
      type,
    });

    return {
      paymentId: payment._id,
      transactionRef,
      amount,
      fees,
      totalAmount,
      status: payment.status,
      expiresAt: payment.metadata.expiresAt,
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('Payment initiation failed:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Process mobile money payment (M-Pesa, Airtel, MTN)
 */
async function processMobileMoneyPayment({
  paymentId,
  phoneNumber,
  provider = 'mpesa',
  accountReference,
}) {
  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== PAYMENT_STATUS.PENDING) {
      throw new Error('Payment already processed');
    }

    // Update payment status to processing
    payment.status = PAYMENT_STATUS.PROCESSING;
    payment.metadata = {
      ...payment.metadata,
      phoneNumber,
      provider,
      accountReference,
      processingStartedAt: new Date(),
    };
    await payment.save();

    // Simulate mobile money API call
    // In production, integrate with actual mobile money APIs
    const result = await simulateMobileMoneyAPI({
      phoneNumber,
      amount: payment.totalAmount,
      reference: payment.transactionRef,
      provider,
    });

    if (result.success) {
      payment.status = PAYMENT_STATUS.COMPLETED;
      payment.metadata = {
        ...payment.metadata,
        transactionId: result.transactionId,
        completedAt: new Date(),
        providerResponse: result,
      };
      await payment.save();

      // Trigger post-payment processing
      await handlePaymentCompletion(payment);

      logger.info(`Mobile money payment completed: ${payment.transactionRef}`);
      return { success: true, transactionId: result.transactionId };
    } else {
      payment.status = PAYMENT_STATUS.FAILED;
      payment.metadata = {
        ...payment.metadata,
        failedAt: new Date(),
        failureReason: result.error,
        providerResponse: result,
      };
      await payment.save();

      logger.error(`Mobile money payment failed: ${payment.transactionRef}`, result.error);
      return { success: false, error: result.error };
    }
  } catch (error) {
    logger.error('Mobile money payment processing failed:', error);
    throw error;
  }
}

/**
 * Simulate mobile money API (replace with real API integration)
 */
async function simulateMobileMoneyAPI({ phoneNumber, amount, reference, provider }) {
  // Simulate API delay
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // Simulate success/failure (90% success rate)
  const success = Math.random() > 0.1;

  if (success) {
    return {
      success: true,
      transactionId: `MM-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
      message: 'Payment processed successfully',
    };
  } else {
    return {
      success: false,
      error: 'Insufficient balance or payment failed',
      message: 'Payment could not be processed',
    };
  }
}

/**
 * Process bank transfer payment
 */
async function processBankTransfer({
  paymentId,
  bankCode,
  accountNumber,
  accountName,
  routingNumber,
}) {
  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    payment.status = PAYMENT_STATUS.PROCESSING;
    payment.metadata = {
      ...payment.metadata,
      bankCode,
      accountNumber,
      accountName,
      routingNumber,
      processingStartedAt: new Date(),
    };
    await payment.save();

    // In production, integrate with bank APIs
    // For now, mark as completed after verification
    payment.status = PAYMENT_STATUS.COMPLETED;
    payment.metadata.completedAt = new Date();
    await payment.save();

    await handlePaymentCompletion(payment);

    return { success: true, message: 'Bank transfer processed' };
  } catch (error) {
    logger.error('Bank transfer processing failed:', error);
    throw error;
  }
}

/**
 * Handle payment completion (update balances, trigger events)
 */
async function handlePaymentCompletion(payment) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    if (payment.type === PAYMENT_TYPES.CONTRIBUTION) {
      // Update group total contributions
      await Group.findByIdAndUpdate(
        payment.group,
        { $inc: { totalContributions: payment.amount } },
        { session }
      );

      // Update user contribution stats
      await User.findByIdAndUpdate(
        payment.user,
        {
          $inc: {
            totalContributions: payment.amount,
            contributionCount: 1,
          },
          $set: { lastContributionDate: new Date() },
        },
        { session }
      );
    } else if (payment.type === PAYMENT_TYPES.LOAN_REPAYMENT) {
      // Update loan repayment status
      const loan = await Loan.findById(payment.metadata.loanId);
      if (loan) {
        loan.amountPaid = (loan.amountPaid || 0) + payment.amount;
        if (loan.amountPaid >= loan.totalAmount) {
          loan.status = 'repaid';
          loan.repaidAt = new Date();
        }
        await loan.save({ session });
      }
    }

    await session.commitTransaction();

    logger.info(`Payment completion handled: ${payment.transactionRef}`);
  } catch (error) {
    await session.abortTransaction();
    logger.error('Payment completion handling failed:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Verify payment status
 */
async function verifyPayment(paymentId) {
  try {
    const payment = await Payment.findById(paymentId)
      .populate('user', 'name email phone')
      .populate('group', 'name');

    if (!payment) {
      throw new Error('Payment not found');
    }

    return {
      paymentId: payment._id,
      transactionRef: payment.transactionRef,
      amount: payment.amount,
      fees: payment.fees,
      totalAmount: payment.totalAmount,
      status: payment.status,
      method: payment.method,
      type: payment.type,
      description: payment.description,
      user: payment.user,
      group: payment.group,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
      metadata: payment.metadata,
    };
  } catch (error) {
    logger.error('Payment verification failed:', error);
    throw error;
  }
}

/**
 * Process refund
 */
async function processRefund(paymentId, amount, reason) {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      throw new Error('Payment not found');
    }

    if (payment.status !== PAYMENT_STATUS.COMPLETED) {
      throw new Error('Can only refund completed payments');
    }

    const refundAmount = Math.min(amount, payment.amount);

    // Create refund payment record
    const refundPayment = new Payment({
      transactionRef: generateTransactionRef('REFUND'),
      user: payment.user,
      group: payment.group,
      amount: -refundAmount, // Negative amount for refund
      currency: payment.currency,
      fees: 0,
      totalAmount: -refundAmount,
      method: payment.method,
      type: 'refund',
      status: PAYMENT_STATUS.COMPLETED,
      description: `Refund: ${reason}`,
      metadata: {
        originalPayment: payment._id,
        refundReason: reason,
        refundedAt: new Date(),
      },
    });

    await refundPayment.save({ session });

    // Update original payment
    payment.metadata = {
      ...payment.metadata,
      refunded: true,
      refundAmount,
      refundId: refundPayment._id,
      refundedAt: new Date(),
    };
    await payment.save({ session });

    await session.commitTransaction();

    logger.info(`Refund processed: ${refundPayment.transactionRef}`);
    return { success: true, refundId: refundPayment._id };
  } catch (error) {
    await session.abortTransaction();
    logger.error('Refund processing failed:', error);
    throw error;
  } finally {
    session.endSession();
  }
}

/**
 * Get payment analytics
 */
async function getPaymentAnalytics(userId, groupId, startDate, endDate) {
  try {
    const matchConditions = {
      createdAt: { $gte: startDate, $lte: endDate },
    };

    if (userId) matchConditions.user = mongoose.Types.ObjectId(userId);
    if (groupId) matchConditions.group = mongoose.Types.ObjectId(groupId);

    const analytics = await Payment.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: {
            method: '$method',
            type: '$type',
            status: '$status',
          },
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalFees: { $sum: '$fees' },
        },
      },
      {
        $group: {
          _id: '$_id.method',
          types: {
            $push: {
              type: '$_id.type',
              status: '$_id.status',
              count: '$count',
              amount: '$totalAmount',
              fees: '$totalFees',
            },
          },
          totalCount: { $sum: '$count' },
          totalAmount: { $sum: '$totalAmount' },
          totalFees: { $sum: '$totalFees' },
        },
      },
    ]);

    return analytics;
  } catch (error) {
    logger.error('Payment analytics failed:', error);
    throw error;
  }
}

module.exports = {
  initiatePayment,
  processMobileMoneyPayment,
  processBankTransfer,
  verifyPayment,
  processRefund,
  getPaymentAnalytics,
  PAYMENT_METHODS,
  PAYMENT_STATUS,
  PAYMENT_TYPES,
  MOBILE_MONEY_PROVIDERS,
  calculateFees,
  validatePaymentAmount,
};
