// backend/services/airtel/collections.js

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
let notificationService = null;
let fraudDetectionService = null;
let amlService = null;
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
  notificationService =
    require('../../modules/notificationService');
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
  regulatoryReportingService =
    require('../../modules/regulatoryReportingService');
} catch {}

try {
  queueService =
    require('../../modules/queueService');
} catch {}

class AirtelCollectionsService extends EventEmitter {
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
      initiated: 0,
      deposits: 0,
      savingsContributions: 0,
      loanRepayments: 0,
      statusQueries: 0,
      failedRequests: 0,
      settlements: 0,
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
        `[AIRTEL COLLECTIONS] ${action}`,
        payload
      );
    } catch (error) {
      logger.error(
        '[AIRTEL COLLECTIONS] Audit failure',
        error
      );
    }
  }

  async ensureIdempotency(
    reference
  ) {
    if (
      !Transaction?.findOne ||
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
        `Duplicate transaction reference: ${reference}`
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
      let i = 1;
      i <=
      this.config
        .maxRetries;
      i++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        this.metrics
          .failedRequests++;

        if (
          i <
          this.config
            .maxRetries
        ) {
          const delay =
            this.config
              .retryDelay *
              Math.pow(
                2,
                i - 1
              ) +
            Math.floor(
              Math.random() *
                250
            );

          await new Promise(
            r =>
              setTimeout(
                r,
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
   | Compliance Hooks
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
   | Collection Request
   |--------------------------------------------------------------------------
   */

  async initiateCollection({
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
      subscriber: {
        country:
          this.config.country,
        currency:
          this.config.currency,
        msisdn:
          phoneNumber,
      },
      transaction: {
        amount:
          String(amount),
        id: reference,
      },
    };

    await this.audit(
      'COLLECTION_INITIATED',
      {
        reference,
        transactionType,
        amount,
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
          reference,
          transactionType,
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
        'airtel-collection',
        {
          reference,
          transactionId:
            transaction?._id,
        }
      );
    }

    this.metrics
      .initiated++;

    this.emit(
      'collection.initiated',
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
   | Deposit
   |--------------------------------------------------------------------------
   */

  async deposit(
    payload = {}
  ) {
    this.metrics
      .deposits++;

    return this.initiateCollection(
      {
        ...payload,
        transactionType:
          'DEPOSIT',
      }
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Savings Contribution
   |--------------------------------------------------------------------------
   */

  async contributeSavings(
    payload = {}
  ) {
    this.metrics
      .savingsContributions++;

    return this.initiateCollection(
      {
        ...payload,
        transactionType:
          'SAVINGS_CONTRIBUTION',
      }
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Loan Repayment
   |--------------------------------------------------------------------------
   */

  async repayLoan(
    payload = {}
  ) {
    this.metrics
      .loanRepayments++;

    return this.initiateCollection(
      {
        ...payload,
        transactionType:
          'LOAN_REPAYMENT',
      }
    );
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
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Settlement Hook
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
        '[AIRTEL COLLECTIONS] Settlement failed',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Notifications
   |--------------------------------------------------------------------------
   */

  async notify(
    payload
  ) {
    try {
      if (
        notificationService
          ?.send
      ) {
        await notificationService.send(
          payload
        );
      }
    } catch (error) {
      logger.error(
        'Notification failure',
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
        'COLLECTIONS',
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
        'COLLECTIONS',
      ...this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new AirtelCollectionsService();

module.exports.AirtelCollectionsService =
  AirtelCollectionsService;