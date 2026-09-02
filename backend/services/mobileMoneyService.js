// services/mobileMoneyService.js
// ============================================================================
// Mobile Money Integration Service
// Handles MTN MoMo and Airtel Money payments with retry logic, security,
// and comprehensive error handling
// ============================================================================

const axios = require('axios');
const crypto = require('crypto');
const logger = require('../utils/logger');

class MobileMoneyService {
  constructor() {
    // MTN MoMo Configuration
    this.mtnConfig = {
      baseUrl: process.env.MTN_MOMO_BASE_URL || 'https://api.sandbox.mtn.com.gh/mocserver/3.0.0',
      apiKey: process.env.MTN_MOMO_API_KEY,
      primaryKey: process.env.MTN_MOMO_PRIMARY_KEY,
      userId: process.env.MTN_MOMO_USER_ID,
      apiUser: process.env.MTN_MOMO_API_USER,
    };

    // Airtel Money Configuration
    this.airtelConfig = {
      baseUrl: process.env.AIRTEL_MONEY_BASE_URL || 'https://openapiuat.airtel.africa/merchant/v1',
      clientId: process.env.AIRTEL_MONEY_CLIENT_ID,
      clientSecret: process.env.AIRTEL_MONEY_CLIENT_SECRET,
      businessCode: process.env.AIRTEL_MONEY_BUSINESS_CODE,
    };

    // Timeout and retry settings
    this.timeout = parseInt(process.env.PAYMENT_TIMEOUT || '30000', 10);
    this.maxRetries = parseInt(process.env.PAYMENT_MAX_RETRIES || '3', 10);
  }

  /**
   * Initiate MTN MoMo payment
   */
  async initiateMTNPayment(phoneNumber, amount, currency, referenceId, metadata = {}) {
    const transactionId = this.generateTransactionId();
    const idempotencyKey = referenceId || transactionId;

    try {
      logger.info('Initiating MTN MoMo payment', {
        transactionId,
        phoneNumber: this.maskPhoneNumber(phoneNumber),
        amount,
        currency,
      });

      // Validate input
      this.validatePaymentInput(phoneNumber, amount, currency);

      // Create request payload
      const payload = {
        payer: {
          partyIdType: 'MSISDN',
          partyId: this.formatPhoneNumber(phoneNumber),
        },
        payerMessage: metadata.description || 'Community Savings Payment',
        payeeNote: metadata.payeeNote || 'Payment received',
        amount: amount.toString(),
        currency: currency || 'XAF',
        externalId: transactionId,
        description: metadata.description || 'Payment for savings contribution',
      };

      const response = await this.makeRequest(
        'POST',
        `${this.mtnConfig.baseUrl}/collection/v1_0/requesttopay`,
        payload,
        {
          'X-Target-Environment': process.env.MTN_TARGET_ENV || 'sandbox',
          'X-Reference-Id': idempotencyKey,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.mtnConfig.apiKey}`,
        }
      );

      logger.info('MTN MoMo payment initiated successfully', {
        transactionId,
        referenceId: response.headers['x-reference-id'],
      });

      return {
        transactionId,
        provider: 'MTN_MOMO',
        phoneNumber,
        amount,
        currency,
        status: 'PENDING',
        providerReference: response.headers['x-reference-id'],
        metadata: {
          ...metadata,
          initiatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('MTN MoMo payment initiation failed', {
        transactionId,
        error: error.message,
        phoneNumber: this.maskPhoneNumber(phoneNumber),
      });

      throw this.handlePaymentError(error, 'MTN_MOMO');
    }
  }

  /**
   * Check MTN MoMo transaction status
   */
  async checkMTNTransactionStatus(referenceId) {
    try {
      const response = await this.makeRequest(
        'GET',
        `${this.mtnConfig.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
        null,
        {
          'X-Target-Environment': process.env.MTN_TARGET_ENV || 'sandbox',
          Authorization: `Bearer ${this.mtnConfig.apiKey}`,
        }
      );

      const data = response.data;

      return {
        status: this.mapMTNStatus(data.status),
        providerStatus: data.status,
        amount: parseFloat(data.amount),
        currency: data.currency,
        transactionDate: data.transactionDate,
        reason: data.reason,
        financialTransactionId: data.financialTransactionId,
      };
    } catch (error) {
      logger.error('Failed to check MTN transaction status', {
        referenceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Initiate Airtel Money payment
   */
  async initiateAirtelPayment(phoneNumber, amount, currency, referenceId, metadata = {}) {
    const transactionId = this.generateTransactionId();

    try {
      logger.info('Initiating Airtel Money payment', {
        transactionId,
        phoneNumber: this.maskPhoneNumber(phoneNumber),
        amount,
        currency,
      });

      // Validate input
      this.validatePaymentInput(phoneNumber, amount, currency);

      // Get access token first
      const token = await this.getAirtelAccessToken();

      const payload = {
        reference: referenceId || transactionId,
        subscriber: {
          country: 'ZA', // Default to South Africa, customize as needed
          currency: currency || 'ZAR',
          msisdn: this.formatPhoneNumber(phoneNumber),
        },
        transaction: {
          amount: amount.toString(),
          country: 'ZA',
          currency: currency || 'ZAR',
          id: transactionId,
          type: 'MobileMoneyCollection',
        },
      };

      const response = await this.makeRequest(
        'POST',
        `${this.airtelConfig.baseUrl}/payments`,
        payload,
        {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Client-Id': this.airtelConfig.clientId,
        }
      );

      const transactionData = response.data?.data || response.data;

      logger.info('Airtel Money payment initiated successfully', {
        transactionId,
        airtelRefId: transactionData.id,
      });

      return {
        transactionId,
        provider: 'AIRTEL_MONEY',
        phoneNumber,
        amount,
        currency,
        status: 'PENDING',
        providerReference: transactionData.id,
        metadata: {
          ...metadata,
          initiatedAt: new Date().toISOString(),
        },
      };
    } catch (error) {
      logger.error('Airtel Money payment initiation failed', {
        transactionId,
        error: error.message,
        phoneNumber: this.maskPhoneNumber(phoneNumber),
      });

      throw this.handlePaymentError(error, 'AIRTEL_MONEY');
    }
  }

  /**
   * Check Airtel Money transaction status
   */
  async checkAirtelTransactionStatus(transactionId) {
    try {
      const token = await this.getAirtelAccessToken();

      const response = await this.makeRequest(
        'GET',
        `${this.airtelConfig.baseUrl}/payments/${transactionId}`,
        null,
        {
          Authorization: `Bearer ${token}`,
          'X-Client-Id': this.airtelConfig.clientId,
        }
      );

      const data = response.data?.data || response.data;

      return {
        status: this.mapAirtelStatus(data.status),
        providerStatus: data.status,
        amount: parseFloat(data.amount),
        currency: data.currency,
        transactionDate: data.transactionTime,
        failureReason: data.failureReason,
      };
    } catch (error) {
      logger.error('Failed to check Airtel transaction status', {
        transactionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get Airtel access token (with caching)
   */
  async getAirtelAccessToken() {
    // Check if we have a cached token
    if (this.airtelToken && this.airtelTokenExpires > Date.now()) {
      return this.airtelToken;
    }

    try {
      const auth = Buffer.from(
        `${this.airtelConfig.clientId}:${this.airtelConfig.clientSecret}`
      ).toString('base64');

      const response = await this.makeRequest(
        'POST',
        `${this.airtelConfig.baseUrl}/oauth2/token`,
        { grant_type: 'client_credentials' },
        {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        }
      );

      const { access_token, expires_in } = response.data;

      // Cache the token
      this.airtelToken = access_token;
      this.airtelTokenExpires = Date.now() + (expires_in - 60) * 1000; // Refresh 60s before expiry

      return access_token;
    } catch (error) {
      logger.error('Failed to get Airtel access token', {
        error: error.message,
      });
      throw new Error('Failed to authenticate with Airtel Money service');
    }
  }

  /**
   * Process refund for MTN payment
   */
  async refundMTNPayment(transactionId, amount, reason) {
    try {
      logger.info('Processing MTN refund', {
        transactionId,
        amount,
        reason,
      });

      // Implementation depends on MTN API capabilities
      // This is a placeholder - actual implementation requires MTN refund API

      return {
        transactionId,
        refundId: this.generateTransactionId(),
        status: 'PROCESSING',
        refundAmount: amount,
        reason,
      };
    } catch (error) {
      logger.error('MTN refund failed', {
        transactionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Process refund for Airtel payment
   */
  async refundAirtelPayment(transactionId, amount, reason) {
    try {
      logger.info('Processing Airtel refund', {
        transactionId,
        amount,
        reason,
      });

      const token = await this.getAirtelAccessToken();

      const payload = {
        originalTransaction: transactionId,
        amount: amount.toString(),
        reason: reason || 'Customer request',
      };

      const response = await this.makeRequest(
        'POST',
        `${this.airtelConfig.baseUrl}/payments/${transactionId}/refunds`,
        payload,
        {
          Authorization: `Bearer ${token}`,
          'X-Client-Id': this.airtelConfig.clientId,
        }
      );

      const refundData = response.data?.data || response.data;

      return {
        transactionId,
        refundId: refundData.id,
        status: 'PROCESSING',
        refundAmount: amount,
        reason,
      };
    } catch (error) {
      logger.error('Airtel refund failed', {
        transactionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Helper: Make HTTP request with retry logic
   */
  async makeRequest(method, url, data = null, headers = {}, retryCount = 0) {
    try {
      const config = {
        method,
        url,
        headers,
        timeout: this.timeout,
      };

      if (data) {
        config.data = data;
      }

      const response = await axios(config);
      return response;
    } catch (error) {
      // Retry logic for transient failures
      if (retryCount < this.maxRetries && this.isRetryableError(error)) {
        const delay = Math.min(1000 * Math.pow(2, retryCount), 30000);
        logger.warn(`Request failed, retrying in ${delay}ms`, {
          url,
          attempt: retryCount + 1,
          error: error.message,
        });

        await new Promise((resolve) => setTimeout(resolve, delay));
        return this.makeRequest(method, url, data, headers, retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Helper: Check if error is retryable
   */
  isRetryableError(error) {
    if (!error.response) {
      // Network errors are retryable
      return true;
    }

    const status = error.response.status;
    // Retry on 5xx and specific 4xx errors
    return status >= 500 || [408, 429].includes(status);
  }

  /**
   * Helper: Generate unique transaction ID
   */
  generateTransactionId() {
    return `TXN-${Date.now()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  }

  /**
   * Helper: Format phone number to international format
   */
  formatPhoneNumber(phoneNumber) {
    // Remove any non-digit characters except +
    let formatted = phoneNumber.replace(/[^\d+]/g, '');

    // Ensure it starts with +
    if (!formatted.startsWith('+')) {
      // If it starts with country code (e.g., 234, 237)
      if (!formatted.startsWith('0')) {
        formatted = '+' + formatted;
      } else {
        // If it starts with 0, replace with country code
        // This is a simplified approach - actual implementation should detect country
        formatted = '+237' + formatted.substring(1);
      }
    }

    return formatted;
  }

  /**
   * Helper: Mask phone number for logging
   */
  maskPhoneNumber(phoneNumber) {
    const formatted = this.formatPhoneNumber(phoneNumber);
    return formatted.replace(/(\d{3})(\d{4})(\d+)/, '$1****$3');
  }

  /**
   * Helper: Validate payment input
   */
  validatePaymentInput(phoneNumber, amount, currency) {
    if (!phoneNumber || !phoneNumber.match(/^\+?[1-9]\d{1,14}$/)) {
      throw new Error('Invalid phone number format');
    }

    if (!amount || amount <= 0 || isNaN(amount)) {
      throw new Error('Invalid payment amount');
    }

    if (!currency || !['XAF', 'EUR', 'USD', 'NGN', 'GHS', 'KES', 'ZAR'].includes(currency)) {
      throw new Error('Invalid or unsupported currency');
    }
  }

  /**
   * Helper: Map MTN status to standard status
   */
  mapMTNStatus(mtnStatus) {
    const statusMap = {
      SUCCESSFUL: 'COMPLETED',
      FAILED: 'FAILED',
      EXPIRED: 'FAILED',
      PENDING: 'PENDING',
    };

    return statusMap[mtnStatus] || 'PENDING';
  }

  /**
   * Helper: Map Airtel status to standard status
   */
  mapAirtelStatus(airtelStatus) {
    const statusMap = {
      SUCCESS: 'COMPLETED',
      FAILED: 'FAILED',
      TIMEOUT: 'FAILED',
      PENDING: 'PENDING',
      INITIATED: 'PENDING',
    };

    return statusMap[airtelStatus] || 'PENDING';
  }

  /**
   * Helper: Handle payment errors
   */
  handlePaymentError(error, provider) {
    if (error.response) {
      const status = error.response.status;
      const message = error.response.data?.message || error.message;

      if (status === 401 || status === 403) {
        return new Error(
          `Authentication failed with ${provider} provider. Check your credentials.`
        );
      }

      if (status === 400) {
        return new Error(`Invalid payment request: ${message}`);
      }

      if (status === 422) {
        return new Error(`Invalid phone number or amount: ${message}`);
      }

      return new Error(`${provider} error: ${message}`);
    }

    // Network or timeout error
    return new Error(`Unable to connect to ${provider} service. Please try again.`);
  }
}

module.exports = new MobileMoneyService();
