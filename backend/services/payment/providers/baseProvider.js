/**
 * Base Payment Provider Interface
 * Abstract base class for all payment provider implementations
 * Ensures consistent interface and contract across all providers
 */

const logger = require('../../../utils/logger');

class BasePaymentProvider {
  constructor(config = {}) {
    this.providerName = 'base';
    this.config = config;
    this.retryConfig = {
      maxRetries: 3,
      initialDelay: 1000,
      maxDelay: 10000,
      backoffMultiplier: 2,
    };
  }

  /**
   * Create a payment intent
   * @param {Object} params - { amount, currency, metadata, idempotencyKey, description, customerEmail }
   * @returns {Object} - { id, clientData, status }
   */
  async createIntent(params) {
    throw new Error('createIntent must be implemented by subclass');
  }

  /**
   * Verify webhook signature from provider
   * @param {Object} payload - Webhook payload
   * @param {Object} headers - Webhook headers
   * @returns {Boolean}
   */
  verifyWebhook(payload, headers) {
    throw new Error('verifyWebhook must be implemented by subclass');
  }

  /**
   * Parse webhook event from provider
   * @param {Object} payload - Webhook payload
   * @returns {Object} - { type, data }
   */
  parseEvent(payload) {
    throw new Error('parseEvent must be implemented by subclass');
  }

  /**
   * Retrieve payment status
   * @param {String} paymentId - Provider-specific payment identifier
   * @returns {Object} - { status, amount, currency, metadata }
   */
  async getPaymentStatus(paymentId) {
    throw new Error('getPaymentStatus must be implemented by subclass');
  }

  /**
   * Refund a payment
   * @param {String} paymentId - Provider-specific payment identifier
   * @param {Number} amount - Amount to refund (optional, null = full refund)
   * @returns {Object} - { refundId, status }
   */
  async refundPayment(paymentId, amount = null) {
    throw new Error('refundPayment must be implemented by subclass');
  }

  /**
   * Retry logic with exponential backoff
   * @param {Function} fn - Async function to retry
   * @param {Object} options - Retry configuration
   * @returns {*}
   */
  async retryWithBackoff(fn, options = {}) {
    const config = { ...this.retryConfig, ...options };
    let lastError;

    for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
      try {
        logger.debug(`[${this.providerName}] Attempt ${attempt + 1}/${config.maxRetries + 1}`);
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt < config.maxRetries) {
          const delay = Math.min(
            config.initialDelay * Math.pow(config.backoffMultiplier, attempt),
            config.maxDelay
          );
          logger.warn(`[${this.providerName}] Retry attempt ${attempt + 1} after ${delay}ms`, {
            error: error.message,
          });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    throw lastError;
  }

  /**
   * Validate provider-specific configuration
   * @returns {Boolean}
   */
  validateConfig() {
    throw new Error('validateConfig must be implemented by subclass');
  }

  /**
   * Get provider health status
   * @returns {Object} - { healthy: Boolean, message: String }
   */
  async getHealthStatus() {
    throw new Error('getHealthStatus must be implemented by subclass');
  }
}

module.exports = BasePaymentProvider;
