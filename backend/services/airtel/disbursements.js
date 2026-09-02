// backend/services/airtel/disbursements.js

'use strict';

const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const EventEmitter = require('events');

const authService = require('./auth');

let logger = console;
let Transaction = null;
let auditService = null;
let settlementService = null;
let fraudDetectionService = null;
let amlService = null;
let notificationService = null;
let regulatoryReportingService = null;
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
    require('../../modules/mobileMoneySettlementService');
} catch {}

try {
  fraudDetectionService =
    require('../../modules/fraudDetectionService');
} catch {}

try {
  amlService =
    require('../../modules/amlService');
} catch {}

try {
  notificationService =
    require('../../modules/notificationService');
} catch {}

try {
  regulatoryReportingService =
    require('../../modules/regulatoryReportingService');
} catch {}

try {
  queueService =
    require('../../modules/queueService');
} catch {}

class AirtelDisbursementService extends EventEmitter {
  constructor(config = {}) {
    super();

    this.provider =
      'AIRTEL_MONEY';

    this.config = {
      baseUrl:
        process.env
          .AIRTEL_MONEY_BASE_URL ||
        'https://openapi.airtel.africa',

      country:
        process.env
          .AIRTEL_COUNTRY ||
        process.env
          .DEFAULT_COUNTRY ||
        'UG',

      currency:
        process.env
          .DEFAULT_CURRENCY ||
        'UGX',

      timeout:
        Number(
          process.env
            .AIRTEL_TIMEOUT
        ) || 30000,

      maxRetries:
        Number(
          process.env
            .AIRTEL_MAX_RETRIES
        ) || 3,

      retryDelay:
        Number(
          process.env
            .AIRTEL_RETRY_DELAY
        ) || 1000,

      bulkConcurrency:
        Number(
          process.env
            .AIRTEL_BULK_CONCURRENCY
        ) || 10,

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
      withdrawals: 0,
      loanDisbursements: 0,
      bulkTransfers: 0,
      successfulRequests: 0,
      failedRequests: 0,
      settlements: 0,
      statusQueries: 0,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Helpers
   |--------------------------------------------------------------------------
   */

  generateReference() {
    return crypto.randomUUID();
  }

  async audit(
    action,
    payload = {}
  ) {
    try {
      const entry = {
        provider:
          this.provider,
        action,
        payload,
        timestamp:
          new Date(),
      };

      if (
        auditService?.record
      ) {
        await auditService.record(
          entry
        );
      }

      logger.info(
        `[AIRTEL DISBURSEMENTS] ${action}`,
        payload
      );
    } catch (error) {
      logger.error(
        '[AIRTEL DISBURSEMENTS] Audit failure',
        error
      );
    }
  }

  async ensureIdempotency(
    reference
  ) {
    if (
      !Transaction?.findOne
    ) {
      return;
    }

    const existing =
      await Transaction.findOne({
        reference,
      });

    if (existing) {
      throw new Error(
        `Duplicate reference: ${reference}`
      );
    }
  }

  async createTransaction(
    payload
  ) {
    if (
      !Transaction?.create
    ) {
      return null;
    }

    return Transaction.create(
      payload
    );
  }

  async executeWithRetry(
    fn
  ) {
    let lastError;

    for (
      let attempt = 1;
      attempt <=
      this.config
        .maxRetries;
      attempt++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        this.metrics
          .failedRequests++;

        if (
          attempt <
          this.config
            .maxRetries
        ) {
          const delay =
            this.config
              .retryDelay *
              Math.pow(
                2,
                attempt - 1
              ) +
            Math.floor(
              Math.random() *
                500
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

  async buildHeaders(
    reference
  ) {
    return {
      ...(await authService.getAuthorizationHeaders()),
      'X-Reference-Id':
        reference,
      'X-Country':
        this.config.country,
      'X-Currency':
        this.config.currency,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Compliance
   |--------------------------------------------------------------------------
   */

  async runComplianceChecks(
    transaction
  ) {
    try {
      if (
        fraudDetectionService
          ?.evaluateTransaction
      ) {
        await fraudDetectionService.evaluateTransaction(
          transaction
        );
      }

      if (
        amlService
          ?.screenTransaction
      ) {
        await amlService.screenTransaction(
          transaction
        );
      }
    } catch (error) {
      logger.error(
        'Compliance checks failed',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Core Transfer
   |--------------------------------------------------------------------------
   */

  async initiateTransfer({
    amount,
    phoneNumber,
    transactionType,
    metadata = {},
    reference,
    tenantId = null,
  }) {
    reference =
      reference ||
      this.generateReference();

    const correlationId =
      crypto.randomUUID();

    await this.ensureIdempotency(
      reference
    );

    const payload = {
      reference,
      payee: {
        msisdn:
          phoneNumber,
        country:
          this.config.country,
        currency:
          this.config.currency,
      },
      transaction: {
        amount:
          String(amount),
        id: reference,
      },
    };

    await this.audit(
      'DISBURSEMENT_INITIATED',
      {
        reference,
        amount,
        transactionType,
      }
    );

    const providerResponse =
      await this.executeWithRetry(
        async () => {
          const headers =
            await this.buildHeaders(
              reference
            );

          headers[
            'X-Correlation-ID'
          ] = correlationId;

          const response =
            await this.http.post(
              `${this.config.baseUrl}/merchant/v1/payments`,
              payload,
              {
                headers,
              }
            );

          return response.data;
        }
      );

    const transaction =
      await this.createTransaction(
        {
          tenantId,
          provider:
            this.provider,
          transactionType,
          reference,
          amount,
          currency:
            this.config
              .currency,
          phoneNumber,
          status:
            'PENDING',
          providerStatus:
            providerResponse
              ?.status ||
            'PENDING',
          metadata,
          correlationId,
        }
      );

    await this.runComplianceChecks(
      transaction
    );

    if (
      queueService
        ?.enqueue
    ) {
      await queueService.enqueue(
        'airtel-disbursement',
        {
          reference,
          transactionId:
            transaction?._id,
        }
      );
    }

    if (
      notificationService
        ?.send
    ) {
      await notificationService.send(
        {
          type:
            'DISBURSEMENT_INITIATED',
          transactionId:
            transaction?._id,
          reference,
        }
      );
    }

    if (
      regulatoryReportingService
        ?.recordTransaction
    ) {
      await regulatoryReportingService.recordTransaction(
        transaction
      );
    }

    this.metrics
      .successfulRequests++;

    this.emit(
      'disbursement.initiated',
      transaction
    );

    return {
      success: true,
      provider:
        this.provider,
      reference,
      transactionType,
      amount,
      currency:
        this.config
          .currency,
      status:
        providerResponse
          ?.status ||
        'PENDING',
      providerResponse,
      correlationId,
      createdAt:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Withdrawals
   |--------------------------------------------------------------------------
   */

  async withdraw(
    payload = {}
  ) {
    this.metrics
      .withdrawals++;

    return this.initiateTransfer(
      {
        ...payload,
        transactionType:
          'WITHDRAWAL',
      }
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Loan Disbursement
   |--------------------------------------------------------------------------
   */

  async disburseLoan(
    payload = {}
  ) {
    this.metrics
      .loanDisbursements++;

    return this.initiateTransfer(
      {
        ...payload,
        transactionType:
          'LOAN_DISBURSEMENT',
      }
    );
  }

  async disburse(
    payload = {}
  ) {
    return this.disburseLoan(
      payload
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Bulk Disbursement
   |--------------------------------------------------------------------------
   */

  async bulkTransfer(
    transactions = []
  ) {
    this.metrics
      .bulkTransfers++;

    const results = [];

    for (
      let i = 0;
      i < transactions.length;
      i +=
      this.config
        .bulkConcurrency
    ) {
      const batch =
        transactions.slice(
          i,
          i +
            this.config
              .bulkConcurrency
        );

      const batchResults =
        await Promise.allSettled(
          batch.map(tx =>
            this.disburse(
              tx
            )
          )
        );

      results.push(
        ...batchResults
      );
    }

    const successful =
      results.filter(
        r =>
          r.status ===
          'fulfilled'
      ).length;

    const failed =
      results.length -
      successful;

    await this.audit(
      'BULK_TRANSFER_COMPLETED',
      {
        total:
          transactions.length,
        successful,
        failed,
      }
    );

    return {
      success: true,
      provider:
        this.provider,
      total:
        transactions.length,
      successful,
      failed,
      results,
      completedAt:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Status Query
   |--------------------------------------------------------------------------
   */

  async getStatus(
    reference
  ) {
    this.metrics
      .statusQueries++;

    const headers =
      await this.buildHeaders(
        reference
      );

    const response =
      await this.http.get(
        `${this.config.baseUrl}/standard/v1/payments/${reference}`,
        {
          headers,
        }
      );

    return {
      success: true,
      provider:
        this.provider,
      reference,
      status:
        response.data?.data
          ?.transaction
          ?.status ||
        'UNKNOWN',
      providerResponse:
        response.data,
      checkedAt:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Settlement
   |--------------------------------------------------------------------------
   */

  async postSettlement(
    transaction
  ) {
    try {
      if (
        settlementService
          ?.processTransaction
      ) {
        await settlementService.processTransaction(
          transaction
        );

        this.metrics
          .settlements++;
      }
    } catch (error) {
      logger.error(
        '[AIRTEL DISBURSEMENTS] Settlement failed',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Health
   |--------------------------------------------------------------------------
   */

  healthCheck() {
    return {
      provider:
        this.provider,
      service:
        'DISBURSEMENTS',
      healthy: true,
      metrics:
        this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }

  getMetrics() {
    return {
      provider:
        this.provider,
      service:
        'DISBURSEMENTS',
      ...this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new AirtelDisbursementService();

module.exports.AirtelDisbursementService =
  AirtelDisbursementService;