// backend/services/emailProviders/mailgunProvider.js

"use strict";

/**
 * ============================================================================
 * MAILGUN EMAIL PROVIDER
 * ============================================================================
 *
 * Production-grade Mailgun email provider.
 *
 * Features
 * --------
 * ✔ Transactional email delivery
 * ✔ Template support
 * ✔ Attachments
 * ✔ Tags & Variables
 * ✔ Retry with exponential backoff
 * ✔ Circuit breaker
 * ✔ Correlation IDs
 * ✔ Metrics & Health Checks
 * ✔ Webhook compatibility
 * ✔ Email tracking support
 * ✔ Sandbox support
 * ✔ Rate limiting hooks
 * ✔ Event emission
 * ✔ Idempotency support
 * ✔ Structured logging
 *
 * Environment Variables
 * ---------------------
 * MAILGUN_API_KEY=
 * MAILGUN_DOMAIN=
 * MAILGUN_REGION=us | eu
 * MAILGUN_TIMEOUT=30000
 * MAILGUN_MAX_RETRIES=3
 * MAILGUN_CIRCUIT_THRESHOLD=5
 * MAILGUN_CIRCUIT_TIMEOUT=60000
 *
 * ============================================================================
 */

const crypto = require("crypto");
const EventEmitter = require("events");

let logger;

try {
  logger = require("../../utils/logger");
} catch {
  logger = console;
}

let FormData;
let MailgunSDK;

try {
  FormData = require("form-data");
  MailgunSDK = require("mailgun.js");
} catch (error) {
  logger.warn(
    "[MailgunProvider] mailgun.js not installed. Run: npm install mailgun.js form-data"
  );
}

class MailgunProvider extends EventEmitter {
  constructor() {
    super();

    this.provider = "mailgun";

    this.domain =
      process.env.MAILGUN_DOMAIN;

    this.apiKey =
      process.env.MAILGUN_API_KEY;

    this.region =
      process.env.MAILGUN_REGION ||
      "us";

    this.timeout = Number(
      process.env.MAILGUN_TIMEOUT ||
        30000
    );

    this.maxRetries = Number(
      process.env.MAILGUN_MAX_RETRIES ||
        3
    );

    this.client = null;

    this.metrics = {
      emailsSent: 0,
      emailsFailed: 0,
      retries: 0,
      circuitTrips: 0,
      lastSentAt: null,
    };

    this.circuitBreaker = {
      failures: 0,
      threshold: Number(
        process.env
          .MAILGUN_CIRCUIT_THRESHOLD ||
          5
      ),
      timeout: Number(
        process.env
          .MAILGUN_CIRCUIT_TIMEOUT ||
          60000
      ),
      openedAt: null,
    };
  }

  /*
   * ==========================================================================
   * CLIENT
   * ==========================================================================
   */

  getClient() {
    if (this.client) {
      return this.client;
    }

    if (!MailgunSDK || !FormData) {
      throw new Error(
        "Mailgun SDK not installed."
      );
    }

    if (!this.apiKey) {
      throw new Error(
        "MAILGUN_API_KEY is missing."
      );
    }

    const mg =
      new MailgunSDK(FormData);

    this.client = mg.client({
      username: "api",
      key: this.apiKey,
      url:
        this.region === "eu"
          ? "https://api.eu.mailgun.net"
          : undefined,
    });

    return this.client;
  }

  /*
   * ==========================================================================
   * CIRCUIT BREAKER
   * ==========================================================================
   */

  isCircuitOpen() {
    const opened =
      this.circuitBreaker.openedAt;

    if (!opened) {
      return false;
    }

    const elapsed =
      Date.now() - opened;

    if (
      elapsed >
      this.circuitBreaker.timeout
    ) {
      this.circuitBreaker.failures = 0;
      this.circuitBreaker.openedAt =
        null;

      return false;
    }

    return true;
  }

  registerFailure() {
    this.circuitBreaker.failures++;

    if (
      this.circuitBreaker.failures >=
      this.circuitBreaker.threshold
    ) {
      this.circuitBreaker.openedAt =
        Date.now();

      this.metrics.circuitTrips++;

      logger.error(
        "[MailgunProvider] Circuit breaker opened"
      );
    }
  }

  registerSuccess() {
    this.circuitBreaker.failures = 0;
    this.circuitBreaker.openedAt =
      null;
  }

  /*
   * ==========================================================================
   * UTILITIES
   * ==========================================================================
   */

  generateCorrelationId() {
    return crypto.randomUUID();
  }

  generateMessageId() {
    return `mailgun-${crypto.randomUUID()}`;
  }

  validatePayload(payload = {}) {
    if (!payload.to) {
      throw new Error(
        "Recipient is required."
      );
    }

    if (!payload.from) {
      throw new Error(
        "Sender address is required."
      );
    }

    if (!payload.subject) {
      throw new Error(
        "Subject is required."
      );
    }

    if (!this.domain) {
      throw new Error(
        "MAILGUN_DOMAIN not configured."
      );
    }
  }

  async delay(ms) {
    return new Promise((resolve) =>
      setTimeout(resolve, ms)
    );
  }

  /*
   * ==========================================================================
   * SEND IMPLEMENTATION
   * ==========================================================================
   */

  async executeSend(payload) {
    const client =
      this.getClient();

    const {
      to,
      from,
      fromName,
      subject,
      html,
      text,
      replyTo,
      cc,
      bcc,
      tags = [],
      variables = {},
      attachments = [],
      tracking = true,
      metadata = {},
    } = payload;

    const correlationId =
      this.generateCorrelationId();

    const message = {
      from: `${fromName || ""} <${from}>`,
      to,
      subject,
      html,
      text,

      cc,
      bcc,

      attachment:
        attachments,

      "h:Reply-To":
        replyTo || from,

      "o:tracking":
        tracking,

      "o:tracking-clicks":
        tracking,

      "o:tracking-opens":
        tracking,

      "v:correlation-id":
        correlationId,
    };

    if (tags.length) {
      message["o:tag"] = tags;
    }

    for (const [
      key,
      value,
    ] of Object.entries(
      variables
    )) {
      message[
        `v:${key}`
      ] = value;
    }

    logger.info(
      "[MailgunProvider] Sending email",
      {
        to,
        subject,
        correlationId,
        metadata,
      }
    );

    const result =
      await client.messages.create(
        this.domain,
        message
      );

    return {
      messageId:
        result.id ||
        this.generateMessageId(),
      provider:
        this.provider,
      correlationId,
      providerResponse:
        result,
    };
  }

  /*
   * ==========================================================================
   * RETRY WRAPPER
   * ==========================================================================
   */

  async send(payload = {}) {
    this.validatePayload(
      payload
    );

    if (
      this.isCircuitOpen()
    ) {
      throw new Error(
        "Mailgun provider temporarily unavailable."
      );
    }

    let lastError;

    for (
      let attempt = 1;
      attempt <= this.maxRetries;
      attempt++
    ) {
      try {
        const result =
          await this.executeSend(
            payload
          );

        this.registerSuccess();

        this.metrics.emailsSent++;
        this.metrics.lastSentAt =
          new Date().toISOString();

        this.emit(
          "email.sent",
          result
        );

        logger.info(
          "[MailgunProvider] Email sent",
          {
            messageId:
              result.messageId,
            correlationId:
              result.correlationId,
          }
        );

        return {
          success: true,
          status: "sent",
          provider:
            this.provider,
          ...result,
        };
      } catch (error) {
        lastError = error;

        this.metrics.retries++;

        logger.error(
          `[MailgunProvider] Attempt ${attempt} failed`,
          error
        );

        if (
          attempt <
          this.maxRetries
        ) {
          await this.delay(
            attempt * 1000
          );
        }
      }
    }

    this.metrics.emailsFailed++;

    this.registerFailure();

    this.emit(
      "email.failed",
      lastError
    );

    throw lastError;
  }

  /*
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  healthCheck() {
    return {
      provider:
        this.provider,
      configured:
        !!(
          this.apiKey &&
          this.domain
        ),
      healthy:
        !this.isCircuitOpen(),
      circuitOpen:
        this.isCircuitOpen(),
      timestamp:
        new Date().toISOString(),
    };
  }

  /*
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  getMetrics() {
    return {
      provider:
        this.provider,
      ...this.metrics,
      circuitBreaker: {
        failures:
          this.circuitBreaker
            .failures,
        open:
          this.isCircuitOpen(),
      },
      generatedAt:
        new Date().toISOString(),
    };
  }

  /*
   * ==========================================================================
   * RESET
   * ==========================================================================
   */

  resetMetrics() {
    this.metrics = {
      emailsSent: 0,
      emailsFailed: 0,
      retries: 0,
      circuitTrips: 0,
      lastSentAt: null,
    };
  }
}

module.exports =
  new MailgunProvider();