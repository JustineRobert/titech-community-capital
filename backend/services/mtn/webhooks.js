// backend/services/mtn/webhooks.js

'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const net = require('net');

let logger = console;
let Transaction = null;
let WebhookEvent = null;
let auditService = null;
let settlementService = null;
let reconciliationService = null;
let notificationService = null;
let queueService = null;
let fraudDetectionService = null;
let regulatoryReportingService = null;

try {
  logger = require('../../modules/logger');
} catch {}

try {
  Transaction =
    require('../../models/Transaction');
} catch {}

try {
  WebhookEvent =
    require('../../models/WebhookEvent');
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
  reconciliationService =
    require(
      './reconciliation'
    );
} catch {}

try {
  notificationService =
    require(
      '../../modules/notificationService'
    );
} catch {}

try {
  queueService =
    require('../../modules/queueService');
} catch {}

try {
  fraudDetectionService =
    require(
      '../../modules/fraudDetectionService'
    );
} catch {}

try {
  regulatoryReportingService =
    require(
      '../../modules/regulatoryReportingService'
    );
} catch {}

class MTNWebhookService extends EventEmitter {
  constructor({
    cache = null,
    config = {},
  } = {}) {
    super();

    this.cache = cache;

    this.config = {
      webhookSecret:
        process.env
          .MTN_WEBHOOK_SECRET || '',

      replayWindowMs:
        Number(
          process.env
            .MTN_WEBHOOK_REPLAY_WINDOW_MS
        ) || 300000,

      maxPayloadSize:
        Number(
          process.env
            .MTN_WEBHOOK_MAX_PAYLOAD_SIZE
        ) || 1024 * 1024,

      allowedIPs: (
        process.env
          .MTN_WEBHOOK_IPS || ''
      )
        .split(',')
        .map(ip => ip.trim())
        .filter(Boolean),

      replayCacheKey:
        'mtn:webhook:event:',

      ...config,
    };

    this.processedEvents =
      new Map();

    this.metrics = {
      processed: 0,
      duplicates: 0,
      failed: 0,
      replayBlocked: 0,
      signatureFailures: 0,
      ipFailures: 0,
      settlementTriggers: 0,
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Audit
   |--------------------------------------------------------------------------
   */

  async audit(
    action,
    payload = {}
  ) {
    try {
      const entry = {
        provider:
          'MTN_MOMO',
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
        `[MTN WEBHOOK] ${action}`,
        payload
      );
    } catch (error) {
      logger.error(
        'Webhook audit failure',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | IP Validation
   |--------------------------------------------------------------------------
   */

  validateSourceIP(
    ip
  ) {
    if (
      this.config.allowedIPs
        .length === 0
    ) {
      return true;
    }

    return this.config.allowedIPs.includes(
      ip
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Signature Validation
   |--------------------------------------------------------------------------
   */

  validateSignature(
    rawBody,
    signature
  ) {
    if (
      !this.config
        .webhookSecret
    ) {
      return true;
    }

    const expected =
      crypto
        .createHmac(
          'sha256',
          this.config
            .webhookSecret
        )
        .update(rawBody)
        .digest('hex');

    const a =
      Buffer.from(
        expected
      );

    const b =
      Buffer.from(
        signature || ''
      );

    if (
      a.length !==
      b.length
    ) {
      return false;
    }

    return crypto.timingSafeEqual(
      a,
      b
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Payload Validation
   |--------------------------------------------------------------------------
   */

  validatePayload(
    payload
  ) {
    if (!payload) {
      throw new Error(
        'Webhook payload missing.'
      );
    }

    const size =
      Buffer.byteLength(
        JSON.stringify(
          payload
        )
      );

    if (
      size >
      this.config
        .maxPayloadSize
    ) {
      throw new Error(
        'Payload too large.'
      );
    }

    if (
      !payload
        .referenceId &&
      !payload
        .externalId
    ) {
      throw new Error(
        'Missing reference.'
      );
    }

    return true;
  }

  /*
   |--------------------------------------------------------------------------
   | Replay Protection
   |--------------------------------------------------------------------------
   */

  async isReplay(
    eventId
  ) {
    if (!eventId) {
      return false;
    }

    if (
      this.cache
    ) {
      const exists =
        await this.cache.get(
          `${this.config.replayCacheKey}${eventId}`
        );

      return !!exists;
    }

    const timestamp =
      this.processedEvents.get(
        eventId
      );

    if (!timestamp) {
      return false;
    }

    return (
      Date.now() -
        timestamp <
      this.config
        .replayWindowMs
    );
  }

  async markProcessed(
    eventId
  ) {
    if (
      !eventId
    ) {
      return;
    }

    if (
      this.cache
    ) {
      await this.cache.set(
        `${this.config.replayCacheKey}${eventId}`,
        true,
        Math.floor(
          this.config
            .replayWindowMs /
            1000
        )
      );

      return;
    }

    this.processedEvents.set(
      eventId,
      Date.now()
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Transaction Lookup
   |--------------------------------------------------------------------------
   */

  async findTransaction(
    reference
  ) {
    if (
      !Transaction
    ) {
      return null;
    }

    return Transaction.findOne(
      {
        $or: [
          {
            reference,
          },
          {
            externalId:
              reference,
          },
          {
            providerReference:
              reference,
          },
        ],
      }
    );
  }

  /*
   |--------------------------------------------------------------------------
   | Status Mapping
   |--------------------------------------------------------------------------
   */

  mapStatus(
    status
  ) {
    switch (
      String(
        status || ''
      ).toUpperCase()
    ) {
      case 'SUCCESSFUL':
      case 'COMPLETED':
        return 'COMPLETED';

      case 'FAILED':
      case 'REJECTED':
      case 'CANCELLED':
        return 'FAILED';

      case 'PENDING':
      case 'INITIATED':
        return 'PENDING';

      default:
        return 'UNKNOWN';
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Update Transaction
   |--------------------------------------------------------------------------
   */

  async updateTransaction(
    tx,
    payload
  ) {
    if (!tx) {
      return null;
    }

    tx.providerStatus =
      payload.status;

    tx.status =
      this.mapStatus(
        payload.status
      );

    tx.webhookProcessed =
      true;

    tx.webhookReceivedAt =
      new Date();

    tx.providerPayload =
      payload;

    if (
      typeof tx.save ===
      'function'
    ) {
      await tx.save();
    }

    return tx;
  }

  /*
   |--------------------------------------------------------------------------
   | Settlement Trigger
   |--------------------------------------------------------------------------
   */

  async processSettlement(
    transaction
  ) {
    if (
      !transaction ||
      transaction.status !==
        'COMPLETED'
    ) {
      return;
    }

    try {
      if (
        settlementService
          ?.processTransaction
      ) {
        await settlementService.processTransaction(
          transaction
        );

        this.metrics
          .settlementTriggers++;
      }
    } catch (error) {
      logger.error(
        'Settlement failure',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Reconciliation Trigger
   |--------------------------------------------------------------------------
   */

  async triggerReconciliation(
    transaction
  ) {
    try {
      if (
        reconciliationService
          ?.reconcileDaily
      ) {
        await queueService?.enqueue?.(
          'mtn-reconciliation',
          {
            transactionId:
              transaction._id,
          }
        );
      }
    } catch (error) {
      logger.error(
        'Reconciliation trigger failed',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Event Persistence
   |--------------------------------------------------------------------------
   */

  async persistEvent(
    payload
  ) {
    if (
      !WebhookEvent
    ) {
      return;
    }

    try {
      await WebhookEvent.create(
        {
          provider:
            'MTN_MOMO',
          payload,
          createdAt:
            new Date(),
        }
      );
    } catch (error) {
      logger.error(
        'Webhook persistence failed',
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Main Handler
   |--------------------------------------------------------------------------
   */

  async processWebhook({
    payload,
    rawBody,
    signature,
    sourceIP,
  }) {
    try {
      if (
        !this.validateSourceIP(
          sourceIP
        )
      ) {
        this.metrics
          .ipFailures++;

        throw new Error(
          'Unauthorized source IP.'
        );
      }

      if (
        !this.validateSignature(
          rawBody,
          signature
        )
      ) {
        this.metrics
          .signatureFailures++;

        throw new Error(
          'Invalid signature.'
        );
      }

      this.validatePayload(
        payload
      );

      const eventId =
        payload.eventId ||
        payload.referenceId ||
        payload.externalId;

      if (
        await this.isReplay(
          eventId
        )
      ) {
        this.metrics
          .duplicates++;
        this.metrics
          .replayBlocked++;

        return {
          success: true,
          duplicate: true,
        };
      }

      await this.markProcessed(
        eventId
      );

      await this.persistEvent(
        payload
      );

      const reference =
        payload.referenceId ||
        payload.externalId;

      const transaction =
        await this.findTransaction(
          reference
        );

      if (
        !transaction
      ) {
        await this.audit(
          'TRANSACTION_NOT_FOUND',
          {
            reference,
          }
        );

        return {
          success: false,
          reason:
            'Transaction not found',
        };
      }

      const updated =
        await this.updateTransaction(
          transaction,
          payload
        );

      await this.processSettlement(
        updated
      );

      await this.triggerReconciliation(
        updated
      );

      if (
        notificationService
          ?.send
      ) {
        await notificationService.send(
          {
            type:
              'MTN_WEBHOOK_PROCESSED',
            payload: {
              transactionId:
                updated._id,
                status:
                  updated.status,
              reference,
            },
          }
        );
      }

      if (
        regulatoryReportingService
          ?.recordWebhook
      ) {
        await regulatoryReportingService.recordWebhook(
          payload
        );
      }

      this.metrics
        .processed++;

      await this.audit(
        'WEBHOOK_PROCESSED',
        {
          eventId,
          reference,
          status:
            updated.status,
        }
      );

      this.emit(
        'webhook.processed',
        updated
      );

      return {
        success: true,
        transactionId:
          updated._id,
        status:
          updated.status,
      };
    } catch (error) {
      this.metrics
        .failed++;

      await this.audit(
        'WEBHOOK_FAILED',
        {
          error:
            error.message,
          payload,
        }
      );

      throw error;
    }
  }

  /*
   |--------------------------------------------------------------------------
   | Maintenance
   |--------------------------------------------------------------------------
   */

  clearReplayCache() {
    this.processedEvents.clear();

    return {
      success: true,
      timestamp:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | Health
   |--------------------------------------------------------------------------
   */

  healthCheck() {
    return {
      provider:
        'MTN_MOMO',
      service:
        'WEBHOOKS',
      replayCacheSize:
        this.processedEvents
          .size,
      replayWindowMs:
        this.config
          .replayWindowMs,
      metrics:
        this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }

  getMetrics() {
    return {
      provider:
        'MTN_MOMO',
      service:
        'WEBHOOKS',
      ...this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new MTNWebhookService();

module.exports.MTNWebhookService =
  MTNWebhookService;