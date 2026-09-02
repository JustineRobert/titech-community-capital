// backend/services/mtn/disbursements.js

'use strict';

const axios = require('axios');
const https = require('https');
const crypto = require('crypto');
const EventEmitter = require('events');

const authService = require('./auth');

let logger = console;
let Transaction = null;
let auditService = null;
let queueService = null;
let settlementService = null;
let fraudDetectionService = null;
let riskScoringService = null;

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
  queueService =
    require('../../modules/queueService');
} catch {}

try {
  settlementService =
    require(
      '../../modules/mobileMoneySettlementService'
    );
} catch {}

try {
  fraudDetectionService =
    require(
      '../../modules/fraudDetectionService'
    );
} catch {}

try {
  riskScoringService =
    require(
      '../../modules/riskScoringService'
    );
} catch {}

class MTNDisbursementService extends EventEmitter {
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
          .MTN_MOMO_DISBURSEMENT_SUBSCRIPTION_KEY ||
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

      pollingInterval:
        5000,

      pollingRetries:
        24,

      circuitFailureThreshold:
        5,

      circuitResetMs:
        60000,

      ...config,
    };

    this.metrics = {
      requests: 0,
      successful: 0,
      failed: 0,
      retries: 0,
      payouts: 0,
      bulkPayouts: 0,
    };

    this.failureCount = 0;
    this.circuitOpenedAt =
      null;

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
  }

  /*
   |--------------------------------------------------------------------------
   | Circuit Breaker
   |--------------------------------------------------------------------------
   */

  isCircuitOpen() {
    if (
      !this.circuitOpenedAt
    ) {
      return false;
    }

    if (
      Date.now() -
        this.circuitOpenedAt >
      this.config
        .circuitResetMs
    ) {
      this.failureCount = 0;
      this.circuitOpenedAt =
        null;
      return false;
    }

    return true;
  }

  registerFailure() {
    this.failureCount++;

    if (
      this.failureCount >=
      this.config
        .circuitFailureThreshold
    ) {
      this.circuitOpenedAt =
        Date.now();
    }
  }

  registerSuccess() {
    this.failureCount = 0;
    this.circuitOpenedAt =
      null;
  }

  /*
   |--------------------------------------------------------------------------
   | Utilities
   |--------------------------------------------------------------------------
   */

  generateReferenceId() {
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
   | Retry
   |--------------------------------------------------------------------------
   */

  async retry(fn) {
    let lastError;

    for (
      let i = 1;
      i <=
      this.config
        .retryAttempts;
      i++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        this.metrics.retries++;

        if (
          i <
          this.config
            .retryAttempts
        ) {
          await new Promise(
            resolve =>
              setTimeout(
                resolve,
                this.config
                  .retryDelay *
                  Math.pow(
                    2,
                    i - 1
                  )
              )
          );
        }
      }
    }

    throw lastError;
  }

  /*
   |--------------------------------------------------------------------------
   | Fraud Validation
   |--------------------------------------------------------------------------
   */

  async validateTransaction(
    payload
  ) {
    if (
      fraudDetectionService
        ?.evaluateTransaction
    ) {
      const fraud =
        await fraudDetectionService.evaluateTransaction(
          payload
        );

      if (
        fraud.blocked
      ) {
        throw new Error(
          'Transaction blocked by fraud engine.'
        );
      }
    }

    if (
      riskScoringService
        ?.scoreTransaction
    ) {
      const risk =
        await riskScoringService.scoreTransaction(
          payload
        );

      if (
        risk.score >=
        90
      ) {
        throw new Error(
          'Transaction risk score exceeded threshold.'
        );
      }
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Create Disbursement
   |--------------------------------------------------------------------------
   */

  async disburse({
    tenantId,
    amount,
    phoneNumber,
    currency =
      this.config.currency,
    externalId,
    payerMessage =
      'Payment',
    payeeNote =
      'Payment',
    metadata = {},
  }) {
    if (
      this.isCircuitOpen()
    ) {
      throw new Error(
        'MTN disbursement circuit is open.'
      );
    }

    await this.validateTransaction(
      {
        tenantId,
        amount,
        phoneNumber,
      }
    );

    const referenceId =
      this.generateReferenceId();

    const payload = {
      amount:
        String(amount),
      currency,
      externalId:
        externalId ||
        referenceId,
      payee: {
        partyIdType:
          'MSISDN',
        partyId:
          phoneNumber,
      },
      payerMessage,
      payeeNote,
    };

    const headers =
      await this.buildHeaders(
        referenceId
      );

    this.metrics.requests++;

    try {
      await this.retry(() =>
        this.http.post(
          `${this.config.baseUrl}/disbursement/v1_0/transfer`,
          payload,
          {
            headers,
          }
        )
      );

      this.metrics.successful++;
      this.metrics.payouts++;

      this.registerSuccess();

      const transaction = {
        provider:
          'MTN_MOMO',
        type:
          'DISBURSEMENT',
        tenantId,
        reference:
          referenceId,
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
        'DISBURSEMENT_CREATED',
        transaction
      );

      this.emit(
        'disbursement.created',
        transaction
      );

      return transaction;
    } catch (error) {
      this.registerFailure();
      this.metrics.failed++;

      throw new Error(
        error.response
          ?.data?.message ||
          error.message
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Loan Disbursement
   |--------------------------------------------------------------------------
   */

  async disburseLoan(
    payload
  ) {
    return this.disburse({
      ...payload,
      payerMessage:
        'Loan Disbursement',
      payeeNote:
        'Loan Proceeds',
      metadata: {
        ...payload.metadata,
        transactionType:
          'LOAN_DISBURSEMENT',
        loanId:
          payload.loanId,
      },
    });
  }

  /*
   |--------------------------------------------------------------------------
   | Savings Withdrawal
   |--------------------------------------------------------------------------
   */

  async withdrawSavings(
    payload
  ) {
    return this.disburse({
      ...payload,
      payerMessage:
        'Savings Withdrawal',
      payeeNote:
        'Savings Withdrawal',
      metadata: {
        ...payload.metadata,
        transactionType:
          'SAVINGS_WITHDRAWAL',
        accountId:
          payload.accountId,
      },
    });
  }

  /*
   |--------------------------------------------------------------------------
   | Bulk Disbursement
   |--------------------------------------------------------------------------
   */

  async bulkDisburse(
    transactions = []
  ) {
    const results = [];

    for (const tx of transactions) {
      try {
        const result =
          await this.disburse(
            tx
          );

        results.push({
          success: true,
          result,
        });
      } catch (error) {
        results.push({
          success: false,
          error:
            error.message,
        });
      }
    }

    this.metrics.bulkPayouts++;

    return results;
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
        `${this.config.baseUrl}/disbursement/v1_0/transfer/${referenceId}`,
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
   | Poll Completion
   |--------------------------------------------------------------------------
   */

  async waitForCompletion(
    referenceId
  ) {
    for (
      let i = 0;
      i <
      this.config
        .pollingRetries;
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
              .pollingInterval
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
   | Callback Processing
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
            updatedAt:
              new Date(),
          },
        }
      );
    }

    if (
      payload.status ===
        'SUCCESSFUL' &&
      settlementService
        ?.recordSettlement
    ) {
      await settlementService.recordSettlement(
        {
          reference:
            referenceId,
          provider:
            'MTN_MOMO',
          status:
            payload.status,
        }
      );
    }

    this.emit(
      'disbursement.updated',
      payload
    );

    return {
      success: true,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Queue Retry
   |--------------------------------------------------------------------------
   */

  async retryDisbursement(
    referenceId
  ) {
    if (
      queueService
        ?.enqueue
    ) {
      await queueService.enqueue(
        'mtn-disbursement-retry',
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
   | Audit
   |--------------------------------------------------------------------------
   */

  async audit(
    action,
    payload
  ) {
    try {
      if (
        auditService
          ?.record
      ) {
        await auditService.record(
          {
            provider:
              'MTN_MOMO',
            action,
            payload,
            timestamp:
              new Date(),
          }
        );
      }
    } catch (error) {
      logger.error(
        'MTN disbursement audit failed',
        error
      );
    }
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
        'DISBURSEMENTS',
      healthy:
        auth.healthy &&
        !this.isCircuitOpen(),
      circuitOpen:
        this.isCircuitOpen(),
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
        'DISBURSEMENTS',
      ...this.metrics,
      circuitOpen:
        this.isCircuitOpen(),
      failureCount:
        this.failureCount,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new MTNDisbursementService();

module.exports.MTNDisbursementService =
  MTNDisbursementService;