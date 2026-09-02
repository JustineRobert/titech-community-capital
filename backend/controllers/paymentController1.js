// community-savings-app-backend/controllers/paymentController.js

/**
 * TITech Community Capital LTD
 * Payment Controller
 *
 * Handles payment-related HTTP requests including:
 * - Payment initiation
 * - Payment processing
 * - Payment verification
 * - Refunds
 * - Payment history
 * - Payment analytics
 */

// controllers/paymentController.js (top of file)
const FraudDetectionService = require('../services/fraudDetectionService');
const EventStreamService = require('../services/eventStreamService');
const FraudLog = require('../models/FraudLog');
const ComplianceLog = require('../models/ComplianceLog');
const asyncHandler = require('../utils/asyncHandler');
const paymentService = require('../services/paymentService');
const Payment = require('../models/Payment');
const logger = require('../utils/logger');

// Support both named and class-style exports from the fraud service
const detectFraud = FraudDetectionService.detectFraud || FraudDetectionService.checkTransaction || FraudDetectionService.check || FraudDetectionService;


/**
 * Initiate a new payment
 * POST /api/payments/initiate
 */
exports.initiatePayment = asyncHandler(async (req, res) => {
  const { groupId, amount, currency = 'KES', method, type, description, metadata = {} } = req.body;

  // Validate required fields
  if (!groupId || !amount || !method || !type) {
    return res.status(400).json({
      success: false,
      error: 'Missing required fields: groupId, amount, method, type',
    });
  }

  // Validate payment method
  const validMethods = Object.values(paymentService.PAYMENT_METHODS);
  if (!validMethods.includes(method)) {
    return res.status(400).json({
      success: false,
      error: `Invalid payment method. Valid methods: ${validMethods.join(', ')}`,
    });
  }

  // Validate payment type
  const validTypes = Object.values(paymentService.PAYMENT_TYPES);
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      error: `Invalid payment type. Valid types: ${validTypes.join(', ')}`,
    });
  }

  try {
    // Add user context to metadata
    const enrichedMetadata = {
      ...metadata,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user._id,
    };

    // Build a lightweight transaction object for fraud check
    const transactionForCheck = {
      _id: `intent-${req.user._id}-${Date.now()}`,
      type,
      amount: parseFloat(amount),
      method,
      metadata: enrichedMetadata,
      // optional signals
      frequency: 9999,
      newDevice: !!enrichedMetadata.newDevice,
      locationMismatch: !!enrichedMetadata.locationMismatch,
      device: { deviceId: enrichedMetadata.deviceId || null, userAgent: enrichedMetadata.userAgent || null },
      geo: enrichedMetadata.geo || {}
    };

    // Run synchronous fraud check (fast path)
    let fraudResult = { fraudScore: 0, decision: 'ALLOW' };
    try {
      const r = await detectFraud(req.user, transactionForCheck);
      // Support different return shapes
      fraudResult.fraudScore = r?.fraudScore ?? r?.score ?? 0;
      fraudResult.decision = (r?.decision || r?.action || 'ALLOW').toUpperCase();
    } catch (err) {
      // Non-fatal: log and continue with conservative posture
      logger.warn('[PaymentController] Fraud detection failed (initiatePayment)', { error: err?.message || err });
      fraudResult = { fraudScore: 0.0, decision: 'STEP_UP' };
    }

    // Persist fraud log (best-effort)
    try {
      await FraudLog.createLog({
        tenantId: req.user.tenantId || 'default',
        userId: req.user._id,
        transactionId: transactionForCheck._id,
        transactionSnapshot: {
          type: transactionForCheck.type,
          amount: transactionForCheck.amount,
          metadata: transactionForCheck.metadata
        },
        fraudScore: Number(fraudResult.fraudScore) || 0,
        decision: fraudResult.decision === 'BLOCK' ? 'BLOCK' : fraudResult.decision === 'STEP_UP' ? 'STEP_UP' : 'ALLOW',
        engine: 'hybrid',
        explain: { source: 'initiatePayment' },
        modelVersion: process.env.FRAUD_MODEL_VERSION || 'v1'
      });
    } catch (err) {
      logger.warn('[PaymentController] Failed to persist FraudLog (initiatePayment)', err?.message || err);
    }

    // If blocked, return 403
    if (fraudResult.decision === 'BLOCK') {
      // Create compliance STR (best-effort)
      try {
        await ComplianceLog.createSTR({
          tenantId: req.user.tenantId || 'default',
          userId: req.user._id,
          activity: 'STR_GENERATED',
          flagged: true,
          reason: 'Transaction blocked by fraud engine',
          details: { fraudScore: fraudResult.fraudScore, transactionId: transactionForCheck._id },
          reporter: 'fraud-engine'
        });
      } catch (e) {
        logger.warn('[PaymentController] Failed to create STR for blocked transaction', e?.message || e);
      }

      return res.status(403).json({
        success: false,
        message: 'Transaction blocked by fraud detection',
        data: { fraudScore: fraudResult.fraudScore }
      });
    }

    // Enqueue to event stream for async feature extraction / ML (best-effort)
    try {
      await EventStreamService.pushTransaction({
        _id: transactionForCheck._id,
        userId: req.user._id,
        tenantId: req.user.tenantId || 'default',
        type: transactionForCheck.type,
        amount: transactionForCheck.amount,
        metadata: { ...transactionForCheck.metadata, fraudScore: fraudResult.fraudScore, decision: fraudResult.decision }
      });
    } catch (e) {
      logger.warn('[PaymentController] EventStream push failed (initiatePayment)', e?.message || e);
    }

    // If STEP_UP, instruct caller to perform step-up auth (OTP/KYC)
    if (fraudResult.decision === 'STEP_UP') {
      return res.status(202).json({
        success: true,
        message: 'Transaction requires step-up authentication',
        data: { action: 'step_up_auth', fraudScore: fraudResult.fraudScore }
      });
    }

    // Proceed to create payment intent via paymentService
    const result = await paymentService.initiatePayment({
      userId: req.user._id,
      groupId,
      amount: parseFloat(amount),
      currency,
      method,
      type,
      description,
      metadata: enrichedMetadata,
    });

    res.status(201).json({
      success: true,
      data: result,
      message: 'Payment initiated successfully',
    });
  } catch (error) {
    logger.error('Payment initiation error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Payment initiation failed',
    });
  }
});

/**
 * Process mobile money payment
 * POST /api/payments/:paymentId/mobile-money
 */
exports.processMobileMoneyPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { phoneNumber, provider = 'mpesa', accountReference } = req.body;

  if (!phoneNumber) {
    return res.status(400).json({
      success: false,
      error: 'Phone number is required',
    });
  }

  try {
    // Build transaction object for fraud check
    const transactionForCheck = {
      _id: paymentId,
      type: 'mobile_money',
      amount: req.body.amount || 0,
      frequency: req.body.frequency || 9999,
      newDevice: !!req.body.newDevice,
      locationMismatch: !!req.body.locationMismatch,
      device: { deviceId: req.body.deviceId || null, userAgent: req.get('User-Agent') },
      geo: req.body.geo || {},
      metadata: { phoneNumber, provider, accountReference }
    };

    // Run fraud detection
    let fraudResult = { fraudScore: 0, decision: 'ALLOW' };
    try {
      const r = await detectFraud(req.user, transactionForCheck);
      fraudResult.fraudScore = r?.fraudScore ?? r?.score ?? 0;
      fraudResult.decision = (r?.decision || r?.action || 'ALLOW').toUpperCase();
    } catch (err) {
      logger.warn('[PaymentController] Fraud detection failed (mobile money)', { error: err?.message || err });
      fraudResult = { fraudScore: 0.0, decision: 'STEP_UP' };
    }

    // Persist fraud log (best-effort)
    try {
      await FraudLog.createLog({
        tenantId: req.user.tenantId || 'default',
        userId: req.user._id,
        transactionId: paymentId,
        transactionSnapshot: {
          type: transactionForCheck.type,
          amount: transactionForCheck.amount,
          metadata: transactionForCheck.metadata
        },
        fraudScore: Number(fraudResult.fraudScore) || 0,
        decision: fraudResult.decision === 'BLOCK' ? 'BLOCK' : fraudResult.decision === 'STEP_UP' ? 'STEP_UP' : 'ALLOW',
        engine: 'hybrid',
        explain: { source: 'processMobileMoneyPayment' },
        modelVersion: process.env.FRAUD_MODEL_VERSION || 'v1'
      });
    } catch (err) {
      logger.warn('[PaymentController] Failed to persist FraudLog (mobile money)', err?.message || err);
    }

    // Block if necessary
    if (fraudResult.decision === 'BLOCK') {
      try {
        await ComplianceLog.createSTR({
          tenantId: req.user.tenantId || 'default',
          userId: req.user._id,
          activity: 'STR_GENERATED',
          flagged: true,
          reason: 'Mobile money transaction blocked by fraud engine',
          details: { fraudScore: fraudResult.fraudScore, paymentId },
          reporter: 'fraud-engine'
        });
      } catch (e) {
        logger.warn('[PaymentController] Failed to create STR for blocked mobile money', e?.message || e);
      }

      return res.status(403).json({
        success: false,
        message: 'Transaction blocked by fraud detection',
        data: { fraudScore: fraudResult.fraudScore }
      });
    }

    // If step-up required, return 202 instructing caller to perform OTP/KYC
    if (fraudResult.decision === 'STEP_UP') {
      return res.status(202).json({
        success: true,
        message: 'Transaction requires step-up authentication',
        data: { action: 'step_up_auth', fraudScore: fraudResult.fraudScore }
      });
    }

    // Enqueue to event stream for async processing (best-effort)
    try {
      await EventStreamService.pushTransaction({
        _id: paymentId,
        userId: req.user._id,
        tenantId: req.user.tenantId || 'default',
        type: 'mobile_money',
        amount: transactionForCheck.amount,
        metadata: { phoneNumber, provider, accountReference, fraudScore: fraudResult.fraudScore }
      });
    } catch (e) {
      logger.warn('[PaymentController] EventStream push failed (mobile money)', e?.message || e);
    }

    // Proceed to process payment via paymentService
    const result = await paymentService.processMobileMoneyPayment({
      paymentId,
      phoneNumber,
      provider,
      accountReference,
    });

    if (result.success) {
      res.json({
        success: true,
        data: result,
        message: 'Mobile money payment processed successfully',
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || 'Payment processing failed',
      });
    }
  } catch (error) {
    logger.error('Mobile money payment error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Mobile money payment failed',
    });
  }
});


/**
 * Process bank transfer payment
 * POST /api/payments/:paymentId/bank-transfer
 */
exports.processBankTransfer = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { bankCode, accountNumber, accountName, routingNumber } = req.body;

  if (!bankCode || !accountNumber || !accountName) {
    return res.status(400).json({
      success: false,
      error: 'Bank code, account number, and account name are required',
    });
  }

  try {
    // Build transaction object for fraud check
    const transactionForCheck = {
      _id: paymentId,
      type: 'bank_transfer',
      amount: req.body.amount || 0,
      frequency: req.body.frequency || 9999,
      newDevice: !!req.body.newDevice,
      locationMismatch: !!req.body.locationMismatch,
      device: { deviceId: req.body.deviceId || null, userAgent: req.get('User-Agent') },
      geo: req.body.geo || {},
      metadata: { bankCode, accountNumber, accountName, routingNumber }
    };

    // Run fraud detection
    let fraudResult = { fraudScore: 0, decision: 'ALLOW' };
    try {
      const r = await detectFraud(req.user, transactionForCheck);
      fraudResult.fraudScore = r?.fraudScore ?? r?.score ?? 0;
      fraudResult.decision = (r?.decision || r?.action || 'ALLOW').toUpperCase();
    } catch (err) {
      logger.warn('[PaymentController] Fraud detection failed (bank transfer)', { error: err?.message || err });
      fraudResult = { fraudScore: 0.0, decision: 'STEP_UP' };
    }

    // Persist fraud log (best-effort)
    try {
      await FraudLog.createLog({
        tenantId: req.user.tenantId || 'default',
        userId: req.user._id,
        transactionId: paymentId,
        transactionSnapshot: {
          type: transactionForCheck.type,
          amount: transactionForCheck.amount,
          metadata: transactionForCheck.metadata
        },
        fraudScore: Number(fraudResult.fraudScore) || 0,
        decision: fraudResult.decision === 'BLOCK' ? 'BLOCK' : fraudResult.decision === 'STEP_UP' ? 'STEP_UP' : 'ALLOW',
        engine: 'hybrid',
        explain: { source: 'processBankTransfer' },
        modelVersion: process.env.FRAUD_MODEL_VERSION || 'v1'
      });
    } catch (err) {
      logger.warn('[PaymentController] Failed to persist FraudLog (bank transfer)', err?.message || err);
    }

    // Block if necessary
    if (fraudResult.decision === 'BLOCK') {
      try {
        await ComplianceLog.createSTR({
          tenantId: req.user.tenantId || 'default',
          userId: req.user._id,
          activity: 'STR_GENERATED',
          flagged: true,
          reason: 'Bank transfer blocked by fraud engine',
          details: { fraudScore: fraudResult.fraudScore, paymentId },
          reporter: 'fraud-engine'
        });
      } catch (e) {
        logger.warn('[PaymentController] Failed to create STR for blocked bank transfer', e?.message || e);
      }

      return res.status(403).json({
        success: false,
        message: 'Transaction blocked by fraud detection',
        data: { fraudScore: fraudResult.fraudScore }
      });
    }

    // If step-up required, return 202 instructing caller to perform OTP/KYC
    if (fraudResult.decision === 'STEP_UP') {
      return res.status(202).json({
        success: true,
        message: 'Transaction requires step-up authentication',
        data: { action: 'step_up_auth', fraudScore: fraudResult.fraudScore }
      });
    }

    // Enqueue to event stream for async processing (best-effort)
    try {
      await EventStreamService.pushTransaction({
        _id: paymentId,
        userId: req.user._id,
        tenantId: req.user.tenantId || 'default',
        type: 'bank_transfer',
        amount: transactionForCheck.amount,
        metadata: { bankCode, accountNumber: 'REDACTED', accountName, fraudScore: fraudResult.fraudScore }
      });
    } catch (e) {
      logger.warn('[PaymentController] EventStream push failed (bank transfer)', e?.message || e);
    }

    // Proceed to process bank transfer via paymentService
    const result = await paymentService.processBankTransfer({
      paymentId,
      bankCode,
      accountNumber,
      accountName,
      routingNumber,
    });

    res.json({
      success: true,
      data: result,
      message: 'Bank transfer processed successfully',
    });
  } catch (error) {
    logger.error('Bank transfer error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Bank transfer failed',
    });
  }
});

/**
 * Verify payment status
 * GET /api/payments/:paymentId
 */
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;

  try {
    const payment = await paymentService.verifyPayment(paymentId);

    // Check if user owns this payment or is admin
    if (payment.user._id.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    res.json({
      success: true,
      data: payment,
    });
  } catch (error) {
    logger.error('Payment verification error:', error);
    res.status(404).json({
      success: false,
      error: error.message || 'Payment not found',
    });
  }
});

/**
 * Get user payment history
 * GET /api/payments/history
 */
exports.getPaymentHistory = asyncHandler(async (req, res) => {
  const { page = 1, limit = 20, status, type, method, startDate, endDate } = req.query;

  try {
    const query = { user: req.user._id };

    // Add filters
    if (status) query.status = status;
    if (type) query.type = type;
    if (method) query.method = method;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const options = {
      page: parseInt(page),
      limit: parseInt(limit),
      sort: { createdAt: -1 },
      populate: [
        { path: 'group', select: 'name' },
        { path: 'user', select: 'name email' },
      ],
    };

    const payments = await Payment.paginate(query, options);

    res.json({
      success: true,
      data: {
        payments: payments.docs,
        pagination: {
          page: payments.page,
          pages: payments.totalPages,
          total: payments.totalDocs,
          limit: payments.limit,
        },
      },
    });
  } catch (error) {
    logger.error('Payment history error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment history',
    });
  }
});

/**
 * Process refund
 * POST /api/payments/:paymentId/refund
 */
exports.processRefund = asyncHandler(async (req, res) => {
  const { paymentId } = req.params;
  const { amount, reason } = req.body;

  if (!amount || !reason) {
    return res.status(400).json({
      success: false,
      error: 'Amount and reason are required for refund',
    });
  }

  try {
    // Verify payment ownership (only payment owner or admin can refund)
    const payment = await Payment.findById(paymentId);
    if (!payment) {
      return res.status(404).json({
        success: false,
        error: 'Payment not found',
      });
    }

    if (payment.user.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const result = await paymentService.processRefund(paymentId, parseFloat(amount), reason);

    res.json({
      success: true,
      data: result,
      message: 'Refund processed successfully',
    });
  } catch (error) {
    logger.error('Refund processing error:', error);
    res.status(400).json({
      success: false,
      error: error.message || 'Refund processing failed',
    });
  }
});

/**
 * Get payment analytics
 * GET /api/payments/analytics
 */
exports.getPaymentAnalytics = asyncHandler(async (req, res) => {
  const {
    userId,
    groupId,
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 30 days ago
    endDate = new Date(),
  } = req.query;

  // Only admins can view analytics for other users/groups
  if ((userId && userId !== req.user._id.toString()) || (groupId && req.user.role !== 'admin')) {
    return res.status(403).json({
      success: false,
      error: 'Access denied',
    });
  }

  try {
    const analytics = await paymentService.getPaymentAnalytics(
      userId || req.user._id,
      groupId,
      new Date(startDate),
      new Date(endDate)
    );

    res.json({
      success: true,
      data: analytics,
    });
  } catch (error) {
    logger.error('Payment analytics error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment analytics',
    });
  }
});

/**
 * Get payment methods and fees
 * GET /api/payments/methods
 */
exports.getPaymentMethods = asyncHandler(async (req, res) => {
  const { amount, currency = 'KES' } = req.query;

  const methods = Object.values(paymentService.PAYMENT_METHODS).map((method) => {
    const fees = paymentService.calculateFees(method, parseFloat(amount) || 1000, currency);
    return {
      method,
      fees,
      description: getMethodDescription(method),
    };
  });

  res.json({
    success: true,
    data: {
      methods,
      providers: paymentService.MOBILE_MONEY_PROVIDERS,
    },
  });
});

/**
 * Get payment statistics for dashboard
 * GET /api/payments/stats
 */
exports.getPaymentStats = asyncHandler(async (req, res) => {
  try {
    const userId = req.user.role === 'admin' ? null : req.user._id;

    const matchConditions = {};
    if (userId) matchConditions.user = userId;

    // Get last 30 days stats
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    matchConditions.createdAt = { $gte: thirtyDaysAgo };

    const stats = await Payment.aggregate([
      { $match: matchConditions },
      {
        $group: {
          _id: null,
          totalPayments: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
          totalFees: { $sum: '$fees' },
          completedPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] },
          },
          pendingPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] },
          },
          failedPayments: {
            $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
          },
        },
      },
    ]);

    const result = stats[0] || {
      totalPayments: 0,
      totalAmount: 0,
      totalFees: 0,
      completedPayments: 0,
      pendingPayments: 0,
      failedPayments: 0,
    };

    res.json({
      success: true,
      data: {
        ...result,
        successRate:
          result.totalPayments > 0
            ? ((result.completedPayments / result.totalPayments) * 100).toFixed(2)
            : 0,
      },
    });
  } catch (error) {
    logger.error('Payment stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve payment statistics',
    });
  }
});

/**
 * Helper function to get payment method descriptions
 */
function getMethodDescription(method) {
  const descriptions = {
    mobile_money: 'Pay using M-Pesa, Airtel Money, or MTN Mobile Money',
    bank_transfer: 'Direct bank transfer to group account',
    card: 'Credit/Debit card payment',
    cash: 'Cash payment (in-person only)',
  };
  return descriptions[method] || 'Payment method';
}

/**
 * REQUIRED FIX #1:
 * Define missing createPaymentIntent
 */
async function createPaymentIntent(req, res) {
  try {
    const result = await req.app.locals.paymentService.createPaymentIntent(req.body, req.user._id);

    return res.status(201).json({
      success: true,
      data: result,
      message: 'Payment intent created successfully',
    });
  } catch (error) {
    logger.error('[PaymentController] Error creating payment intent', {
      error: error.message,
    });

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to create payment intent',
    });
  }
}

/**
 * GET /api/payments/intents/:id
 * Get payment intent status
 */
async function getPaymentIntent(req, res) {
  try {
    const { id } = req.params;
    const { refresh } = req.query;
    const userId = req.user._id;

    logger.info('[PaymentController] Fetching payment intent', {
      paymentIntentId: id,
      userId,
      refresh: refresh === 'true',
    });

    const paymentIntent = await req.app.locals.paymentService.getPaymentIntent(
      id,
      refresh === 'true'
    );

    // Verify user owns this intent
    if (paymentIntent.user?.toString() !== userId.toString()) {
      return res.status(403).json({
        error: 'Access denied. You do not own this payment intent.',
      });
    }

    return res.status(200).json({
      success: true,
      data: paymentIntent,
    });
  } catch (error) {
    logger.error('[PaymentController] Error getting payment intent', {
      error: error.message,
      paymentIntentId: req.params.id,
    });

    if (error.message.includes('not found')) {
      return res.status(404).json({ error: 'Payment intent not found' });
    }

    return res.status(500).json({
      error: 'Failed to retrieve payment intent',
      message: error.message,
    });
  }
}

/**
 * POST /api/payments/webhooks/:provider
 * Handle webhook events from payment provider
 */
async function handleWebhook(req, res) {
  try {
    const { provider } = req.params;
    const rawBody = req.rawBody; // Must be provided by middleware
    const headers = req.headers;

    logger.info('[PaymentController] Received webhook', {
      provider,
      eventType: req.body?.type,
    });

    // Verify webhook signature
    const adapter = req.app.locals.paymentService.providers[provider];
    if (!adapter) {
      logger.warn('[PaymentController] Unknown provider in webhook', { provider });
      return res.status(400).json({ error: 'Unknown provider' });
    }

    const isValid = adapter.verifyWebhook(rawBody, headers);
    if (!isValid) {
      logger.warn('[PaymentController] Webhook signature verification failed', {
        provider,
      });
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    // Process webhook event
    const result = await req.app.locals.paymentService.handleProviderEvent(provider, req.body);

    if (!result.success) {
      logger.warn('[PaymentController] Webhook processing failed', {
        provider,
        reason: result.reason,
      });

      return res.status(200).json({
        acknowledged: true,
        processed: false,
        reason: result.reason,
      });
    }

    logger.info('[PaymentController] Webhook processed successfully', {
      provider,
      paymentIntentId: result.paymentIntentId,
      status: result.status,
    });

    return res.status(200).json({
      acknowledged: true,
      processed: true,
      paymentIntentId: result.paymentIntentId,
      status: result.status,
    });
  } catch (error) {
    logger.error('[PaymentController] Error processing webhook', {
      error: error.message,
      provider: req.params.provider,
    });

    return res.status(200).json({
      acknowledged: true,
      processed: false,
      error: error.message,
    });
  }
}

/**
 * POST /api/payments/:id/cancel
 * Cancel a payment intent
 */
async function cancelPaymentIntent(req, res) {
  try {
    const { id } = req.params;
    const userId = req.user._id;

    logger.info('[PaymentController] Cancelling payment intent', {
      paymentIntentId: id,
      userId,
    });

    const paymentIntent = await req.app.locals.paymentService.cancelPaymentIntent(id);

    // Verify ownership
    if (paymentIntent.user.toString() !== userId.toString()) {
      return res.status(403).json({
        error: 'Access denied. You do not own this payment intent.',
      });
    }

    // Check if cancellable (can't cancel if already completed)
    if (['succeeded', 'failed'].includes(paymentIntent.status)) {
      return res.status(400).json({
        error: `Cannot cancel payment intent with status '${paymentIntent.status}'`,
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        paymentIntentId: id,
        status: paymentIntent.status,
        message: 'Payment intent cancelled',
      },
    });
  } catch (error) {
    logger.error('[PaymentController] Error cancelling payment intent', {
      error: error.message,
      paymentIntentId: req.params.id,
    });

    return res.status(500).json({
      error: 'Failed to cancel payment intent',
      message: error.message,
    });
  }
}

/**
 * GET /api/payments/transactions
 */
async function listTransactions(req, res) {
  try {
    const userId = req.user._id;
    const { limit = '20', skip = '0', status, startDate, endDate } = req.query;

    logger.info('[PaymentController] Listing transactions', {
      userId,
      limit: parseInt(limit),
      skip: parseInt(skip),
    });

    const result = await req.app.locals.paymentService.listTransactions(userId, {
      limit: Math.min(parseInt(limit), 100),
      skip: parseInt(skip),
      status: status || null,
      startDate: startDate ? new Date(startDate) : null,
      endDate: endDate ? new Date(endDate) : null,
    });

    return res.status(200).json({
      success: true,
      data: result.transactions,
      pagination: {
        total: result.total,
        limit: result.limit,
        skip: result.skip,
        pages: result.pages,
        currentPage: result.currentPage,
      },
    });
  } catch (error) {
    logger.error('[PaymentController] Error listing transactions', {
      error: error.message,
      userId: req.user._id,
    });

    return res.status(500).json({
      error: 'Failed to retrieve transactions',
      message: error.message,
    });
  }
}

/**
 * REQUIRED FIX #2:
 * Rename the conflicting analytics function
 */
async function getPaymentAnalyticsSummary(req, res) {
  try {
    const { startDate, endDate } = req.query;
    const userId = req.user._id;

    logger.info('[PaymentController] Fetching payment analytics', { userId });

    const query = {};
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const Transaction = require('../models/Transaction');

    const [totalTransactions, successfulPayments, totalAmount, averageAmount] = await Promise.all([
      Transaction.countDocuments(query),
      Transaction.countDocuments({ ...query, status: 'completed', type: 'credit' }),
      Transaction.aggregate([
        { $match: { ...query, type: 'credit' } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]),
      Transaction.aggregate([
        { $match: { ...query, type: 'credit' } },
        { $group: { _id: null, avg: { $avg: '$amount' } } },
      ]),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalTransactions,
        successfulPayments,
        totalAmount: totalAmount[0]?.total || 0,
        averageAmount: averageAmount[0]?.avg || 0,
        successRate:
          totalTransactions > 0
            ? ((successfulPayments / totalTransactions) * 100).toFixed(2) + '%'
            : '0%',
      },
    });
  } catch (error) {
    logger.error('[PaymentController] Error getting payment analytics', {
      error: error.message,
    });

    return res.status(500).json({
      error: 'Failed to retrieve payment analytics',
      message: error.message,
    });
  }
}

// Previously we exported a subset of functions here, which unintentionally
// overwrote the earlier `exports.*` assignments. That caused routes to receive
// undefined handlers (e.g. initiatePayment). Instead of replacing the
// exports object, add the remaining functions on the existing `exports`.

// export newly defined helpers so they are accessible to routes/services
exports.createPaymentIntent = createPaymentIntent;
exports.getPaymentIntent = getPaymentIntent;
exports.handleWebhook = handleWebhook;
exports.cancelPaymentIntent = cancelPaymentIntent;
exports.listTransactions = listTransactions;
exports.getPaymentAnalytics = getPaymentAnalyticsSummary;

// Note: all other handler functions above were already attached to `exports` via
// `exports.foo = ...` earlier in the file. We no longer reassign `module.exports`.
