/**
 * Airtel Money Provider Adapter
 * Integrates with Airtel Money API for payment collections and disbursements
 * Supports: Money transfer, account inquiry, transaction status
 *
 * Documentation: https://developer.airtel.africa/
 */

const axios = require('axios');
const crypto = require('crypto');
const { randomUUID } = require('crypto');
const BasePaymentProvider = require('./baseProvider');
const logger = require('../../../utils/logger');

class AirtelProvider extends BasePaymentProvider {
  constructor(config = {}) {
    super(config);
    this.providerName = 'airtel';
    this.clientId = config.clientId || process.env.AIRTEL_CLIENT_ID;
    this.clientSecret = config.clientSecret || process.env.AIRTEL_CLIENT_SECRET;
    this.apiKey = config.apiKey || process.env.AIRTEL_API_KEY;
    this.currency = config.currency || 'ZAR'; // Default currency
    this.callbackURL = config.callbackURL || process.env.AIRTEL_CALLBACK_URL;
    this.environment = config.environment || 'sandbox'; // 'sandbox' or 'production'
    this.countryCode = config.countryCode || 'ZA'; // Country code

    // API base URL based on environment
    this.baseUrl =
      this.environment === 'production'
        ? 'https://open.airtelapi.com'
        : 'https://sandbox-open.airtelapi.com';

    this.accessToken = null;
    this.accessTokenExpiry = null;
    this.requestTimeout = 30000;

    this.validateConfig();
  }

  /**
   * Validate required Airtel configuration
   */
  validateConfig() {
    const required = ['clientId', 'clientSecret', 'apiKey'];

    for (const key of required) {
      if (!this[key]) {
        throw new Error(`[Airtel] Missing required config: ${key}`);
      }
    }

    logger.info('[Airtel] Configuration validated', {
      environment: this.environment,
      countryCode: this.countryCode,
      currency: this.currency,
    });
  }

  /**
   * Get or refresh OAuth access token
   * @returns {String} Access token
   */
  async getAccessToken() {
    if (this.accessToken && this.accessTokenExpiry > Date.now()) {
      return this.accessToken;
    }

    try {
      const auth = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

      const response = await axios.post(
        `${this.baseUrl}/auth/oauth2/token`,
        { grant_type: 'client_credentials' },
        {
          headers: {
            Authorization: `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          timeout: this.requestTimeout,
        }
      );

      this.accessToken = response.data.access_token;
      this.accessTokenExpiry = Date.now() + (response.data.expires_in - 60) * 1000;

      logger.debug('[Airtel] Access token acquired');
      return this.accessToken;
    } catch (error) {
      logger.error('[Airtel] Failed to get access token', {
        error: error.message,
        response: error.response?.data,
      });
      throw new Error('Failed to authenticate with Airtel API');
    }
  }

  /**
   * Create payment intent
   * Initiates a money transfer request
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
      throw new Error('[Airtel] Phone number and customer ID required in metadata');
    }

    if (amount <= 0) {
      throw new Error('[Airtel] Amount must be positive');
    }

    try {
      const accessToken = await this.getAccessToken();
      const transactionId = randomUUID();
      const normalizedPhone = this.normalizePhoneNumber(phone);

      const payload = {
        reference: customerId,
        subscriber: {
          country: this.countryCode,
          currency: currency,
          msisdn: normalizedPhone,
        },
        transaction: {
          id: transactionId,
          amount: amount.toString(),
          currency: currency,
          description: description || 'Community Savings Payment',
        },
      };

      logger.info('[Airtel] Initiating payment request', {
        amount,
        phone: normalizedPhone,
        customerId,
        idempotencyKey,
      });

      const response = await this.retryWithBackoff(async () => {
        return await axios.post(`${this.baseUrl}/merchant/v2/payments/`, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
            'X-Request-ID': transactionId,
          },
          timeout: this.requestTimeout,
        });
      });

      const { id, status } = response.data;

      logger.info('[Airtel] Payment request created', {
        transactionId: id,
        phone: normalizedPhone,
        status,
      });

      return {
        id: id || transactionId,
        clientData: {
          provider: 'airtel',
          transactionId: id || transactionId,
          phone: normalizedPhone,
          customerId: customerId,
          amount,
          currency,
          description,
          status: status?.toLowerCase() || 'pending',
          message: 'Payment request initiated',
        },
        status: status?.toLowerCase() || 'pending',
        metadata: {
          idempotencyKey,
          customerId,
          transactionId,
        },
      };
    } catch (error) {
      logger.error('[Airtel] Failed to create payment request', {
        error: error.message,
        amount,
        phone: metadata.phone,
      });
      throw error;
    }
  }

  /**
   * Get payment status
   * @param {String} transactionId - Airtel transaction ID
   * @returns {Object} { status, amount, currency, metadata }
   */
  async getPaymentStatus(transactionId) {
    try {
      const accessToken = await this.getAccessToken();

      const response = await this.retryWithBackoff(async () => {
        return await axios.get(`${this.baseUrl}/merchant/v2/payments/${transactionId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Key': this.apiKey,
          },
          timeout: this.requestTimeout,
        });
      });

      const { status } = response.data;

      logger.info('[Airtel] Payment status queried', {
        transactionId,
        status,
      });

      return {
        status: status?.toLowerCase() || 'unknown',
        rawResponse: response.data,
      };
    } catch (error) {
      logger.error('[Airtel] Failed to query payment status', {
        error: error.message,
        transactionId,
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
      const accessToken = await this.getAccessToken();

      const response = await this.retryWithBackoff(async () => {
        return await axios.get(`${this.baseUrl}/merchant/v1/query/balance`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Key': this.apiKey,
          },
          timeout: this.requestTimeout,
        });
      });

      const balance = response.data.balance || 0;

      logger.info('[Airtel] Account balance retrieved', {
        balance,
        currency: this.currency,
      });

      return {
        balance: parseFloat(balance),
        currency: this.currency,
      };
    } catch (error) {
      logger.error('[Airtel] Failed to get account balance', {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Verify webhook signature
   * Airtel includes a signature header that must be verified
   *
   * @param {Object} payload - Webhook payload
   * @param {Object} headers - Webhook headers
   * @returns {Boolean}
   */
  verifyWebhook(payload, headers) {
    try {
      // Airtel signs webhooks with HMAC-SHA256
      const signature = headers['x-signature'];
      if (!signature) {
        logger.warn('[Airtel] Missing webhook signature');
        return false;
      }

      // Create HMAC-SHA256 signature of the payload
      const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
      const expectedSignature = crypto
        .createHmac('sha256', this.apiKey)
        .update(payloadString)
        .digest('hex');

      return signature === expectedSignature;
    } catch (error) {
      logger.error('[Airtel] Webhook verification failed', { error: error.message });
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
      const { transaction, status } = payload;

      let eventType = 'payment.failed';
      if (status === 'Successful' || status === 'SUCCESS') {
        eventType = 'payment.succeeded';
      } else if (status === 'Pending' || status === 'PENDING') {
        eventType = 'payment.pending';
      } else if (status === 'Failed' || status === 'FAILED') {
        eventType = 'payment.failed';
      }

      logger.info('[Airtel] Event parsed', {
        eventType,
        transactionId: transaction?.id,
        status,
      });

      return {
        type: eventType,
        data: {
          transactionId: transaction?.id,
          amount: transaction?.amount,
          currency: transaction?.currency,
          status,
          timestamp: new Date(),
          rawPayload: payload,
        },
      };
    } catch (error) {
      logger.error('[Airtel] Event parsing failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Refund a payment
   * @param {String} originalTransactionId - Original transaction ID
   * @param {Number} amount - Amount to refund
   * @returns {Object} { refundId, status }
   */
  async refundPayment(originalTransactionId, amount) {
    try {
      const accessToken = await this.getAccessToken();
      const refundId = randomUUID();

      const payload = {
        originalTransaction: originalTransactionId,
        amount: amount.toString(),
        currency: this.currency,
        reference: `REFUND-${originalTransactionId}`,
      };

      logger.info('[Airtel] Initiating refund', {
        originalTransactionId,
        amount,
        refundId,
      });

      const response = await this.retryWithBackoff(async () => {
        return await axios.post(`${this.baseUrl}/merchant/v2/refunds/`, payload, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'X-API-Key': this.apiKey,
            'Content-Type': 'application/json',
            'X-Request-ID': refundId,
          },
          timeout: this.requestTimeout,
        });
      });

      logger.info('[Airtel] Refund initiated', {
        refundId,
        originalTransactionId,
      });

      return {
        refundId: response.data.id || refundId,
        status: response.data.status?.toLowerCase() || 'processing',
      };
    } catch (error) {
      logger.error('[Airtel] Refund failed', {
        error: error.message,
        transactionId: originalTransactionId,
      });
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
        message: 'Airtel API accessible',
      };
    } catch (error) {
      return {
        healthy: false,
        message: `Airtel API unreachable: ${error.message}`,
      };
    }
  }

  // =====================================================================
  // Private Helper Methods
  // =====================================================================

  /**
   * Normalize phone number to Airtel format
   */
  normalizePhoneNumber(phone) {
    // Remove all non-digits
    let clean = phone.replace(/\D/g, '');

    // Handle different country codes based on country
    const countryMap = {
      ZA: '27',
      KE: '254',
      TZ: '255',
      UG: '256',
      RW: '250',
    };

    const countryPrefix = countryMap[this.countryCode] || '27';

    // If starts with 0, replace with country code
    if (clean.startsWith('0')) {
      clean = countryPrefix + clean.substring(1);
    }

    // If doesn't start with country code, add it
    if (!clean.startsWith(countryPrefix)) {
      clean = countryPrefix + clean;
    }

    return clean;
  }
}

module.exports = AirtelProvider;
