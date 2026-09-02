const PaymentIntent = require('../../models/PaymentIntent');
const Transaction = require('../../models/Transaction');
const logger = require('../../utils/logger');

/**
 * PaymentService - Orchestrates payment operations across multiple providers
 * Handles payment intent creation, webhook processing, retries, and transaction logging
 * Production-ready with comprehensive error handling and audit trail
 */
class PaymentService {
  constructor({ providers = {}, queue = null, logger: customLogger = null } = {}) {
    this.providers = providers; // Map of provider adapters: { stripe: StripeProvider, mobileMoney: ... }
    this.queue = queue; // Bull queue for background job processing
    this.logger = customLogger || logger;
  }

  /**
   * Create a payment intent with the specified provider
   * Idempotency ensures duplicate requests return same result
   * @param {Object} params - { userId, amount, currency, provider, metadata, idempotencyKey, description, customerEmail }
   * @returns {PaymentIntent} - Document with status, clientData for frontend
   */
  async createPaymentIntent({
    userId,
    amount,
    currency = 'usd',
    provider = 'stripe',
    metadata = {},
    idempotencyKey = null,
    description = '',
    customerEmail = null,
  }) {
    // Validate required parameters
    if (!userId || !amount || amount <= 0) {
      throw new Error('Invalid payment parameters: userId and amount > 0 required');
    }
    if (!this.providers[provider]) {
      throw new Error(`Payment provider '${provider}' not configured`);
    }

    // Idempotency: check if intent with same key already exists
    if (idempotencyKey) {
      const existing = await PaymentIntent.findOne({ idempotencyKey, user: userId });
      if (existing) {
        this.logger.info('[PaymentService] Returning existing payment intent (idempotency)', {
          existingId: existing._id,
          idempotencyKey,
        });
        return existing;
      }
    }

    try {
      // Create PaymentIntent document in DB
      const pi = await PaymentIntent.create({
        user: userId,
        amount,
        currency,
        provider,
        metadata: {
          ...metadata,
          description,
          customerEmail,
          initiatedAt: new Date().toISOString(),
        },
        idempotencyKey: idempotencyKey || this.generateIdempotencyKey(),
        status: 'pending',
        attempts: 0,
      });

      this.logger.info('[PaymentService] Created PaymentIntent document', {
        intentId: pi._id,
        amount,
        provider,
      });

      // Call provider adapter to create intent
      const adapter = this.providers[provider];
      const providerResult = await adapter.createIntent({
        amount,
        currency,
        metadata: {
          paymentIntentId: pi._id.toString(),
          userId,
          ...metadata,
        },
        idempotencyKey: pi.idempotencyKey,
        description,
        customerEmail,
      });

      // Update DB with provider details
      pi.intentId = providerResult.id;
      pi.clientData = providerResult.clientData;
      pi.status = providerResult.status || 'pending';
      await pi.save();

      this.logger.info('[PaymentService] Payment intent ready for client', {
        paymentIntentId: pi._id,
        providerIntentId: providerResult.id,
        status: pi.status,
      });

      return pi;
    } catch (error) {
      this.logger.error('[PaymentService] Error creating payment intent', {
        error: error.message,
        userId,
        amount,
        provider,
      });
      throw error;
    }
  }

  /**
   * Handle webhook event from payment provider
   * Updates PaymentIntent status and creates Transaction record
   * @param {string} providerName - Provider identifier (stripe, mobileMoney, etc)
   * @param {Object} event - Raw webhook event from provider
   * @returns {Object} - { success, paymentIntentId, transactionId, status }
   */
  async handleProviderEvent(providerName, event) {
    try {
      const adapter = this.providers[providerName];
      if (!adapter) {
        throw new Error(`Provider '${providerName}' not configured`);
      }

      // Parse and normalize event
      const parsedEvent = adapter.parseEvent(event);
      this.logger.info('[PaymentService] Handling provider event', {
        provider: providerName,
        eventType: parsedEvent.type,
        paymentIntentId: parsedEvent.paymentIntentId,
      });

      // Find corresponding PaymentIntent
      const paymentIntent = await PaymentIntent.findOne({
        intentId: parsedEvent.paymentIntentId,
      });
      if (!paymentIntent) {
        this.logger.warn('[PaymentService] PaymentIntent not found for provider event', {
          providerIntentId: parsedEvent.paymentIntentId,
          provider: providerName,
        });
        return { success: false, reason: 'PaymentIntent not found' };
      }

      // Update PaymentIntent status
      const oldStatus = paymentIntent.status;
      paymentIntent.status = parsedEvent.status;
      paymentIntent.attempts = (paymentIntent.attempts || 0) + 1;
      paymentIntent.metadata = {
        ...paymentIntent.metadata,
        lastEventType: parsedEvent.type,
        lastEventTimestamp: parsedEvent.timestamp,
      };
      await paymentIntent.save();

      this.logger.info('[PaymentService] Updated PaymentIntent status', {
        paymentIntentId: paymentIntent._id,
        oldStatus,
        newStatus: parsedEvent.status,
      });

      // Handle successful payment: create transaction record
      if (parsedEvent.type === 'payment.succeeded') {
        const transaction = await Transaction.create({
          user: paymentIntent.user,
          amount: parsedEvent.amount,
          currency: parsedEvent.currency || paymentIntent.currency,
          type: 'credit',
          status: 'completed',
          source: {
            type: providerName,
            intentId: parsedEvent.paymentIntentId,
            chargeId: parsedEvent.chargeId,
          },
          metadata: {
            ...parsedEvent.metadata,
            paymentIntentId: paymentIntent._id.toString(),
          },
          processedAt: parsedEvent.timestamp,
        });

        this.logger.info('[PaymentService] Transaction created for successful payment', {
          transactionId: transaction._id,
          amount: transaction.amount,
          userId: paymentIntent.user,
        });

        // Emit event for downstream handlers (notifications, analytics, etc)
        if (this.queue) {
          await this.queue.add('payment-success', {
            paymentIntentId: paymentIntent._id,
            transactionId: transaction._id,
            userId: paymentIntent.user,
            amount: transaction.amount,
          });
        }

        return {
          success: true,
          paymentIntentId: paymentIntent._id,
          transactionId: transaction._id,
          status: 'succeeded',
        };
      }

      // Handle failed payments
      if (parsedEvent.type === 'payment.failed') {
        this.logger.warn('[PaymentService] Payment failed', {
          paymentIntentId: paymentIntent._id,
          userId: paymentIntent.user,
        });

        // Queue for retry if under attempt limit
        if ((paymentIntent.attempts || 0) < 3 && this.queue) {
          await this.queue.add(
            'payment-retry',
            {
              paymentIntentId: paymentIntent._id,
              attempt: (paymentIntent.attempts || 0) + 1,
            },
            {
              delay: Math.pow(2, paymentIntent.attempts || 0) * 60000, // Exponential backoff
              attempts: 3,
            }
          );
        }

        return {
          success: false,
          paymentIntentId: paymentIntent._id,
          status: 'failed',
          attemptNumber: paymentIntent.attempts,
        };
      }

      return {
        success: true,
        paymentIntentId: paymentIntent._id,
        status: parsedEvent.status,
      };
    } catch (error) {
      this.logger.error('[PaymentService] Error handling provider event', {
        error: error.message,
        provider: providerName,
      });
      throw error;
    }
  }

  /**
   * Retrieve payment intent status from DB and optionally from provider
   * @param {string} paymentIntentId - Internal PaymentIntent document ID
   * @param {boolean} refreshFromProvider - Fetch latest status from provider
   * @returns {Object} - Payment intent details
   */
  async getPaymentIntent(paymentIntentId, refreshFromProvider = false) {
    try {
      const paymentIntent = await PaymentIntent.findById(paymentIntentId);
      if (!paymentIntent) {
        throw new Error('Payment intent not found');
      }

      let result = {
        id: paymentIntent._id,
        provider: paymentIntent.provider,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        status: paymentIntent.status,
        attempts: paymentIntent.attempts,
        createdAt: paymentIntent.createdAt,
        clientData: paymentIntent.clientData,
      };

      // Optionally refresh status from provider
      if (refreshFromProvider && paymentIntent.intentId) {
        const adapter = this.providers[paymentIntent.provider];
        if (adapter && adapter.getPaymentIntent) {
          const providerData = await adapter.getPaymentIntent(paymentIntent.intentId);
          result.providerStatus = providerData.status;

          // Update local status if changed
          if (providerData.status !== paymentIntent.status) {
            paymentIntent.status = providerData.status;
            await paymentIntent.save();
            result.status = providerData.status;

            this.logger.info('[PaymentService] Synced status from provider', {
              paymentIntentId,
              newStatus: providerData.status,
            });
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error('[PaymentService] Error getting payment intent', {
        error: error.message,
        paymentIntentId,
      });
      throw error;
    }
  }

  /**
   * Cancel a payment intent
   * @param {string} paymentIntentId - PaymentIntent document ID
   * @returns {Object} - Cancelled payment intent
   */
  async cancelPaymentIntent(paymentIntentId) {
    try {
      const paymentIntent = await PaymentIntent.findById(paymentIntentId);
      if (!paymentIntent) {
        throw new Error('Payment intent not found');
      }

      if (paymentIntent.status === 'canceled') {
        return paymentIntent;
      }

      paymentIntent.status = 'canceled';
      paymentIntent.metadata = {
        ...paymentIntent.metadata,
        cancelledAt: new Date().toISOString(),
      };
      await paymentIntent.save();

      this.logger.info('[PaymentService] Payment intent cancelled', {
        paymentIntentId,
      });

      return paymentIntent;
    } catch (error) {
      this.logger.error('[PaymentService] Error cancelling payment intent', {
        error: error.message,
        paymentIntentId,
      });
      throw error;
    }
  }

  /**
   * List transactions for a user
   * @param {string} userId - User ID
   * @param {Object} options - { limit, skip, status, startDate, endDate }
   * @returns {Object} - { transactions, total, limit, skip }
   */
  async listTransactions(userId, options = {}) {
    try {
      const { limit = 20, skip = 0, status = null, startDate = null, endDate = null } = options;

      const query = { user: userId };
      if (status) query.status = status;
      if (startDate || endDate) {
        query.createdAt = {};
        if (startDate) query.createdAt.$gte = startDate;
        if (endDate) query.createdAt.$lte = endDate;
      }

      const [transactions, total] = await Promise.all([
        Transaction.find(query).sort({ createdAt: -1 }).limit(limit).skip(skip),
        Transaction.countDocuments(query),
      ]);

      return {
        transactions,
        total,
        limit,
        skip,
        pages: Math.ceil(total / limit),
        currentPage: Math.floor(skip / limit) + 1,
      };
    } catch (error) {
      this.logger.error('[PaymentService] Error listing transactions', {
        error: error.message,
        userId,
      });
      throw error;
    }
  }

  /**
   * Generate unique idempotency key
   * @returns {string} - UUID-based idempotency key
   */
  generateIdempotencyKey() {
    const { randomUUID } = require('crypto');
    return randomUUID();
  }
}

module.exports = PaymentService;
