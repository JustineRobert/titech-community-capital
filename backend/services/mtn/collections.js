// backend/services/mtn/collections.js

'use strict';

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const EventEmitter = require('events');

const authService = require('./auth');

let logger = console;
let Transaction = null;
let auditService = null;
let settlementService = null;
let queueService = null;

try {
  logger = require('../../modules/logger');
} catch {}

try {
  Transaction =
    require('../../models/Transaction');
} catch {}

try {
  auditService =
    require('../../modules/auditService');
} catch {}

try {
  settlementService =
    require(
      '../../modules/mobileMoneySettlementService'
    );
} catch {}

try {
  queueService =
    require('../../modules/queueService');
} catch {}

class MTNCollectionsService extends EventEmitter {
  constructor({
    cache = null,
    config = {},
  } = {}) {
    super();

    this.cache = cache;

    this.config = {
      baseUrl:
        process.env.MTN_MOMO_BASE_URL,

      subscriptionKey:
        process.env
          .MTN_MOMO_SUBSCRIPTION_KEY,

      currency:
        process.env
          .DEFAULT_CURRENCY ||
        'UGX',

      timeout:
        Number(
          process.env
            .MTN_MOMO_TIMEOUT
        ) || 60000,

      retryAttempts:
        Number(
          process.env
            .MTN_MOMO_RETRY_ATTEMPTS
        ) || 3,

      retryDelay:
        Number(
          process.env
            .MTN_MOMO_RETRY_DELAY
        ) || 1000,

      statusPollingInterval:
        5000,

      statusPollingRetries:
        12,

      ...config,
    };

    this.http =
      axios.create({
        timeout:
          this.config.timeout,
        httpsAgent:
          new https.Agent({
            keepAlive: true,
            maxSockets: 100,
          }),
      });

    this.metrics = {
      requests: 0,
      successful: 0,
      failed: 0,
      retries: 0,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Utilities
   |--------------------------------------------------------------------------
   */

  generateReferenceId() {
    return crypto.randomUUID();
  }

  generateExternalId() {
    return crypto.randomUUID();
  }

  async buildHeaders(
    referenceId
  ) {
    const token =
      await authService.getAccessToken();

    return {
      Authorization:
        `Bearer ${token}`,
      'Content-Type':
        'application/json',
      'X-Reference-Id':
        referenceId,
      'X-Correlation-Id':
        crypto.randomUUID(),
      'Ocp-Apim-Subscription-Key':
        this.config
          .subscriptionKey,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Idempotency
   |--------------------------------------------------------------------------
   */

  async ensureIdempotency(
    reference
  ) {
    if (
      !Transaction ||
      !reference
    ) {
      return;
    }

    const existing =
      await Transaction.findOne({
        reference,
      });

    if (existing) {
      throw new Error(
        `Duplicate reference ${reference}`
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Audit
   |--------------------------------------------------------------------------
   */

  async audit(
    action,
    payload
  ) {
    try {
      if (
        auditService &&
        auditService.record
      ) {
        await auditService.record({
          provider:
            'MTN_MOMO',
          action,
          payload,
          timestamp:
            new Date(),
        });
      }
    } catch (error) {
      logger.error(
        'MTN audit failed',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | HTTP Retry
   |--------------------------------------------------------------------------
   */

  async retry(fn) {
    let lastError;

    for (
      let attempt = 1;
      attempt <=
      this.config
        .retryAttempts;
      attempt++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        this.metrics.retries++;

        if (
          attempt <
          this.config
            .retryAttempts
        ) {
          const delay =
            this.config
              .retryDelay *
            Math.pow(
              2,
              attempt - 1
            );

          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                delay
              )
          );
        }
      }
    }

    throw lastError;
  }

  /*
   |--------------------------------------------------------------------------
   | Request To Pay
   |--------------------------------------------------------------------------
   */

  async requestToPay({
    amount,
    phoneNumber,
    currency =
      this.config.currency,
    externalId,
    payerMessage,
    payeeNote,
    reference,
    tenantId,
    metadata = {},
  }) {
    await this.ensureIdempotency(
      reference
    );

    const referenceId =
      this.generateReferenceId();

    const headers =
      await this.buildHeaders(
        referenceId
      );

    const payload = {
      amount:
        String(amount),
      currency,
      externalId:
        externalId ||
        reference ||
        this.generateExternalId(),

      payer: {
        partyIdType:
          'MSISDN',
        partyId:
          phoneNumber,
      },

      payerMessage:
        payerMessage ||
        'Payment',

      payeeNote:
        payeeNote ||
        'Payment',
    };

    this.metrics.requests++;

    try {
      await this.retry(() =>
        this.http.post(
          `${this.config.baseUrl}/collection/v1_0/requesttopay`,
          payload,
          {
            headers,
          }
        )
      );

      this.metrics.successful++;

      const transaction = {
        provider:
          'MTN_MOMO',
        tenantId,
        reference:
          referenceId,
        externalId:
          payload.externalId,
        amount,
        currency,
        phoneNumber,
        status:
          'PENDING',
        metadata,
        createdAt:
          new Date(),
      };

      if (Transaction) {
        await Transaction.create(
          transaction
        );
      }

      await this.audit(
        'REQUEST_TO_PAY_CREATED',
        transaction
      );

      this.emit(
        'request.created',
        transaction
      );

      return transaction;
    } catch (error) {
      this.metrics.failed++;

      await this.audit(
        'REQUEST_TO_PAY_FAILED',
        {
          payload,
          error:
            error.response
              ?.data ||
            error.message,
        }
      );

      throw new Error(
        error.response
          ?.data?.message ||
          error.message
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Deposit
   |--------------------------------------------------------------------------
   */

  async deposit(payload) {
    return this.requestToPay({
      ...payload,
      payerMessage:
        payload
          .payerMessage ||
        'Deposit',
      payeeNote:
        payload.payeeNote ||
        'Account Deposit',
      metadata: {
        transactionType:
          'DEPOSIT',
      },
    });
  }

  /*
   |--------------------------------------------------------------------------
   | Savings Contribution
   |--------------------------------------------------------------------------
   */

  async contributeSavings(
    payload
  ) {
    const result =
      await this.requestToPay({
        ...payload,
        payerMessage:
          'Savings Contribution',
        payeeNote:
          'Savings Contribution',
        metadata: {
          transactionType:
            'SAVINGS_CONTRIBUTION',
          memberId:
            payload.memberId,
          accountId:
            payload
              .savingsAccountId,
        },
      });

    if (
      settlementService
        ?.recordContribution
    ) {
      await settlementService.recordContribution(
        {
          reference:
            result.reference,
          amount:
            result.amount,
          memberId:
            payload.memberId,
        }
      );
    }

    return result;
  }

  /*
   |--------------------------------------------------------------------------
   | Loan Repayment
   |--------------------------------------------------------------------------
   */

  async repayLoan(payload) {
    const result =
      await this.requestToPay({
        ...payload,
        payerMessage:
          'Loan Repayment',
        payeeNote:
          'Loan Repayment',
        metadata: {
          transactionType:
            'LOAN_REPAYMENT',
          memberId:
            payload.memberId,
          loanId:
            payload.loanId,
        },
      });

    if (
      settlementService
        ?.recordLoanRepayment
    ) {
      await settlementService.recordLoanRepayment(
        {
          amount:
            payload.amount,
          memberId:
            payload.memberId,
          loanId:
            payload.loanId,
          reference:
            result.reference,
        }
      );
    }

    return result;
  }

  /*
   |--------------------------------------------------------------------------
   | Status
   |--------------------------------------------------------------------------
   */

  async getStatus(
    referenceId
  ) {
    const token =
      await authService.getAccessToken();

    const response =
      await this.http.get(
        `${this.config.baseUrl}/collection/v1_0/requesttopay/${referenceId}`,
        {
          headers: {
            Authorization:
              `Bearer ${token}`,
            'Ocp-Apim-Subscription-Key':
              this.config
                .subscriptionKey,
          },
        }
      );

    return response.data;
  }

  /*
   |--------------------------------------------------------------------------
   | Poll Until Completed
   |--------------------------------------------------------------------------
   */

  async waitForCompletion(
    referenceId
  ) {
    for (
      let i = 0;
      i <
      this.config
        .statusPollingRetries;
      i++
    ) {
      const status =
        await this.getStatus(
          referenceId
        );

      if (
        [
          'SUCCESSFUL',
          'FAILED',
          'REJECTED',
        ].includes(
          status.status
        )
      ) {
        return status;
      }

      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            this.config
              .statusPollingInterval
          )
      );
    }

    return {
      status:
        'TIMEOUT',
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Webhook Processing
   |--------------------------------------------------------------------------
   */

  async processCallback(
    payload
  ) {
    const referenceId =
      payload.referenceId;

    if (
      Transaction
    ) {
      await Transaction.updateOne(
        {
          reference:
            referenceId,
        },
        {
          $set: {
            status:
              payload.status,
            callback:
              payload,
          },
        }
      );
    }

    this.emit(
      'payment.updated',
      payload
    );

    return {
      success: true,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Retry Failed Transaction
   |--------------------------------------------------------------------------
   */

  async retryCollection(
    referenceId
  ) {
    if (
      queueService
        ?.enqueue
    ) {
      await queueService.enqueue(
        'mtn-collection-retry',
        {
          referenceId,
        }
      );
    }

    return {
      success: true,
      queued: true,
      referenceId,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Health
   |--------------------------------------------------------------------------
   */

  async healthCheck() {
    const auth =
      await authService.healthCheck();

    return {
      provider:
        'MTN_MOMO',
      service:
        'COLLECTIONS',
      healthy:
        auth.healthy,
      metrics:
        this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Metrics
   |--------------------------------------------------------------------------
   */

  getMetrics() {
    return {
      provider:
        'MTN_MOMO',
      service:
        'COLLECTIONS',
      ...this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new MTNCollectionsService();

module.exports.MTNCollectionsService =
  MTNCollectionsService;