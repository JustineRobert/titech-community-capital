// backend/services/emailProviders/consoleProvider.js

"use strict";

/**
 * ============================================================================
 * CONSOLE EMAIL PROVIDER
 * ============================================================================
 *
 * Production-Grade Development Email Provider
 *
 * Responsibilities
 *  - Development Email Logging
 *  - Structured Email Inspection
 *  - HTML/Text Preview
 *  - Attachment Logging
 *  - Correlation IDs
 *  - Message Persistence Hooks
 *  - Metrics Collection
 *  - Rate Limiting
 *  - PII Masking
 *  - Health Monitoring
 *  - Testing & CI Support
 *  - Email Event Emission
 *
 * This provider NEVER sends emails externally.
 * It is intended for:
 *
 *  ✔ Local development
 *  ✔ Integration testing
 *  ✔ Staging environments
 *  ✔ CI pipelines
 *  ✔ QA environments
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

class ConsoleEmailProvider extends EventEmitter {
  constructor() {
    super();

    this.provider = "console";

    this.environment =
      process.env.NODE_ENV || "development";

    this.showBody =
      process.env.CONSOLE_EMAIL_SHOW_BODY !==
      "false";

    this.showHtml =
      process.env.CONSOLE_EMAIL_SHOW_HTML ===
      "true";

    this.maskEmails =
      process.env.CONSOLE_EMAIL_MASK !==
      "false";

    this.maxBodyLength =
      Number(
        process.env.CONSOLE_EMAIL_MAX_BODY_LENGTH
      ) || 10000;

    this.metrics = {
      emailsLogged: 0,
      failures: 0,
      attachmentsLogged: 0,
      lastSentAt: null,
    };

    this.rateLimit = {
      count: 0,
      windowStartedAt: Date.now(),
      limit:
        Number(
          process.env.CONSOLE_EMAIL_RATE_LIMIT
        ) || 1000,
      windowMs:
        Number(
          process.env.CONSOLE_EMAIL_WINDOW_MS
        ) || 60000,
    };
  }

  /*
   * ==========================================================================
   * UTILITIES
   * ==========================================================================
   */

  generateMessageId() {
    return `console-${crypto.randomUUID()}`;
  }

  generateCorrelationId() {
    return crypto.randomUUID();
  }

  maskEmail(email) {
    if (!email || !this.maskEmails) {
      return email;
    }

    const [user, domain] =
      String(email).split("@");

    if (!domain) {
      return email;
    }

    if (user.length <= 2) {
      return `**@${domain}`;
    }

    return `${user.slice(
      0,
      2
    )}${"*".repeat(
      Math.max(2, user.length - 2)
    )}@${domain}`;
  }

  truncate(content) {
    if (!content) {
      return content;
    }

    if (
      content.length <=
      this.maxBodyLength
    ) {
      return content;
    }

    return (
      content.substring(
        0,
        this.maxBodyLength
      ) + "\n\n...[TRUNCATED]"
    );
  }

  resetRateLimitWindow() {
    const now = Date.now();

    if (
      now -
        this.rateLimit.windowStartedAt >
      this.rateLimit.windowMs
    ) {
      this.rateLimit.count = 0;
      this.rateLimit.windowStartedAt =
        now;
    }
  }

  checkRateLimit() {
    this.resetRateLimitWindow();

    this.rateLimit.count++;

    return (
      this.rateLimit.count <=
      this.rateLimit.limit
    );
  }

  /*
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  validatePayload(payload = {}) {
    if (!payload.to) {
      throw new Error(
        "Recipient is required."
      );
    }

    if (!payload.from) {
      throw new Error(
        "Sender email is required."
      );
    }

    if (!payload.subject) {
      throw new Error(
        "Subject is required."
      );
    }
  }

  /*
   * ==========================================================================
   * LOG EMAIL
   * ==========================================================================
   */

  async logEmail(payload) {
    const {
      to,
      from,
      fromName,
      subject,
      html,
      text,
      attachments = [],
      metadata = {},
    } = payload;

    const correlationId =
      this.generateCorrelationId();

    const emailLog = {
      provider: this.provider,
      correlationId,
      to: Array.isArray(to)
        ? to.map((v) =>
            this.maskEmail(v)
          )
        : this.maskEmail(to),
      from: `${fromName || ""} <${this.maskEmail(
        from
      )}>`,
      subject,
      attachments:
        attachments.length,
      metadata,
      timestamp:
        new Date().toISOString(),
    };

    logger.info(
      "[ConsoleEmailProvider] Email Logged",
      emailLog
    );

    if (
      this.environment ===
        "development" &&
      this.showBody
    ) {
      console.log(
        "\n================================================"
      );
      console.log(
        "📧 CONSOLE EMAIL PROVIDER"
      );
      console.log(
        "================================================"
      );
      console.log(
        `To: ${emailLog.to}`
      );
      console.log(
        `From: ${emailLog.from}`
      );
      console.log(
        `Subject: ${subject}`
      );
      console.log(
        `CorrelationId: ${correlationId}`
      );

      if (text) {
        console.log(
          "\n--------------- TEXT ----------------\n"
        );

        console.log(
          this.truncate(text)
        );
      }

      if (
        html &&
        this.showHtml
      ) {
        console.log(
          "\n--------------- HTML ----------------\n"
        );

        console.log(
          this.truncate(html)
        );
      }

      if (attachments.length) {
        console.log(
          "\n----------- ATTACHMENTS ------------"
        );

        attachments.forEach(
          (attachment, index) => {
            console.log(
              `${index + 1}. ${
                attachment.filename ||
                "Unnamed attachment"
              }`
            );
          }
        );
      }

      console.log(
        "\n================================================\n"
      );
    }

    return correlationId;
  }

  /*
   * ==========================================================================
   * SEND
   * ==========================================================================
   */

  async send(payload = {}) {
    try {
      this.validatePayload(payload);

      if (!this.checkRateLimit()) {
        throw new Error(
          "Console email rate limit exceeded."
        );
      }

      const messageId =
        this.generateMessageId();

      const correlationId =
        await this.logEmail(
          payload
        );

      this.metrics.emailsLogged++;

      this.metrics.lastSentAt =
        new Date().toISOString();

      if (
        payload.attachments?.length
      ) {
        this.metrics.attachmentsLogged +=
          payload.attachments.length;
      }

      const result = {
        success: true,
        provider: this.provider,
        messageId,
        correlationId,
        status: "logged",
        timestamp:
          new Date().toISOString(),
      };

      this.emit(
        "email.logged",
        result
      );

      return result;
    } catch (error) {
      this.metrics.failures++;

      logger.error(
        "[ConsoleEmailProvider] Failed",
        error
      );

      this.emit(
        "email.failed",
        error
      );

      throw error;
    }
  }

  /*
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  healthCheck() {
    return {
      provider: this.provider,
      healthy: true,
      environment:
        this.environment,
      rateLimit: {
        count:
          this.rateLimit.count,
        limit:
          this.rateLimit.limit,
      },
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
      provider: this.provider,
      ...this.metrics,
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
      emailsLogged: 0,
      failures: 0,
      attachmentsLogged: 0,
      lastSentAt: null,
    };
  }
}

module.exports =
  new ConsoleEmailProvider();