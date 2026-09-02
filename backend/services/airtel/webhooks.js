// backend/services/airtel/webhooks.js

"use strict";

const crypto = require("crypto");

let logger;
let Transaction;
let AuditLog;
let WebhookEvent;
let settlementService;
let redisClient;

try {
  logger = require("../../modules/logger");
} catch {
  logger = console;
}

try {
  Transaction = require("../../models/Transaction");
} catch {
  Transaction = null;
}

try {
  AuditLog = require("../../models/AuditLog");
} catch {
  AuditLog = null;
}

try {
  WebhookEvent = require("../../models/WebhookEvent");
} catch {
  WebhookEvent = null;
}

try {
  settlementService = require(
    "../../modules/mobileMoneySettlementService"
  );
} catch {
  settlementService = null;
}

try {
  redisClient = require("../../config/redis");
} catch {
  redisClient = null;
}

class AirtelWebhookService {
  constructor() {
    this.provider = "AIRTEL_MONEY";

    this.webhookSecret =
      process.env.AIRTEL_WEBHOOK_SECRET ||
      process.env.AIRTEL_CALLBACK_SECRET ||
      "";

    this.allowedIPs = (
      process.env.AIRTEL_WEBHOOK_IPS || ""
    )
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    this.allowedClockSkew =
      Number(
        process.env.WEBHOOK_CLOCK_SKEW_MS
      ) || 300000;

    this.replayWindow =
      Number(
        process.env.WEBHOOK_REPLAY_WINDOW_MS
      ) || 300000;

    this.replayCache =
      new Map();

    this.metrics = {
      received: 0,
      processed: 0,
      duplicates: 0,
      failures: 0,
      invalidSignatures: 0,
      unauthorizedIPs: 0,
      settlementsTriggered: 0,
    };

    setInterval(() => {
      this.cleanupReplayCache();
    }, 60000).unref();
  }

  /*
   |--------------------------------------------------------------------------
   | AUDIT
   |--------------------------------------------------------------------------
   */

  async recordAudit(
    action,
    payload = {}
  ) {
    try {
      const record = {
        provider: this.provider,
        action,
        payload,
        timestamp: new Date(),
      };

      if (AuditLog?.create) {
        await AuditLog.create(record);
      }

      logger.info(
        `[AIRTEL WEBHOOK] ${action}`,
        payload
      );
    } catch (error) {
      logger.error(
        "[AIRTEL WEBHOOK] Audit Error",
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | IP VALIDATION
   |--------------------------------------------------------------------------
   */

  validateSourceIP(ip) {
    if (
      this.allowedIPs.length === 0
    ) {
      return true;
    }

    return this.allowedIPs.includes(
      ip
    );
  }

  /*
   |--------------------------------------------------------------------------
   | SIGNATURE
   |--------------------------------------------------------------------------
   */

  generateSignature(rawBody) {
    return crypto
      .createHmac(
        "sha256",
        this.webhookSecret
      )
      .update(rawBody || "")
      .digest("hex");
  }

  validateSignature({
    rawBody,
    signature,
  }) {
    if (!this.webhookSecret) {
      return true;
    }

    if (!signature) {
      return false;
    }

    try {
      const expected =
        this.generateSignature(
          rawBody
        );

      return crypto.timingSafeEqual(
        Buffer.from(expected),
        Buffer.from(signature)
      );
    } catch {
      return false;
    }
  }

  /*
   |--------------------------------------------------------------------------
   | TIMESTAMP VALIDATION
   |--------------------------------------------------------------------------
   */

  validateTimestamp(
    timestamp
  ) {
    if (!timestamp) {
      return true;
    }

    const value =
      new Date(timestamp).getTime();

    if (Number.isNaN(value)) {
      return false;
    }

    return (
      Math.abs(
        Date.now() - value
      ) <= this.allowedClockSkew
    );
  }

  /*
   |--------------------------------------------------------------------------
   | EVENT HELPERS
   |--------------------------------------------------------------------------
   */

  extractReference(payload = {}) {
    return (
      payload.reference ||
      payload.transactionId ||
      payload.externalId ||
      payload.providerReference ||
      payload.id
    );
  }

  extractEventId(payload = {}) {
    return (
      payload.eventId ||
      payload.notificationId ||
      payload.callbackId ||
      payload.id ||
      crypto.randomUUID()
    );
  }

  /*
   |--------------------------------------------------------------------------
   | REPLAY PROTECTION
   |--------------------------------------------------------------------------
   */

  async isDuplicateEvent(
    eventId
  ) {
    if (!eventId) {
      return false;
    }

    try {
      if (
        redisClient?.set
      ) {
        const key =
          `airtel:webhook:${eventId}`;

        const result =
          await redisClient.set(
            key,
            "1",
            {
              NX: true,
              PX: this.replayWindow,
            }
          );

        return result !== "OK";
      }

      const existing =
        this.replayCache.get(
          eventId
        );

      if (
        existing &&
        Date.now() - existing <
          this.replayWindow
      ) {
        return true;
      }

      this.replayCache.set(
        eventId,
        Date.now()
      );

      return false;
    } catch {
      return false;
    }
  }

  cleanupReplayCache() {
    const now = Date.now();

    for (const [
      key,
      value,
    ] of this.replayCache) {
      if (
        now - value >
        this.replayWindow
      ) {
        this.replayCache.delete(
          key
        );
      }
    }
  }

  /*
   |--------------------------------------------------------------------------
   | EVENT STORAGE
   |--------------------------------------------------------------------------
   */

  async storeWebhookEvent(
    event
  ) {
    try {
      if (
        WebhookEvent?.create
      ) {
        return WebhookEvent.create(
          event
        );
      }
    } catch (error) {
      logger.error(
        "[AIRTEL WEBHOOK] Event Storage Error",
        error
      );
    }

    return null;
  }

  /*
   |--------------------------------------------------------------------------
   | STATUS NORMALIZATION
   |--------------------------------------------------------------------------
   */

  normalizeStatus(
    status
  ) {
    const value =
      String(status || "")
        .trim()
        .toUpperCase();

    const map = {
      SUCCESS: "SUCCESS",
      SUCCESSFUL: "SUCCESS",
      COMPLETED: "SUCCESS",
      FAILED: "FAILED",
      ERROR: "FAILED",
      REJECTED: "FAILED",
      PENDING: "PENDING",
      PROCESSING: "PENDING",
      CANCELLED: "CANCELLED",
      EXPIRED: "EXPIRED",
    };

    return (
      map[value] || value
    );
  }

  /*
   |--------------------------------------------------------------------------
   | TRANSACTION UPDATE
   |--------------------------------------------------------------------------
   */

  async updateTransaction(
    reference,
    payload
  ) {
    if (
      !Transaction?.findOneAndUpdate
    ) {
      return null;
    }

    const status =
      this.normalizeStatus(
        payload.status
      );

    return Transaction.findOneAndUpdate(
      {
        $or: [
          { reference },
          {
            externalReference:
              reference,
          },
          {
            providerReference:
              reference,
          },
        ],
      },
      {
        providerStatus:
          status,
        status,
        webhookReceivedAt:
          new Date(),
        webhookPayload:
          payload,
        updatedAt:
          new Date(),
      },
      {
        new: true,
      }
    );
  }

  /*
   |--------------------------------------------------------------------------
   | SETTLEMENT
   |--------------------------------------------------------------------------
   */

  async processSettlement(
    transaction
  ) {
    try {
      if (
        !transaction ||
        !settlementService
      ) {
        return;
      }

      if (
        typeof settlementService.processTransaction ===
        "function"
      ) {
        await settlementService.processTransaction(
          transaction
        );

        this.metrics
          .settlementsTriggered++;
      }
    } catch (error) {
      logger.error(
        "[AIRTEL WEBHOOK] Settlement Error",
        error
      );
    }
  }

  /*
   |--------------------------------------------------------------------------
   | MAIN HANDLER
   |--------------------------------------------------------------------------
   */

  async processWebhook({
    payload,
    rawBody,
    signature,
    sourceIP,
  }) {
    this.metrics.received++;

    const eventId =
      this.extractEventId(
        payload
      );

    const correlationId =
      crypto.randomUUID();

    try {
      await this.recordAudit(
        "WEBHOOK_RECEIVED",
        {
          eventId,
          sourceIP,
          correlationId,
        }
      );

      if (
        !this.validateSourceIP(
          sourceIP
        )
      ) {
        this.metrics
          .unauthorizedIPs++;

        throw new Error(
          "Unauthorized source IP"
        );
      }

      const validSignature =
        this.validateSignature({
          rawBody,
          signature,
        });

      if (!validSignature) {
        this.metrics
          .invalidSignatures++;

        throw new Error(
          "Invalid signature"
        );
      }

      const timestamp =
        payload.timestamp ||
        payload.eventTime;

      if (
        !this.validateTimestamp(
          timestamp
        )
      ) {
        throw new Error(
          "Invalid webhook timestamp"
        );
      }

      const duplicate =
        await this.isDuplicateEvent(
          eventId
        );

      if (duplicate) {
        this.metrics
          .duplicates++;

        return {
          success: true,
          duplicate: true,
          eventId,
        };
      }

      await this.storeWebhookEvent({
        provider: this.provider,
        eventId,
        correlationId,
        payload,
        receivedAt:
          new Date(),
      });

      const reference =
        this.extractReference(
          payload
        );

      const transaction =
        await this.updateTransaction(
          reference,
          payload
        );

      if (
        transaction &&
        transaction.status ===
          "SUCCESS"
      ) {
        await this.processSettlement(
          transaction
        );
      }

      this.metrics.processed++;

      await this.recordAudit(
        "WEBHOOK_PROCESSED",
        {
          eventId,
          correlationId,
          reference,
          status:
            transaction?.status,
        }
      );

      return {
        success: true,
        provider: this.provider,
        correlationId,
        eventId,
        reference,
        status:
          transaction?.status ||
          "UPDATED",
        processedAt:
          new Date().toISOString(),
      };
    } catch (error) {
      this.metrics.failures++;

      await this.recordAudit(
        "WEBHOOK_FAILED",
        {
          eventId,
          correlationId,
          error: error.message,
        }
      );

      throw error;
    }
  }

  /*
   |--------------------------------------------------------------------------
   | HEALTH
   |--------------------------------------------------------------------------
   */

  healthCheck() {
    return {
      provider: this.provider,
      service:
        "AIRTEL_WEBHOOKS",
      healthy: true,
      replayCacheSize:
        this.replayCache.size,
      allowedIPs:
        this.allowedIPs.length,
      timestamp:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | METRICS
   |--------------------------------------------------------------------------
   */

  getMetrics() {
    return {
      provider:
        this.provider,
      ...this.metrics,
      replayCacheSize:
        this.replayCache.size,
      generatedAt:
        new Date().toISOString(),
    };
  }

  /*
   |--------------------------------------------------------------------------
   | MAINTENANCE
   |--------------------------------------------------------------------------
   */

  clearReplayCache() {
    this.replayCache.clear();

    return {
      success: true,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new AirtelWebhookService();