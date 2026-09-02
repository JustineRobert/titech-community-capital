// backend/services/emailProviders/smtpProvider.js
'use strict';

/**
 * ============================================================================
 * SMTP EMAIL PROVIDER (PRODUCTION GRADE)
 * ============================================================================
 *
 * Features
 * --------
 * - Generic SMTP support
 * - Gmail, Office365, SendinBlue, Mailtrap, Custom SMTP
 * - Connection pooling
 * - TLS support
 * - Retry with exponential backoff
 * - Multiple recipients
 * - CC / BCC support
 * - Attachments support
 * - Correlation IDs
 * - Metrics & health monitoring
 * - Runtime configuration validation
 * - SMTP verification
 * - Graceful reconnection
 * - Production diagnostics
 *
 * Environment Variables
 * ---------------------
 * SMTP_HOST
 * SMTP_PORT
 * SMTP_SECURE
 * SMTP_USER
 * SMTP_PASSWORD
 * SMTP_TLS_REJECT_UNAUTHORIZED
 * SMTP_POOL
 * SMTP_MAX_CONNECTIONS
 * SMTP_MAX_MESSAGES
 * EMAIL_FROM
 * EMAIL_FROM_NAME
 * EMAIL_MAX_RETRIES
 * EMAIL_TIMEOUT_MS
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

let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  logger.warn(
    '[EmailProvider:SMTP] nodemailer not installed. npm install nodemailer'
  );
}

class SMTPProvider {
  constructor() {
    this.provider = 'smtp';

    this.host =
      process.env.SMTP_HOST;

    this.port = Number(
      process.env.SMTP_PORT || 587
    );

    this.secure =
      String(
        process.env.SMTP_SECURE
      ).toLowerCase() === 'true';

    this.user =
      process.env.SMTP_USER;

    this.password =
      process.env.SMTP_PASSWORD;

    this.pool =
      String(
        process.env.SMTP_POOL || 'true'
      ).toLowerCase() === 'true';

    this.maxConnections = Number(
      process.env
        .SMTP_MAX_CONNECTIONS || 5
    );

    this.maxMessages = Number(
      process.env
        .SMTP_MAX_MESSAGES || 100
    );

    this.timeout = Number(
      process.env.EMAIL_TIMEOUT_MS ||
        30000
    );

    this.maxRetries = Number(
      process.env.EMAIL_MAX_RETRIES ||
        3
    );

    this.defaultFrom =
      process.env.EMAIL_FROM;

    this.defaultFromName =
      process.env.EMAIL_FROM_NAME ||
      'System';

    this.transporter = null;
    this.initialized = false;

    this.metrics = {
      sent: 0,
      failed: 0,
      retries: 0,
      verificationFailures: 0,
      reconnects: 0,
      initialized: false,
    };
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

    if (!nodemailer) {
      throw new Error(
        'nodemailer package not installed'
      );
    }

    if (
      !this.host ||
      !this.user ||
      !this.password
    ) {
      throw new Error(
        'SMTP configuration incomplete. Configure SMTP_HOST, SMTP_USER and SMTP_PASSWORD.'
      );
    }

    this.transporter =
      nodemailer.createTransport({
        host: this.host,
        port: this.port,
        secure: this.secure,
        pool: this.pool,
        maxConnections:
          this.maxConnections,
        maxMessages:
          this.maxMessages,

        auth: {
          user: this.user,
          pass: this.password,
        },

        connectionTimeout:
          this.timeout,

        greetingTimeout:
          this.timeout,

        socketTimeout:
          this.timeout,

        tls: {
          rejectUnauthorized:
            String(
              process.env
                .SMTP_TLS_REJECT_UNAUTHORIZED ||
                'true'
            ).toLowerCase() ===
            'true',
        },
      });

    this.initialized = true;
    this.metrics.initialized =
      true;

    logger.info(
      '[EmailProvider:SMTP] Initialized',
      {
        host: this.host,
        port: this.port,
        secure: this.secure,
        pool: this.pool,
      }
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
    if (!value) {
      return [];
    }

    if (Array.isArray(value)) {
      return value.filter(Boolean);
    }

    return [value];
  }

  sleep(ms) {
    return new Promise((resolve) =>
      setTimeout(resolve, ms)
    );
  }

  shouldRetry(error) {
    const code =
      error?.code || '';

    const retryable = [
      'ETIMEDOUT',
      'ECONNECTION',
      'ECONNRESET',
      'ESOCKET',
      'EPIPE',
      'EAUTH',
    ];

    return retryable.includes(
      String(code)
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
          attempt >=
            this.maxRetries ||
          !this.shouldRetry(error)
        ) {
          break;
        }

        this.metrics.retries++;

        const delay =
          Math.pow(2, attempt) *
          1000;

        logger.warn(
          '[EmailProvider:SMTP] Retry',
          {
            attempt,
            delay,
            error:
              error.message,
          }
        );

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * ==========================================================================
   * SMTP VERIFICATION
   * ==========================================================================
   */

  async verifyConnection() {
    this.initialize();

    try {
      await this.transporter.verify();

      return {
        healthy: true,
        provider:
          this.provider,
        timestamp:
          new Date().toISOString(),
      };
    } catch (error) {
      this.metrics
        .verificationFailures++;

      logger.error(
        '[EmailProvider:SMTP] Verification failed',
        error
      );

      return {
        healthy: false,
        provider:
          this.provider,
        error:
          error.message,
        timestamp:
          new Date().toISOString(),
      };
    }
  }

  /**
   * ==========================================================================
   * SEND EMAIL
   * ==========================================================================
   */

  async send({
    to,
    cc,
    bcc,
    from,
    fromName,
    subject,
    html,
    text,
    attachments = [],
    headers = {},
    replyTo,
  }) {
    this.initialize();

    const correlationId =
      this.correlationId();

    const message = {
      from: `${
        fromName ||
        this.defaultFromName
      } <${
        from ||
        this.defaultFrom
      }>`,
      to:
        this.normalizeRecipients(
          to
        ),
      cc:
        this.normalizeRecipients(
          cc
        ),
      bcc:
        this.normalizeRecipients(
          bcc
        ),
      subject,
      html,
      text,
      attachments,
      headers: {
        'X-Correlation-ID':
          correlationId,
        'X-Mailer':
          'CommunitySavingsSMTP',
        ...headers,
      },
    };

    if (replyTo) {
      message.replyTo = replyTo;
    }

    logger.info(
      '[EmailProvider:SMTP] Sending email',
      {
        correlationId,
        to: message.to,
        subject,
      }
    );

    try {
      const result =
        await this.executeWithRetry(
          async () =>
            this.transporter.sendMail(
              message
            )
        );

      this.metrics.sent++;

      logger.info(
        '[EmailProvider:SMTP] Email sent',
        {
          correlationId,
          messageId:
            result.messageId,
          accepted:
            result.accepted,
          rejected:
            result.rejected,
        }
      );

      return {
        success: true,
        provider:
          this.provider,
        messageId:
          result.messageId,
        correlationId,
        accepted:
          result.accepted,
        rejected:
          result.rejected,
        envelope:
          result.envelope,
        response:
          result.response,
        status: 'sent',
        sentAt:
          new Date().toISOString(),
      };
    } catch (error) {
      this.metrics.failed++;

      logger.error(
        '[EmailProvider:SMTP] Send failed',
        {
          correlationId,
          error:
            error.message,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * RECONNECT
   * ==========================================================================
   */

  reconnect() {
    this.transporter = null;
    this.initialized = false;
    this.metrics.reconnects++;

    this.initialize();

    return {
      success: true,
      provider:
        this.provider,
      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * CONFIG VALIDATION
   * ==========================================================================
   */

  verifyConfiguration() {
    return {
      provider:
        this.provider,
      configured:
        !!(
          this.host &&
          this.user &&
          this.password
        ),
      initialized:
        this.initialized,
      host: this.host,
      port: this.port,
      secure:
        this.secure,
      pool:
        this.pool,
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
      service: 'EMAIL',
      initialized:
        this.initialized,
      host: this.host,
      port: this.port,
      healthy:
        !!this.transporter,
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
  new SMTPProvider();