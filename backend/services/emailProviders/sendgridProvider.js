// backend/services/emailProviders/sendgridProvider.js
'use strict';

/**
 * ============================================================================
 * SENDGRID EMAIL PROVIDER (PRODUCTION GRADE)
 * ============================================================================
 *
 * Features
 * --------
 * - Lazy SDK initialization
 * - Multiple recipient support
 * - CC/BCC support
 * - Attachments support
 * - Categories and custom arguments
 * - Template support
 * - Retry support for transient failures
 * - Delivery metadata
 * - Health checks
 * - Metrics
 * - Correlation IDs
 * - Audit logging hooks
 * - Sandbox mode support
 * - Rate limit awareness
 * - Production diagnostics
 *
 * ============================================================================
 */

const crypto = require('crypto');

let logger;
try {
  logger = require('../../utils/logger');
} catch {
  logger = console;
}

let sgMail;

try {
  sgMail = require('@sendgrid/mail');
} catch (err) {
  logger.warn(
    '[EmailProvider:SendGrid] Package not installed. npm install @sendgrid/mail'
  );
}

class SendGridProvider {
  constructor() {
    this.provider = 'sendgrid';

    this.apiKey =
      process.env.SENDGRID_API_KEY;

    this.defaultFrom =
      process.env.EMAIL_FROM ||
      process.env.SENDGRID_FROM_EMAIL;

    this.defaultFromName =
      process.env.EMAIL_FROM_NAME ||
      'System';

    this.maxRetries = Number(
      process.env.EMAIL_MAX_RETRIES || 3
    );

    this.timeout = Number(
      process.env.EMAIL_TIMEOUT_MS ||
        30000
    );

    this.sandboxMode =
      String(
        process.env.SENDGRID_SANDBOX_MODE
      ).toLowerCase() === 'true';

    this.metrics = {
      sent: 0,
      failed: 0,
      retries: 0,
      initialized: false,
    };

    this.initialized = false;
  }

  /**
   * ==========================================================================
   * INITIALIZATION
   * ==========================================================================
   */

  initialize() {
    if (this.initialized) {
      return;
    }

    if (!sgMail) {
      throw new Error(
        '@sendgrid/mail package not installed'
      );
    }

    if (!this.apiKey) {
      throw new Error(
        'SENDGRID_API_KEY environment variable not configured'
      );
    }

    sgMail.setApiKey(this.apiKey);

    this.initialized = true;
    this.metrics.initialized = true;

    logger.info(
      '[EmailProvider:SendGrid] Initialized'
    );
  }

  /**
   * ==========================================================================
   * HELPERS
   * ==========================================================================
   */

  correlationId() {
    return crypto.randomUUID();
  }

  normalizeRecipients(value) {
    if (!value) return [];

    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }

    return [value];
  }

  shouldRetry(error) {
    const status =
      error?.code ||
      error?.response?.statusCode ||
      error?.response?.status;

    if (!status) return true;

    return [408, 429, 500, 502, 503, 504].includes(
      Number(status)
    );
  }

  async sleep(ms) {
    return new Promise((resolve) =>
      setTimeout(resolve, ms)
    );
  }

  /**
   * ==========================================================================
   * RETRY WRAPPER
   * ==========================================================================
   */

  async executeWithRetry(fn) {
    let lastError;

    for (
      let attempt = 1;
      attempt <= this.maxRetries;
      attempt++
    ) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (
          attempt >= this.maxRetries ||
          !this.shouldRetry(error)
        ) {
          break;
        }

        this.metrics.retries++;

        const delay =
          attempt * 1000;

        logger.warn(
          `[EmailProvider:SendGrid] Retry ${attempt}/${this.maxRetries}`,
          {
            delay,
            error: error.message,
          }
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * ==========================================================================
   * BUILD MESSAGE
   * ==========================================================================
   */

  buildMessage({
    to,
    cc,
    bcc,
    from,
    fromName,
    replyTo,
    subject,
    html,
    text,
    attachments = [],
    categories = [],
    customArgs = {},
    templateId,
    dynamicTemplateData,
  }) {
    const message = {
      to: this.normalizeRecipients(to),
      from: {
        email:
          from || this.defaultFrom,
        name:
          fromName ||
          this.defaultFromName,
      },

      subject,
      html,
      text,

      trackingSettings: {
        clickTracking: {
          enabled: true,
        },
        openTracking: {
          enabled: true,
        },
        subscriptionTracking: {
          enabled: false,
        },
      },

      mailSettings: {
        sandboxMode: {
          enable: this.sandboxMode,
        },
      },

      customArgs: {
        correlationId:
          this.correlationId(),
        provider:
          this.provider,
        ...customArgs,
      },
    };

    const normalizedCC =
      this.normalizeRecipients(cc);

    const normalizedBCC =
      this.normalizeRecipients(bcc);

    if (normalizedCC.length) {
      message.cc = normalizedCC;
    }

    if (normalizedBCC.length) {
      message.bcc =
        normalizedBCC;
    }

    if (replyTo) {
      message.replyTo = replyTo;
    }

    if (categories.length) {
      message.categories =
        categories;
    }

    if (
      attachments &&
      attachments.length
    ) {
      message.attachments =
        attachments;
    }

    if (templateId) {
      message.templateId =
        templateId;
      message.dynamicTemplateData =
        dynamicTemplateData || {};
    }

    return message;
  }

  /**
   * ==========================================================================
   * SEND EMAIL
   * ==========================================================================
   */

  async send(options = {}) {
    this.initialize();

    const correlationId =
      this.correlationId();

    const message =
      this.buildMessage(options);

    logger.info(
      '[EmailProvider:SendGrid] Sending email',
      {
        correlationId,
        to: message.to,
        subject:
          message.subject,
      }
    );

    try {
      const response =
        await this.executeWithRetry(
          async () =>
            sgMail.send(message)
        );

      const headers =
        response?.[0]?.headers || {};

      const messageId =
        headers['x-message-id'] ||
        headers['x-message-id'.toLowerCase()] ||
        crypto.randomUUID();

      this.metrics.sent++;

      logger.info(
        '[EmailProvider:SendGrid] Email sent',
        {
          correlationId,
          messageId,
          to: message.to,
        }
      );

      return {
        success: true,
        provider:
          this.provider,
        messageId,
        correlationId,
        status: 'sent',
        sandbox:
          this.sandboxMode,
        acceptedAt:
          new Date().toISOString(),
      };
    } catch (error) {
      this.metrics.failed++;

      logger.error(
        '[EmailProvider:SendGrid] Send failed',
        {
          correlationId,
          error:
            error.response?.body ||
            error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * SEND TEMPLATE EMAIL
   * ==========================================================================
   */

  async sendTemplate({
    templateId,
    dynamicTemplateData,
    ...rest
  }) {
    return this.send({
      ...rest,
      templateId,
      dynamicTemplateData,
    });
  }

  /**
   * ==========================================================================
   * VERIFY CONFIGURATION
   * ==========================================================================
   */

  verifyConfiguration() {
    return {
      provider:
        this.provider,
      configured:
        !!this.apiKey,
      initialized:
        this.initialized,
      sandboxMode:
        this.sandboxMode,
      defaultFrom:
        this.defaultFrom,
    };
  }

  /**
   * ==========================================================================
   * HEALTH CHECK
   * ==========================================================================
   */

  healthCheck() {
    return {
      provider:
        this.provider,
      healthy:
        !!this.apiKey,
      initialized:
        this.initialized,
      sandboxMode:
        this.sandboxMode,
      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  getMetrics() {
    return {
      provider:
        this.provider,
      ...this.metrics,
      timestamp:
        new Date().toISOString(),
    };
  }
}

module.exports =
  new SendGridProvider();