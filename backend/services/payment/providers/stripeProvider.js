/**
 * Stripe Payment Provider Adapter
 * Handles payment intent creation, webhook signature verification, and event parsing
 * Production-ready implementation with error handling and logging
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const crypto = require('crypto');
const logger = require('../../../utils/logger');

class StripeProvider {
  constructor(config = {}) {
    this.providerName = 'stripe';
    this.apiKey = config.apiKey || process.env.STRIPE_SECRET_KEY;
    this.webhookSecret = config.webhookSecret || process.env.STRIPE_WEBHOOK_SECRET;
    this.stripeInstance = stripe;
  }

  /**
   * Create payment intent with Stripe
   * @param {Object} params - { amount, currency, metadata, idempotencyKey, description, customerEmail }
   * @returns {Object} - { id, clientSecret, status, amount }
   */
  async createIntent({
    amount,
    currency = 'usd',
    metadata = {},
    idempotencyKey,
    description = '',
    customerEmail = null,
    customerId = null,
  }) {
    try {
      logger.info('[Stripe] Creating payment intent', {
        amount,
        currency,
        idempotencyKey,
      });

      const intentParams = {
        amount: Math.round(amount * 100), // Stripe uses cents
        currency: currency.toLowerCase(),
        metadata: {
          ...metadata,
          createdAt: new Date().toISOString(),
          idempotencyKey,
        },
        description: description || 'Community Savings App Payment',
      };

      // Add customer if provided
      if (customerId) {
        intentParams.customer = customerId;
      } else if (customerEmail) {
        intentParams.receipt_email = customerEmail;
      }

      // Use idempotency key to prevent duplicate charges
      const idempotencyOptions = idempotencyKey ? { idempotencyKey } : {};

      const paymentIntent = await this.stripeInstance.paymentIntents.create(
        intentParams,
        idempotencyOptions
      );

      logger.info('[Stripe] Payment intent created', {
        intentId: paymentIntent.id,
        status: paymentIntent.status,
      });

      return {
        id: paymentIntent.id,
        clientSecret: paymentIntent.client_secret,
        status: paymentIntent.status,
        amount: paymentIntent.amount,
        currency: paymentIntent.currency,
        clientData: {
          provider: 'stripe',
          publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
          clientSecret: paymentIntent.client_secret,
        },
      };
    } catch (error) {
      logger.error('[Stripe] Error creating payment intent', {
        error: error.message,
        amount,
        currency,
      });
      throw new Error(`Stripe payment creation failed: ${error.message}`);
    }
  }

  /**
   * Verify webhook signature
   * @param {string} payload - Raw webhook body (must be a string)
   * @param {Object} headers - Webhook headers including 'stripe-signature'
   * @returns {boolean} - True if signature is valid
   */
  verifyWebhook(payload, headers) {
    try {
      const signature = headers['stripe-signature'] || headers['x-stripe-signature'];
      if (!signature) {
        logger.warn('[Stripe] No signature found in webhook headers');
        return false;
      }

      if (!this.webhookSecret) {
        logger.error('[Stripe] STRIPE_WEBHOOK_SECRET not configured');
        return false;
      }

      // Stripe expects raw body (string), not parsed JSON
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);

      const event = this.stripeInstance.webhooks.constructEvent(
        payloadString,
        signature,
        this.webhookSecret
      );

      logger.info('[Stripe] Webhook signature verified', {
        eventType: event.type,
        eventId: event.id,
      });

      return true;
    } catch (error) {
      logger.error('[Stripe] Webhook signature verification failed', {
        error: error.message,
      });
      return false;
    }
  }

  /**
   * Parse Stripe event and extract relevant data
   * @param {Object} event - Stripe webhook event
   * @returns {Object} - Normalized event { type, paymentIntentId, status, amount, metadata }
   */
  parseEvent(event) {
    try {
      const { type, data } = event;
      const paymentIntent = data.object;

      logger.info('[Stripe] Parsing webhook event', {
        eventType: type,
        intentId: paymentIntent?.id,
      });

      // Map Stripe events to internal events
      const eventMapping = {
        'payment_intent.succeeded': 'payment.succeeded',
        'payment_intent.payment_failed': 'payment.failed',
        'payment_intent.canceled': 'payment.canceled',
        'payment_intent.processing': 'payment.processing',
        'charge.refunded': 'payment.refunded',
      };

      const internalEventType = eventMapping[type] || type;

      // Extract status from Stripe status
      const statusMap = {
        succeeded: 'succeeded',
        requires_payment_method: 'pending',
        requires_confirmation: 'pending',
        requires_action: 'processing',
        processing: 'processing',
        requires_capture: 'processing',
        canceled: 'canceled',
      };

      return {
        type: internalEventType,
        provider: 'stripe',
        paymentIntentId: paymentIntent.id,
        status: statusMap[paymentIntent.status] || paymentIntent.status,
        amount: paymentIntent.amount / 100, // Convert from cents back to original
        currency: paymentIntent.currency,
        chargeId: paymentIntent.charges?.data?.[0]?.id,
        metadata: paymentIntent.metadata || {},
        timestamp: new Date(paymentIntent.created * 1000),
        raw: event,
      };
    } catch (error) {
      logger.error('[Stripe] Error parsing webhook event', {
        error: error.message,
        eventType: event.type,
      });
      throw error;
    }
  }

  /**
   * Retrieve payment intent status
   * @param {string} intentId - Stripe payment intent ID
   * @returns {Object} - Payment intent details
   */
  async getPaymentIntent(intentId) {
    try {
      const paymentIntent = await this.stripeInstance.paymentIntents.retrieve(intentId);
      return {
        id: paymentIntent.id,
        status: paymentIntent.status,
        amount: paymentIntent.amount / 100,
        currency: paymentIntent.currency,
        charges: paymentIntent.charges?.data || [],
        metadata: paymentIntent.metadata,
      };
    } catch (error) {
      logger.error('[Stripe] Error retrieving payment intent', {
        error: error.message,
        intentId,
      });
      throw error;
    }
  }

  /**
   * List payment intents for a user
   * @param {string} customerId - Stripe customer ID
   * @param {number} limit - Number of results (default 10)
   * @returns {Array} - List of payment intents
   */
  async listPaymentIntents(customerId, limit = 10) {
    try {
      const intents = await this.stripeInstance.paymentIntents.list({
        customer: customerId,
        limit,
      });

      return intents.data.map((pi) => ({
        id: pi.id,
        status: pi.status,
        amount: pi.amount / 100,
        currency: pi.currency,
        created: new Date(pi.created * 1000),
      }));
    } catch (error) {
      logger.error('[Stripe] Error listing payment intents', {
        error: error.message,
        customerId,
      });
      throw error;
    }
  }

  /**
   * Create refund for a charge
   * @param {string} chargeId - Stripe charge ID
   * @param {number} amount - Optional refund amount in dollars (full refund if not provided)
   * @returns {Object} - Refund details
   */
  async createRefund(chargeId, amount = null) {
    try {
      const refundParams = {
        charge: chargeId,
      };

      if (amount) {
        refundParams.amount = Math.round(amount * 100); // Convert to cents
      }

      const refund = await this.stripeInstance.refunds.create(refundParams);

      logger.info('[Stripe] Refund created', {
        refundId: refund.id,
        chargeId,
        amount: refund.amount / 100,
      });

      return {
        id: refund.id,
        chargeId: refund.charge,
        amount: refund.amount / 100,
        status: refund.status,
        created: new Date(refund.created * 1000),
      };
    } catch (error) {
      logger.error('[Stripe] Error creating refund', {
        error: error.message,
        chargeId,
      });
      throw error;
    }
  }
}

module.exports = StripeProvider;
