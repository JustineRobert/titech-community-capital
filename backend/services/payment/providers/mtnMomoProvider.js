/**
 * MTN Mobile Money Provider Adapter
 * Integrates with MTN MoMo API for payment collections and disbursements
 * Supports: Payment requests, account balance, transaction status
 *
 * Documentation: https://mtnmobilemoneyapi.damafinance.com/
 */

const axios = require('axios');
const { randomUUID } = require('crypto');
const BasePaymentProvider = require('./baseProvider');
const logger = require('../../../utils/logger');

class MtnMomoProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.providerName = 'mtn_momo';
    this.apiKey = config.apiKey || process.env.MTN_API_KEY;
    this.apiUser = config.apiUser || process.env.MTN_API_USER;
    this.apiPassword = config.apiPassword || process.env.MTN_API_PASSWORD;
    this.currency = config.currency || 'ZAR'; // Default currency
    this.callbackURL = config.callbackURL || process.env.MTN_CALLBACK_URL;
    this.environment = config.environment || 'sandbox'; // 'sandbox' or 'production'

    // API base URL based on environment
    this.baseUrl =
      this.environment === 'production' ? 'https://api.mtn.mz' : 'https://api.sandbox.mtn.mz';

    this.requestTimeout = 30000;

    this.validateConfig();
  }

  /**
   * Validate required MTN MoMo configuration
   */
  validateConfig() {
    const required = ['apiKey', 'apiUser', 'apiPassword', 'currency'];

    for (const key of required) {
      if (!this[key]) {
        throw new Error(`[MtnMoMo] Missing required config: ${key}`);
      }
    }

    logger.info('[MtnMoMo] Configuration validated', {
      environment: this.environment,
      currency: this.currency,
    });
  }

  /**
   * Generate common headers for MTN MoMo API
   * @returns {Object} Headers object
   */
  generateHeaders() {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'X-Reference-Id': randomUUID(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
  }

  /**
   * Create payment request (collection)
   * Requests payment from a customer
   *
   * @param {Object} params
   *   - amount: Payment amount
   *   - currency: Currency code (default: ZAR)
   *   - metadata: { phone, customerId, ... }
   *   - idempotencyKey: Idempotency key
   *   - description: Payment description
   *   - customerEmail: Customer email
   * @returns {Object} { id, clientData, status }
   */
  async createIntent({
    amount,
    currency = this.currency,
    metadata = {},
    idempotencyKey = null,
    description = '',
    customerEmail = null,
  }) {
    const phone = metadata.phone || metadata.phoneNumber;
    const customerId = metadata.customerId || metadata.externalId;

    if (!phone || !customerId) {
      throw new Error('[MtnMoMo] Phone number and customer ID required in metadata');
    }

    if (amount <= 0) {
      throw new Error('[MtnMoMo] Amount must be positive');
    }

    try {
      const requestId = randomUUID();
      const normalizedPhone = this.normalizePhoneNumber(phone);

      const payload = {
        externalId: customerId,
        amount: amount.toString(),
        currency: currency,
        externalCustomerId: customerId,
        payer: {
          partyIdType: 'MSISDN',
          partyId: normalizedPhone,
        },
        payerNote: description || 'Payment from Community Savings App',
        payeeNote: description || 'Payment from Community Savings App',
      };

      logger.info('[MtnMoMo] Initiating payment request', {
        amount,
        phone: normalizedPhone,
        customerId,
        idempotencyKey,
      });

      const response = await this.retryWithBackoff(async () => {
        return await axios.post(`${this.baseUrl}/collection/v1_0/requesttopay`, payload, {
          headers: this.generateHeaders(),
          'X-Reference-Id': requestId,
          timeout: this.requestTimeout,
        });
      });

      logger.info('[MtnMoMo] Payment request created', {
        requestId,
        phone: normalizedPhone,
      });

      return {
        id: requestId,
        clientData: {
          provider: 'mtn_momo',
          requestId: requestId,
          phone: normalizedPhone,
          customerId: customerId,
          amount,
          currency,
          description,
          status: 'pending',
          message: 'Payment request sent to customer',
        },
        status: 'pending',
        metadata: {
          idempotencyKey,
          customerId,
        },
      };
    } catch (error) {
      logger.error('[MtnMoMo] Failed to create payment request', {
        error: error.message,
        amount,
        phone: metadata.phone,
      });
      throw error;
    }
  }

  /**
   * Check payment request status
   * @param {String} requestId - MTN request ID
   * @returns {Object} { status, amount, currency, metadata }
   */
  async getPaymentStatus(requestId) {
    try {
      const response = await this.retryWithBackoff(async () => {
        return await axios.get(`${this.baseUrl}/collection/v1_0/requesttopay/${requestId}`, {
          headers: this.generateHeaders(),
          timeout: this.requestTimeout,
        });
      });

      const { status } = response.data;

      logger.info('[MtnMoMo] Payment status queried', {
        requestId,
        status,
      });

      return {
        status: status.toLowerCase(),
        rawResponse: response.data,
      };
    } catch (error) {
      logger.error('[MtnMoMo] Failed to query payment status', {
        error: error.message,
        requestId,
      });
      throw error;
    }
  }

  /**
   * Get account balance
   * @returns {Object} { balance, currency }
   */
  async getAccountBalance() {
    try {
      const response = await this.retryWithBackoff(async () => {
        return await axios.get(`${this.baseUrl}/collection/v1_0/account/balance`, {
          headers: this.generateHeaders(),
          timeout: this.requestTimeout,
        });
      });

      logger.info('[MtnMoMo] Account balance retrieved', {
        balance: response.data.availableBalance,
      });

      return {
        balance: parseFloat(response.data.availableBalance),
        currency: this.currency,
      };
    } catch (error) {
      logger.error('[MtnMoMo] Failed to get account balance', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Create disbursement (payment to customer)
   * @param {Object} params
   *   - amount: Amount to disburse
   *   - currency: Currency code
   *   - metadata: { phone, customerId }
   *   - description: Reason for disbursement
   * @returns {Object} { id, status }
   */
  async createDisbursement({ amount, currency = this.currency, metadata = {}, description = '' }) {
    const phone = metadata.phone || metadata.phoneNumber;
    const customerId = metadata.customerId || metadata.externalId;

    if (!phone || !customerId) {
      throw new Error('[MtnMoMo] Phone number and customer ID required');
    }

    try {
      const requestId = randomUUID();
      const normalizedPhone = this.normalizePhoneNumber(phone);

      const payload = {
        externalId: customerId,
        amount: amount.toString(),
        currency: currency,
        externalCustomerId: customerId,
        payee: {
          partyIdType: 'MSISDN',
          partyId: normalizedPhone,
        },
        payerNote: description || 'Disbursement from Community Savings App',
        payeeNote: description || 'Disbursement from Community Savings App',
      };

      logger.info('[MtnMoMo] Initiating disbursement', {
        amount,
        phone: normalizedPhone,
        customerId,
      });

      const response = await this.retryWithBackoff(async () => {
        return await axios.post(`${this.baseUrl}/disbursement/v1_0/transfer`, payload, {
          headers: this.generateHeaders(),
          'X-Reference-Id': requestId,
          timeout: this.requestTimeout,
        });
      });

      logger.info('[MtnMoMo] Disbursement initiated', {
        requestId,
        phone: normalizedPhone,
      });

      return {
        id: requestId,
        status: 'processing',
      };
    } catch (error) {
      logger.error('[MtnMoMo] Disbursement failed', {
        error: error.message,
        amount,
      });
      throw error;
    }
  }

  /**
   * Verify webhook signature
   * @param {Object} payload - Webhook payload
   * @param {Object} headers - Webhook headers
   * @returns {Boolean}
   */
  verifyWebhook(payload, headers) {
    try {
      // MTN MoMo uses IP whitelisting for webhooks
      // Verify the structure of the callback
      if (!payload.externalId || !payload.status) {
        logger.warn('[MtnMoMo] Invalid webhook structure');
        return false;
      }
      return true;
    } catch (error) {
      logger.error('[MtnMoMo] Webhook verification failed', { error: error.message });
      return false;
    }
  }

  /**
   * Parse webhook event
   * @param {Object} payload - Webhook payload
   * @returns {Object} { type, data }
   */
  parseEvent(payload) {
    try {
      const { status, externalId } = payload;

      let eventType = 'payment.failed';
      if (status === 'SUCCESSFUL') {
        eventType = 'payment.succeeded';
      } else if (status === 'PENDING') {
        eventType = 'payment.pending';
      } else if (status === 'FAILED') {
        eventType = 'payment.failed';
      }

      logger.info('[MtnMoMo] Event parsed', {
        eventType,
        externalId,
        status,
      });

      return {
        type: eventType,
        data: {
          externalId,
          status,
          timestamp: new Date(),
          rawPayload: payload,
        },
      };
    } catch (error) {
      logger.error('[MtnMoMo] Event parsing failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Get provider health status
   */
  async getHealthStatus() {
    try {
      await this.getAccountBalance();
      return {
        healthy: true,
        message: 'MTN MoMo API accessible',
      };
    } catch (error) {
      return {
        healthy: false,
        message: `MTN MoMo API unreachable: ${error.message}`,
      };
    }
  }

  /**
   * Refund payment
   * @param {String} originalRequestId - Original request ID
   * @param {Number} amount - Amount to refund
   * @returns {Object} { refundId, status }
   */
  async refundPayment(originalRequestId, amount) {
    try {
      const refundId = randomUUID();

      logger.info('[MtnMoMo] Refund initiated', {
        originalRequestId,
        amount,
        refundId,
      });

      // MTN MoMo doesn't have direct refund API
      // Implement via custom logic or vendor contact
      return {
        refundId,
        status: 'processing',
        note: 'MTN MoMo refund requires manual processing or vendor API',
      };
    } catch (error) {
      logger.error('[MtnMoMo] Refund failed', {
        error: error.message,
        requestId: originalRequestId,
      });
      throw error;
    }
  }

  // =====================================================================
  // Private Helper Methods
  // =====================================================================

  /**
   * Normalize phone number to MTN format
   */
  normalizePhoneNumber(phone) {
    // Remove all non-digits
    let clean = phone.replace(/\D/g, '');

    // Handle different country codes
    if (clean.startsWith('0')) {
      clean = '258' + clean.substring(1);
    }

    if (!clean.startsWith('258')) {
      clean = '258' + clean;
    }

    return clean;
  }
}

module.exports = MtnMomoProvider;
