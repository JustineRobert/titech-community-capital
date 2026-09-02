'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Notification Service
 * ============================================================================
 *
 * File:
 *   backend/modules/notificationService.js
 *
 * Purpose:
 *   Production-grade notification orchestration layer.
 *
 * Responsibilities:
 *
 *   - Notification creation
 *   - Idempotency
 *   - Tenant isolation
 *   - Template rendering
 *   - Localization
 *   - Email delivery
 *   - SMS delivery
 *   - Push delivery
 *   - In-app delivery
 *   - Webhook delivery
 *   - Notification preferences
 *   - Queue orchestration
 *   - Retry management
 *   - Exponential backoff
 *   - Dead-letter handling
 *   - Delivery attempt tracking
 *   - Provider correlation
 *   - State-machine enforcement
 *   - Audit logging
 *   - Metrics
 *   - Failure classification
 *   - Graceful provider degradation
 *
 * Architectural Rules:
 *
 *   1. This service does not own financial state.
 *   2. This service does not mutate account balances.
 *   3. Notification delivery is asynchronous by default.
 *   4. Notification creation is idempotent when an idempotency key is supplied.
 *   5. Provider failures never silently become successful deliveries.
 *   6. Retries use exponential backoff with jitter.
 *   7. Permanent failures are dead-lettered.
 *   8. Tenant context is preserved throughout processing.
 *   9. Sensitive notification payloads are never written to audit logs.
 *  10. Provider response IDs are retained for operational correlation.
 *  11. Notification state transitions are validated.
 *  12. Queue availability is never assumed.
 *
 * Existing public API preserved:
 *
 *   send()
 *   sendImmediate()
 *   schedule()
 *   createNotification()
 *   processNotification()
 *   buildMessage()
 *   sendEmail()
 *   sendSMS()
 *   sendPush()
 *   sendWebhook()
 *   sendInApp()
 *   handleFailure()
 *   getPreferences()
 *   updatePreferences()
 *   markAsRead()
 *   sendBulk()
 *   getMetrics()
 *   audit()
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const PROVIDER_CHANNELS = Object.freeze({
  EMAIL: 'email',
  SMS: 'sms',
  PUSH: 'push',
  WEBHOOK: 'webhook',
  IN_APP: 'in_app',
});

const NOTIFICATION_STATUS = Object.freeze({
  PENDING: 'pending',
  PROCESSING: 'processing',
  SENT: 'sent',
  RETRY: 'retry',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
});

const TERMINAL_STATUSES = new Set([
  NOTIFICATION_STATUS.SENT,
  NOTIFICATION_STATUS.FAILED,
  NOTIFICATION_STATUS.CANCELLED,
]);

const RETRYABLE_ERROR_CODES = new Set([
  'ETIMEDOUT',
  'ECONNRESET',
  'ECONNABORTED',
  'EAI_AGAIN',
  'ENOTFOUND',
  'ECONNREFUSED',
  '429',
  '500',
  '502',
  '503',
  '504',
]);

const SENSITIVE_KEYS = new Set([
  'password',
  'secret',
  'token',
  'access_token',
  'refresh_token',
  'apiKey',
  'api_key',
  'authorization',
  'Authorization',
  'otp',
  'pin',
  'cvv',
  'cardNumber',
  'accountNumber',
]);

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class NotificationServiceError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'NotificationServiceError';

    this.code =
      options.code ||
      'NOTIFICATION_SERVICE_ERROR';

    this.statusCode =
      options.statusCode ||
      null;

    this.channel =
      options.channel ||
      null;

    this.notificationId =
      options.notificationId ||
      null;

    this.retryable =
      Boolean(options.retryable);

    this.provider =
      options.provider ||
      null;

    this.providerReference =
      options.providerReference ||
      null;

    this.cause =
      options.cause;

    Error.captureStackTrace?.(
      this,
      NotificationServiceError
    );
  }
}

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class NotificationService extends EventEmitter {
  constructor({
    db,
    logger,
    cache,
    queueService,
    auditService,
    metricsService,

    emailProvider,
    smsProvider,
    pushProvider,
    webhookProvider,

    templateService,
    localizationService,

    config = {},
  }) {
    super();

    this.db = db;
    this.logger = logger || console;
    this.cache = cache || null;
    this.queueService = queueService || null;
    this.auditService = auditService || null;
    this.metricsService = metricsService || null;

    this.emailProvider =
      emailProvider || null;

    this.smsProvider =
      smsProvider || null;

    this.pushProvider =
      pushProvider || null;

    this.webhookProvider =
      webhookProvider || null;

    this.templateService =
      templateService || null;

    this.localizationService =
      localizationService || null;

    this.config = {
      maxRetries: 5,

      retryDelayMs: 30000,

      maxRetryDelayMs:
        15 * 60 * 1000,

      cacheTtl: 300,

      enableAudit: true,

      defaultLanguage: 'en',

      requireQueue:
        false,

      requirePersistence:
        true,

      enforcePreferences:
        true,

      enableIdempotency:
        true,

      idempotencyTtlSeconds:
        24 * 60 * 60,

      processingLeaseMs:
        5 * 60 * 1000,

      maxMessageLength:
        100000,

      enableMetrics:
        true,

      enableProviderCorrelation:
        true,

      ...config,
    };

    /**
     * ------------------------------------------------------------------------
     * Runtime caches
     * ------------------------------------------------------------------------
     */

    this.idempotencyCache =
      new Map();

    this.processingLocks =
      new Map();

    this.metrics = {
      created: 0,
      queued: 0,
      processed: 0,

      sent: 0,
      failed: 0,
      retried: 0,

      deadLettered: 0,

      duplicateRequests: 0,

      providerFailures: 0,

      preferenceBlocked: 0,

      queueFailures: 0,

      validationFailures: 0,

      processingConflicts: 0,

      auditFailures: 0,

      readReceipts: 0,

      byChannel: {},

      startedAt:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * PUBLIC API
   * ==========================================================================
   */

  async send(payload = {}) {
    const notification =
      await this.createNotification(
        payload
      );

    await this.enqueueNotification(
      notification
    );

    return notification;
  }

  async sendImmediate(payload = {}) {
    const notification =
      await this.createNotification(
        payload
      );

    return this.processNotification(
      notification.id
    );
  }

  async schedule(
    payload = {},
    sendAt
  ) {
    if (!(sendAt instanceof Date)) {
      sendAt =
        new Date(sendAt);
    }

    if (
      Number.isNaN(
        sendAt.getTime()
      )
    ) {
      throw new NotificationServiceError(
        'Invalid notification schedule date.',
        {
          code:
            'INVALID_SCHEDULE_DATE',
        }
      );
    }

    if (
      sendAt.getTime() <=
      Date.now()
    ) {
      return this.sendImmediate(
        payload
      );
    }

    const notification =
      await this.createNotification({
        ...payload,
        scheduledAt:
          sendAt,
      });

    await this.enqueueNotification(
      notification,
      {
        delay:
          sendAt.getTime() -
          Date.now(),
        queueName:
          'notification-scheduled',
      }
    );

    return notification;
  }

  /**
   * ==========================================================================
   * NOTIFICATION CREATION
   * ==========================================================================
   */

  async createNotification(
    payload = {}
  ) {
    try {
      this.validatePayload(
        payload
      );

      const channel =
        payload.channel ||
        PROVIDER_CHANNELS.IN_APP;

      const tenantId =
        payload.tenantId ||
        null;

      /**
       * --------------------------------------------------------------
       * Idempotency
       * --------------------------------------------------------------
       */

      const idempotencyKey =
        payload.idempotencyKey ||
        payload.metadata?.idempotencyKey ||
        null;

      if (
        this.config.enableIdempotency &&
        idempotencyKey
      ) {
        const existing =
          await this.findIdempotentNotification(
            {
              tenantId,
              idempotencyKey,
            }
          );

        if (existing) {
          this.metrics
            .duplicateRequests++;

          await this.audit(
            existing,
            'NOTIFICATION_DUPLICATE_REQUEST'
          );

          return existing;
        }
      }

      /**
       * --------------------------------------------------------------
       * Preferences
       * --------------------------------------------------------------
       */

      if (
        this.config.enforcePreferences &&
        payload.userId &&
        channel !==
          PROVIDER_CHANNELS.IN_APP
      ) {
        const allowed =
          await this.isChannelAllowed(
            payload.userId,
            channel
          );

        if (!allowed) {
          this.metrics
            .preferenceBlocked++;

          const blocked =
            this.buildNotification({
              ...payload,
              status:
                NOTIFICATION_STATUS.CANCELLED,
              cancellationReason:
                'CHANNEL_DISABLED_BY_PREFERENCE',
            });

          await this.persistNotification(
            blocked
          );

          await this.audit(
            blocked,
            'NOTIFICATION_BLOCKED_BY_PREFERENCE'
          );

          return blocked;
        }
      }

      const notification =
        this.buildNotification(
          payload
        );

      await this.persistNotification(
        notification
      );

      if (idempotencyKey) {
        this.idempotencyCache.set(
          this.buildIdempotencyCacheKey(
            tenantId,
            idempotencyKey
          ),
          notification
        );

        this.scheduleIdempotencyCleanup(
          tenantId,
          idempotencyKey
        );
      }

      this.metrics.created++;

      this.incrementChannelMetric(
        channel,
        'created'
      );

      await this.audit(
        notification,
        'NOTIFICATION_CREATED'
      );

      this.emit(
        'notification.created',
        notification
      );

      return notification;
    } catch (error) {
      this.metrics
        .validationFailures +=
        error?.code ===
        'INVALID_NOTIFICATION_PAYLOAD'
          ? 1
          : 0;

      throw this.normalizeError(
        error
      );
    }
  }

  /**
   * ==========================================================================
   * BUILD NOTIFICATION
   * ==========================================================================
   */

  buildNotification(
    payload = {}
  ) {
    const now =
      new Date();

    return {
      id:
        payload.id ||
        crypto.randomUUID(),

      tenantId:
        payload.tenantId ||
        null,

      customerId:
        payload.customerId ||
        null,

      userId:
        payload.userId ||
        null,

      channel:
        payload.channel ||
        PROVIDER_CHANNELS.IN_APP,

      type:
        payload.type ||
        'GENERAL',

      template:
        payload.template ||
        null,

      subject:
        payload.subject ||
        null,

      message:
        payload.message ||
        null,

      metadata:
        payload.metadata || {},

      recipient:
        payload.recipient || {},

      status:
        payload.status ||
        NOTIFICATION_STATUS.PENDING,

      retries:
        Number(
          payload.retries || 0
        ),

      attemptCount:
        Number(
          payload.attemptCount || 0
        ),

      language:
        payload.language ||
        this.config.defaultLanguage,

      scheduledAt:
        payload.scheduledAt ||
        null,

      idempotencyKey:
        payload.idempotencyKey ||
        payload.metadata?.idempotencyKey ||
        null,

      provider:
        payload.provider ||
        null,

      providerReference:
        payload.providerReference ||
        null,

      lastError:
        payload.lastError ||
        null,

      lastErrorCode:
        payload.lastErrorCode ||
        null,

      processingStartedAt:
        null,

      sentAt:
        payload.sentAt ||
        null,

      failedAt:
        payload.failedAt ||
        null,

      read:
        Boolean(payload.read),

      readAt:
        payload.readAt ||
        null,

      createdAt:
        payload.createdAt ||
        now,

      updatedAt:
        now,
    };
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  validatePayload(
    payload = {}
  ) {
    const errors = [];

    if (
      !payload.channel
    ) {
      /**
       * In-app remains the backwards-compatible default.
       */
    }

    const channel =
      payload.channel ||
      PROVIDER_CHANNELS.IN_APP;

    if (
      !Object.values(
        PROVIDER_CHANNELS
      ).includes(channel)
    ) {
      errors.push(
        `Unsupported notification channel: ${channel}`
      );
    }

    if (
      payload.message !==
        undefined &&
      payload.message !==
        null &&
      typeof payload.message !==
        'string'
    ) {
      errors.push(
        'message must be a string'
      );
    }

    if (
      typeof payload.message ===
        'string' &&
      payload.message.length >
        this.config.maxMessageLength
    ) {
      errors.push(
        'message exceeds maximum length'
      );
    }

    if (
      payload.template &&
      typeof payload.template !==
        'string'
    ) {
      errors.push(
        'template must be a string'
      );
    }

    if (
      !payload.message &&
      !payload.template
    ) {
      errors.push(
        'message or template is required'
      );
    }

    if (
      channel ===
        PROVIDER_CHANNELS.EMAIL &&
      !payload.recipient?.email
    ) {
      errors.push(
        'recipient.email is required for email notifications'
      );
    }

    if (
      channel ===
        PROVIDER_CHANNELS.SMS &&
      !payload.recipient?.phone
    ) {
      errors.push(
        'recipient.phone is required for SMS notifications'
      );
    }

    if (
      channel ===
        PROVIDER_CHANNELS.PUSH &&
      !payload.recipient?.deviceToken
    ) {
      errors.push(
        'recipient.deviceToken is required for push notifications'
      );
    }

    if (
      channel ===
        PROVIDER_CHANNELS.WEBHOOK &&
      !payload.recipient?.url
    ) {
      errors.push(
        'recipient.url is required for webhook notifications'
      );
    }

    if (errors.length) {
      throw new NotificationServiceError(
        errors.join('; '),
        {
          code:
            'INVALID_NOTIFICATION_PAYLOAD',
        }
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * PERSISTENCE
   * ==========================================================================
   */

  async persistNotification(
    notification
  ) {
    if (
      !this.db?.notifications
    ) {
      if (
        this.config.requirePersistence
      ) {
        throw new NotificationServiceError(
          'Notification persistence is unavailable.',
          {
            code:
              'NOTIFICATION_PERSISTENCE_UNAVAILABLE',
          }
        );
      }

      return notification;
    }

    if (
      typeof this.db.notifications.create ===
      'function'
    ) {
      await this.db.notifications.create(
        notification
      );

      return notification;
    }

    throw new NotificationServiceError(
      'Notification persistence adapter does not expose create().',
      {
        code:
          'NOTIFICATION_PERSISTENCE_METHOD_UNAVAILABLE',
      }
    );
  }

  async updateNotification(
    notification
  ) {
    notification.updatedAt =
      new Date();

    if (
      !this.db?.notifications?.update
    ) {
      if (
        this.config.requirePersistence
      ) {
        throw new NotificationServiceError(
          'Notification update persistence is unavailable.',
          {
            code:
              'NOTIFICATION_UPDATE_UNAVAILABLE',
          }
        );
      }

      return notification;
    }

    await this.db.notifications.update(
      notification.id,
      notification
    );

    return notification;
  }

  /**
   * ==========================================================================
   * IDEMPOTENCY
   * ==========================================================================
   */

  buildIdempotencyCacheKey(
    tenantId,
    idempotencyKey
  ) {
    return [
      'notification',
      tenantId || 'global',
      idempotencyKey,
    ].join(':');
  }

  async findIdempotentNotification({
    tenantId,
    idempotencyKey,
  }) {
    const cacheKey =
      this.buildIdempotencyCacheKey(
        tenantId,
        idempotencyKey
      );

    const cached =
      this.idempotencyCache.get(
        cacheKey
      );

    if (cached) {
      return cached;
    }

    if (
      !this.db?.notifications?.findOne
    ) {
      return null;
    }

    try {
      const existing =
        await this.db.notifications.findOne({
          tenantId,
          idempotencyKey,
        });

      if (existing) {
        this.idempotencyCache.set(
          cacheKey,
          existing
        );

        this.scheduleIdempotencyCleanup(
          tenantId,
          idempotencyKey
        );
      }

      return existing || null;
    } catch (error) {
      this.logger.warn?.(
        'Notification idempotency lookup failed',
        {
          error:
            error.message,
        }
      );

      return null;
    }
  }

  scheduleIdempotencyCleanup(
    tenantId,
    idempotencyKey
  ) {
    const key =
      this.buildIdempotencyCacheKey(
        tenantId,
        idempotencyKey
      );

    const ttl =
      Number(
        this.config
          .idempotencyTtlSeconds
      ) * 1000;

    const timer =
      setTimeout(
        () => {
          this.idempotencyCache.delete(
            key
          );
        },
        ttl
      );

    timer.unref?.();
  }

  /**
   * ==========================================================================
   * QUEUE
   * ==========================================================================
   */

  async enqueueNotification(
    notification,
    options = {}
  ) {
    if (
      !this.queueService?.enqueue
    ) {
      this.metrics
        .queueFailures++;

      if (
        this.config.requireQueue
      ) {
        throw new NotificationServiceError(
          'Notification queue service unavailable.',
          {
            code:
              'NOTIFICATION_QUEUE_UNAVAILABLE',
            notificationId:
              notification.id,
          }
        );
      }

      /**
       * Graceful fallback:
       *
       * The notification remains persisted and can be recovered by an
       * operational reconciliation/retry worker.
       */
      await this.audit(
        notification,
        'NOTIFICATION_QUEUE_UNAVAILABLE'
      );

      return {
        queued: false,
        notification,
      };
    }

    try {
      await this.queueService.enqueue(
        options.queueName ||
          'notification-send',
        {
          notificationId:
            notification.id,

          tenantId:
            notification.tenantId,

          channel:
            notification.channel,
        },
        {
          ...(options.delay !==
          undefined
            ? {
                delay:
                  options.delay,
              }
            : {}),
        }
      );

      this.metrics.queued++;

      await this.audit(
        notification,
        'NOTIFICATION_QUEUED'
      );

      return {
        queued: true,
        notification,
      };
    } catch (error) {
      this.metrics
        .queueFailures++;

      await this.audit(
        notification,
        'NOTIFICATION_QUEUE_FAILED'
      );

      throw new NotificationServiceError(
        'Unable to enqueue notification.',
        {
          code:
            'NOTIFICATION_QUEUE_ENQUEUE_FAILED',
          notificationId:
            notification.id,
          retryable: true,
          cause: error,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * PROCESSING
   * ==========================================================================
   */

  async processNotification(
    notificationId
  ) {
    if (!notificationId) {
      throw new NotificationServiceError(
        'notificationId is required.',
        {
          code:
            'NOTIFICATION_ID_REQUIRED',
        }
      );
    }

    const notification =
      await this.getNotification(
        notificationId
      );

    if (!notification) {
      throw new NotificationServiceError(
        'Notification not found.',
        {
          code:
            'NOTIFICATION_NOT_FOUND',
          notificationId,
        }
      );
    }

    /**
     * --------------------------------------------------------------
     * Terminal state protection
     * --------------------------------------------------------------
     */

    if (
      notification.status ===
      NOTIFICATION_STATUS.SENT
    ) {
      return notification;
    }

    if (
      notification.status ===
      NOTIFICATION_STATUS.CANCELLED
    ) {
      return notification;
    }

    /**
     * --------------------------------------------------------------
     * In-process lock
     * --------------------------------------------------------------
     */

    if (
      this.processingLocks.has(
        notificationId
      )
    ) {
      this.metrics
        .processingConflicts++;

      return notification;
    }

    this.processingLocks.set(
      notificationId,
      Date.now()
    );

    try {
      /**
       * ------------------------------------------------------------
       * Recover stale processing state
       * ------------------------------------------------------------
       */

      if (
        notification.status ===
          NOTIFICATION_STATUS.PROCESSING &&
        !this.isProcessingLeaseValid(
          notification
        )
      ) {
        notification.status =
          NOTIFICATION_STATUS.RETRY;
      }

      /**
       * ------------------------------------------------------------
       * State transition
       * ------------------------------------------------------------
       */

      this.assertStateTransition(
        notification.status,
        NOTIFICATION_STATUS.PROCESSING
      );

      notification.status =
        NOTIFICATION_STATUS.PROCESSING;

      notification.processingStartedAt =
        new Date();

      notification.attemptCount =
        Number(
          notification.attemptCount || 0
        ) + 1;

      await this.updateNotification(
        notification
      );

      const message =
        await this.buildMessage(
          notification
        );

      const result =
        await this.dispatch(
          notification,
          message
        );

      notification.status =
        NOTIFICATION_STATUS.SENT;

      notification.sentAt =
        new Date();

      notification.processingStartedAt =
        null;

      if (
        result?.provider
      ) {
        notification.provider =
          result.provider;
      }

      if (
        result?.providerReference
      ) {
        notification.providerReference =
          result.providerReference;
      }

      if (
        result?.response
      ) {
        notification.providerResponse =
          this.sanitizeProviderResponse(
            result.response
          );
      }

      await this.updateNotification(
        notification
      );

      this.metrics.sent++;

      this.incrementChannelMetric(
        notification.channel,
        'sent'
      );

      await this.audit(
        notification,
        'NOTIFICATION_SENT'
      );

      this.emit(
        'notification.sent',
        notification
      );

      this.emitMetrics(
        'notification.sent',
        notification
      );

      this.metrics.processed++;

      return notification;
    } catch (error) {
      return this.handleFailure(
        notification,
        error
      );
    } finally {
      this.processingLocks.delete(
        notificationId
      );
    }
  }

  /**
   * ==========================================================================
   * PROCESSING LEASE
   * ==========================================================================
   */

  isProcessingLeaseValid(
    notification
  ) {
    if (
      !notification.processingStartedAt
    ) {
      return false;
    }

    const started =
      new Date(
        notification.processingStartedAt
      ).getTime();

    return (
      Date.now() -
        started <
      Number(
        this.config
          .processingLeaseMs
      )
    );
  }

  /**
   * ==========================================================================
   * MESSAGE BUILDING
   * ==========================================================================
   */

  async buildMessage(
    notification
  ) {
    let message =
      notification.message;

    if (
      notification.template &&
      this.templateService
    ) {
      message =
        await this.templateService.render(
          notification.template,
          notification.metadata || {}
        );
    }

    if (
      this.localizationService &&
      message
    ) {
      message =
        await this.localizationService.translate(
          message,
          notification.language
        );
    }

    if (
      message ===
        undefined ||
      message ===
        null
    ) {
      throw new NotificationServiceError(
        'Unable to build notification message.',
        {
          code:
            'NOTIFICATION_MESSAGE_EMPTY',
          notificationId:
            notification.id,
        }
      );
    }

    return String(message);
  }

  /**
   * ==========================================================================
   * DISPATCH
   * ==========================================================================
   */

  async dispatch(
    notification,
    message
  ) {
    switch (
      notification.channel
    ) {
      case PROVIDER_CHANNELS.EMAIL:
        return this.sendEmail(
          notification,
          message
        );

      case PROVIDER_CHANNELS.SMS:
        return this.sendSMS(
          notification,
          message
        );

      case PROVIDER_CHANNELS.PUSH:
        return this.sendPush(
          notification,
          message
        );

      case PROVIDER_CHANNELS.WEBHOOK:
        return this.sendWebhook(
          notification,
          message
        );

      case PROVIDER_CHANNELS.IN_APP:
        return this.sendInApp(
          notification,
          message
        );

      default:
        throw new NotificationServiceError(
          `Unsupported notification channel: ${notification.channel}`,
          {
            code:
              'UNSUPPORTED_NOTIFICATION_CHANNEL',
            channel:
              notification.channel,
            notificationId:
              notification.id,
          }
        );
    }
  }

  /**
   * ==========================================================================
   * EMAIL
   * ==========================================================================
   */

  async sendEmail(
    notification,
    message
  ) {
    if (!this.emailProvider) {
      throw new NotificationServiceError(
        'Email provider unavailable.',
        {
          code:
            'EMAIL_PROVIDER_UNAVAILABLE',
          channel:
            PROVIDER_CHANNELS.EMAIL,
          notificationId:
            notification.id,
          retryable: true,
        }
      );
    }

    try {
      const response =
        await this.emailProvider.send({
          to:
            notification.recipient.email,

          subject:
            notification.subject,

          message,

          metadata:
            notification.metadata,

          notificationId:
            notification.id,

          tenantId:
            notification.tenantId,
        });

      return this.normalizeProviderResult(
        'email',
        response
      );
    } catch (error) {
      throw this.normalizeProviderError(
        error,
        'email',
        notification
      );
    }
  }

  /**
   * ==========================================================================
   * SMS
   * ==========================================================================
   */

  async sendSMS(
    notification,
    message
  ) {
    if (!this.smsProvider) {
      throw new NotificationServiceError(
        'SMS provider unavailable.',
        {
          code:
            'SMS_PROVIDER_UNAVAILABLE',
          channel:
            PROVIDER_CHANNELS.SMS,
          notificationId:
            notification.id,
          retryable: true,
        }
      );
    }

    try {
      const response =
        await this.smsProvider.send({
          to:
            notification.recipient.phone,

          message,

          metadata:
            notification.metadata,

          notificationId:
            notification.id,

          tenantId:
            notification.tenantId,
        });

      return this.normalizeProviderResult(
        'sms',
        response
      );
    } catch (error) {
      throw this.normalizeProviderError(
        error,
        'sms',
        notification
      );
    }
  }

  /**
   * ==========================================================================
   * PUSH
   * ==========================================================================
   */

  async sendPush(
    notification,
    message
  ) {
    if (!this.pushProvider) {
      throw new NotificationServiceError(
        'Push provider unavailable.',
        {
          code:
            'PUSH_PROVIDER_UNAVAILABLE',
          channel:
            PROVIDER_CHANNELS.PUSH,
          notificationId:
            notification.id,
          retryable: true,
        }
      );
    }

    try {
      const response =
        await this.pushProvider.send({
          token:
            notification.recipient.deviceToken,

          title:
            notification.subject,

          body:
            message,

          metadata:
            notification.metadata,

          notificationId:
            notification.id,

          tenantId:
            notification.tenantId,
        });

      return this.normalizeProviderResult(
        'push',
        response
      );
    } catch (error) {
      throw this.normalizeProviderError(
        error,
        'push',
        notification
      );
    }
  }

  /**
   * ==========================================================================
   * WEBHOOK
   * ==========================================================================
   */

  async sendWebhook(
    notification,
    message
  ) {
    if (!this.webhookProvider) {
      throw new NotificationServiceError(
        'Webhook provider unavailable.',
        {
          code:
            'WEBHOOK_PROVIDER_UNAVAILABLE',
          channel:
            PROVIDER_CHANNELS.WEBHOOK,
          notificationId:
            notification.id,
          retryable: true,
        }
      );
    }

    try {
      const response =
        await this.webhookProvider.send({
          url:
            notification.recipient.url,

          payload: {
            notificationId:
              notification.id,

            tenantId:
              notification.tenantId,

            type:
              notification.type,

            message,

            metadata:
              notification.metadata,
          },

          notificationId:
            notification.id,

          tenantId:
            notification.tenantId,
        });

      return this.normalizeProviderResult(
        'webhook',
        response
      );
    } catch (error) {
      throw this.normalizeProviderError(
        error,
        'webhook',
        notification
      );
    }
  }

  /**
   * ==========================================================================
   * IN-APP
   * ==========================================================================
   */

  async sendInApp(
    notification,
    message
  ) {
    notification.inAppPayload = {
      title:
        notification.subject,

      message,

      type:
        notification.type,

      metadata:
        notification.metadata,
    };

    await this.updateNotification(
      notification
    );

    return {
      provider:
        'internal',
      providerReference:
        notification.id,
    };
  }

  /**
   * ==========================================================================
   * PROVIDER RESULT NORMALIZATION
   * ==========================================================================
   */

  normalizeProviderResult(
    provider,
    response
  ) {
    if (
      response ===
      undefined
    ) {
      return {
        provider,
      };
    }

    if (
      typeof response ===
      'string'
    ) {
      return {
        provider,
        providerReference:
          response,
      };
    }

    return {
      provider,
      providerReference:
        response?.id ||
        response?.messageId ||
        response?.message_id ||
        response?.reference ||
        response?.providerReference ||
        null,

      response,
    };
  }

  /**
   * ==========================================================================
   * PROVIDER ERROR NORMALIZATION
   * ==========================================================================
   */

  normalizeProviderError(
    error,
    channel,
    notification
  ) {
    if (
      error instanceof
      NotificationServiceError
    ) {
      return error;
    }

    const statusCode =
      error?.response?.status ||
      error?.statusCode ||
      null;

    const retryable =
      Boolean(
        error?.retryable
      ) ||
      RETRYABLE_ERROR_CODES.has(
        String(
          error?.code || ''
        )
      ) ||
      [408, 425, 429, 500, 502, 503, 504]
        .includes(
          statusCode
        ) ||
      !error?.response;

    return new NotificationServiceError(
      error?.message ||
        `${channel} provider failed.`,
      {
        code:
          error?.code ||
          `NOTIFICATION_${channel.toUpperCase()}_PROVIDER_ERROR`,

        statusCode,

        channel,

        notificationId:
          notification.id,

        retryable,

        provider:
          channel,

        providerReference:
          error?.providerReference ||
          null,

        cause:
          error,
      }
    );
  }

  /**
   * ==========================================================================
   * FAILURE HANDLING
   * ==========================================================================
   */

  async handleFailure(
    notification,
    error
  ) {
    const normalized =
      this.normalizeError(
        error,
        notification
      );

    this.metrics
      .providerFailures +=
      normalized.retryable
        ? 1
        : 0;

    notification.lastError =
      normalized.message;

    notification.lastErrorCode =
      normalized.code;

    notification.processingStartedAt =
      null;

    notification.retries =
      Number(
        notification.retries || 0
      ) + 1;

    const exhausted =
      notification.retries >=
      Number(
        this.config.maxRetries
      );

    /**
     * --------------------------------------------------------------
     * Permanent failure
     * --------------------------------------------------------------
     */

    if (
      !normalized.retryable ||
      exhausted
    ) {
      notification.status =
        NOTIFICATION_STATUS.FAILED;

      notification.failedAt =
        new Date();

      await this.updateNotification(
        notification
      );

      this.metrics.failed++;

      this.incrementChannelMetric(
        notification.channel,
        'failed'
      );

      await this.enqueueDeadLetter(
        notification,
        normalized
      );

      await this.audit(
        notification,
        'NOTIFICATION_FAILED'
      );

      this.emit(
        'notification.failed',
        notification
      );

      this.emitMetrics(
        'notification.failed',
        notification
      );

      return notification;
    }

    /**
     * --------------------------------------------------------------
     * Retry
     * --------------------------------------------------------------
     */

    notification.status =
      NOTIFICATION_STATUS.RETRY;

    await this.updateNotification(
      notification
    );

    const delay =
      this.calculateRetryDelay(
        notification.retries
      );

    this.metrics.retried++;

    await this.audit(
      notification,
      'NOTIFICATION_RETRY_SCHEDULED'
    );

    try {
      await this.enqueueNotification(
        notification,
        {
          delay,
        }
      );
    } catch (queueError) {
      /**
       * The notification remains in RETRY state.
       *
       * Operational reconciliation can recover it.
       */
      await this.audit(
        notification,
        'NOTIFICATION_RETRY_QUEUE_FAILED'
      );

      this.logger.error?.(
        'Notification retry enqueue failed',
        queueError
      );
    }

    this.emit(
      'notification.retry',
      {
        notification,
        delay,
      }
    );

    return notification;
  }

  /**
   * ==========================================================================
   * DEAD LETTER
   * ==========================================================================
   */

  async enqueueDeadLetter(
    notification,
    error
  ) {
    if (
      !this.queueService?.enqueue
    ) {
      this.metrics
        .queueFailures++;

      return false;
    }

    try {
      await this.queueService.enqueue(
        'notification-dead-letter',
        {
          notificationId:
            notification.id,

          tenantId:
            notification.tenantId,

          channel:
            notification.channel,

          error: {
            code:
              error.code,

            message:
              error.message,

            retryable:
              error.retryable,
          },

          failedAt:
            new Date().toISOString(),
        }
      );

      this.metrics
        .deadLettered++;

      await this.audit(
        notification,
        'NOTIFICATION_DEAD_LETTERED'
      );

      return true;
    } catch (queueError) {
      this.logger.error?.(
        'Notification dead-letter enqueue failed',
        queueError
      );

      return false;
    }
  }

  /**
   * ==========================================================================
   * RETRY BACKOFF
   * ==========================================================================
   */

  calculateRetryDelay(
    retryCount
  ) {
    const base =
      Number(
        this.config.retryDelayMs
      );

    const max =
      Number(
        this.config.maxRetryDelayMs
      );

    const exponential =
      base *
      Math.pow(
        2,
        Math.max(
          0,
          retryCount - 1
        )
      );

    const jitter =
      Math.floor(
        Math.random() *
        Math.max(
          1000,
          base
        )
      );

    return Math.min(
      exponential + jitter,
      max
    );
  }

  /**
   * ==========================================================================
   * STATE MACHINE
   * ==========================================================================
   */

  assertStateTransition(
    current,
    next
  ) {
    if (
      !current ||
      current === next
    ) {
      return true;
    }

    const transitions = {
      [NOTIFICATION_STATUS.PENDING]:
        new Set([
          NOTIFICATION_STATUS.PROCESSING,
          NOTIFICATION_STATUS.CANCELLED,
        ]),

      [NOTIFICATION_STATUS.RETRY]:
        new Set([
          NOTIFICATION_STATUS.PROCESSING,
          NOTIFICATION_STATUS.CANCELLED,
        ]),

      [NOTIFICATION_STATUS.PROCESSING]:
        new Set([
          NOTIFICATION_STATUS.SENT,
          NOTIFICATION_STATUS.RETRY,
          NOTIFICATION_STATUS.FAILED,
        ]),

      [NOTIFICATION_STATUS.SENT]:
        new Set([]),

      [NOTIFICATION_STATUS.FAILED]:
        new Set([]),

      [NOTIFICATION_STATUS.CANCELLED]:
        new Set([]),
    };

    if (
      !transitions[current]?.has(
        next
      )
    ) {
      throw new NotificationServiceError(
        `Invalid notification state transition: ${current} -> ${next}`,
        {
          code:
            'INVALID_NOTIFICATION_STATE_TRANSITION',
        }
      );
    }

    return true;
  }

  /**
   * ==========================================================================
   * GET NOTIFICATION
   * ==========================================================================
   */

  async getNotification(
    notificationId
  ) {
    if (
      !this.db?.notifications?.findById
    ) {
      throw new NotificationServiceError(
        'Notification persistence adapter unavailable.',
        {
          code:
            'NOTIFICATION_LOOKUP_UNAVAILABLE',
          notificationId,
        }
      );
    }

    return this.db.notifications.findById(
      notificationId
    );
  }

  /**
   * ==========================================================================
   * PREFERENCES
   * ==========================================================================
   */

  async getPreferences(
    userId,
    tenantId = null
  ) {
    if (
      !this.db?.notificationPreferences?.findOne
    ) {
      return null;
    }

    return this.db.notificationPreferences.findOne(
      {
        userId,

        ...(tenantId
          ? {
              tenantId,
            }
          : {}),
      }
    );
  }

  async updatePreferences(
    userId,
    preferences = {},
    tenantId = null
  ) {
    if (
      !this.db?.notificationPreferences?.upsert
    ) {
      throw new NotificationServiceError(
        'Notification preference persistence unavailable.',
        {
          code:
            'NOTIFICATION_PREFERENCE_PERSISTENCE_UNAVAILABLE',
        }
      );
    }

    return this.db.notificationPreferences.upsert(
      {
        userId,

        ...(tenantId
          ? {
              tenantId,
            }
          : {}),

        ...preferences,

        updatedAt:
          new Date(),
      }
    );
  }

  async isChannelAllowed(
    userId,
    channel
  ) {
    const preferences =
      await this.getPreferences(
        userId
      );

    if (!preferences) {
      return true;
    }

    /**
     * Supported preference formats:
     *
     * {
     *   email: true,
     *   sms: false,
     *   push: true
     * }
     *
     * or:
     *
     * {
     *   channels: {
     *     email: true
     *   }
     * }
     */

    const channels =
      preferences.channels ||
      preferences;

    if (
      channels[channel] ===
      undefined
    ) {
      return true;
    }

    return Boolean(
      channels[channel]
    );
  }

  /**
   * ==========================================================================
   * READ RECEIPTS
   * ==========================================================================
   */

  async markAsRead(
    notificationId
  ) {
    const notification =
      await this.getNotification(
        notificationId
      );

    if (!notification) {
      return null;
    }

    notification.read =
      true;

    notification.readAt =
      new Date();

    await this.updateNotification(
      notification
    );

    this.metrics
      .readReceipts++;

    await this.audit(
      notification,
      'NOTIFICATION_READ'
    );

    this.emit(
      'notification.read',
      notification
    );

    return notification;
  }

  /**
   * ==========================================================================
   * BULK NOTIFICATIONS
   * ==========================================================================
   */

  async sendBulk(
    notifications = []
  ) {
    if (
      !Array.isArray(
        notifications
      )
    ) {
      throw new NotificationServiceError(
        'notifications must be an array.',
        {
          code:
            'INVALID_BULK_NOTIFICATION_PAYLOAD',
        }
      );
    }

    const results =
      new Array(
        notifications.length
      );

    for (
      let index = 0;
      index <
      notifications.length;
      index++
    ) {
      const item =
        notifications[index];

      try {
        const result =
          await this.send(
            item
          );

        results[index] = {
          success: true,
          result,
        };
      } catch (error) {
        results[index] = {
          success: false,

          error:
            error.message,

          code:
            error.code ||
            'NOTIFICATION_SEND_FAILED',
        };
      }
    }

    return {
      processed:
        results.length,

      successful:
        results.filter(
          item =>
            item.success
        ).length,

      failed:
        results.filter(
          item =>
            !item.success
        ).length,

      results,
    };
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  async getMetrics() {
    let databaseMetrics = {};

    if (
      this.db?.notifications
    ) {
      try {
        const [
          sent,
          failed,
          pending,
          retry,
          processing,
          read,
        ] = await Promise.all([
          this.db.notifications.count({
            status:
              NOTIFICATION_STATUS.SENT,
          }),

          this.db.notifications.count({
            status:
              NOTIFICATION_STATUS.FAILED,
          }),

          this.db.notifications.count({
            status:
              NOTIFICATION_STATUS.PENDING,
          }),

          this.db.notifications.count({
            status:
              NOTIFICATION_STATUS.RETRY,
          }),

          this.db.notifications.count({
            status:
              NOTIFICATION_STATUS.PROCESSING,
          }),

          this.db.notifications.count({
            read: true,
          }),
        ]);

        databaseMetrics = {
          sent,
          failed,
          pending,
          retry,
          processing,
          read,
        };
      } catch (error) {
        this.logger.warn?.(
          'Notification metrics query failed',
          {
            error:
              error.message,
          }
        );
      }
    }

    return {
      ...databaseMetrics,

      runtime:
        {
          ...this.metrics,

          idempotencyCacheSize:
            this.idempotencyCache.size,

          processingLocks:
            this.processingLocks.size,
        },

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * CHANNEL METRICS
   * ==========================================================================
   */

  incrementChannelMetric(
    channel,
    metric
  ) {
    if (
      !this.metrics.byChannel[channel]
    ) {
      this.metrics.byChannel[channel] =
        {};
    }

    this.metrics.byChannel[channel][
      metric
    ] =
      Number(
        this.metrics.byChannel[channel][
          metric
        ] || 0
      ) + 1;
  }

  /**
   * ==========================================================================
   * EXTERNAL METRICS
   * ==========================================================================
   */

  emitMetrics(
    event,
    notification
  ) {
    if (
      !this.config.enableMetrics
    ) {
      return;
    }

    if (
      !this.metricsService
    ) {
      return;
    }

    try {
      if (
        typeof this.metricsService.increment ===
        'function'
      ) {
        this.metricsService.increment(
          event,
          {
            channel:
              notification.channel,

            tenantId:
              notification.tenantId,
          }
        );
      } else if (
        typeof this.metricsService.record ===
        'function'
      ) {
        this.metricsService.record(
          event,
          {
            channel:
              notification.channel,

            tenantId:
              notification.tenantId,
          }
        );
      }
    } catch (error) {
      this.logger.warn?.(
        'Notification metrics emission failed',
        {
          error:
            error.message,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * AUDIT
   * ==========================================================================
   */

  async audit(
    notification,
    action
  ) {
    if (
      !this.auditService ||
      !this.config.enableAudit
    ) {
      return null;
    }

    try {
      const entry = {
        tenantId:
          notification.tenantId,

        customerId:
          notification.customerId,

        userId:
          notification.userId,

        action,

        payload:
          this.sanitizeAuditPayload({
            notificationId:
              notification.id,

            channel:
              notification.channel,

            type:
              notification.type,

            status:
              notification.status,

            retries:
              notification.retries,

            attemptCount:
              notification.attemptCount,

            provider:
              notification.provider,

            providerReference:
              notification.providerReference,

            errorCode:
              notification.lastErrorCode,
          }),

        timestamp:
          new Date(),
      };

      if (
        typeof this.auditService.log ===
        'function'
      ) {
        await this.auditService.log(
          entry
        );
      } else if (
        typeof this.auditService.record ===
        'function'
      ) {
        await this.auditService.record(
          entry
        );
      }

      return entry;
    } catch (error) {
      this.metrics
        .auditFailures++;

      this.logger.error?.(
        'Notification audit failed',
        error
      );

      /**
       * Audit failure must not convert an otherwise successful notification
       * into a delivery failure.
       */
      return null;
    }
  }

  /**
   * ==========================================================================
   * AUDIT SANITIZATION
   * ==========================================================================
   */

  sanitizeAuditPayload(
    payload
  ) {
    if (
      payload === null ||
      payload === undefined
    ) {
      return payload;
    }

    if (
      typeof payload !==
      'object'
    ) {
      return payload;
    }

    const sanitize =
      value => {
        if (
          Array.isArray(
            value
          )
        ) {
          return value.map(
            sanitize
          );
        }

        if (
          value &&
          typeof value ===
            'object'
        ) {
          const result =
            {};

          for (
            const [
              key,
              child,
            ] of Object.entries(
              value
            )
          ) {
            if (
              SENSITIVE_KEYS.has(
                key
              )
            ) {
              result[key] =
                '[REDACTED]';
            } else {
              result[key] =
                sanitize(
                  child
                );
            }
          }

          return result;
        }

        return value;
      };

    return sanitize(
      payload
    );
  }

  /**
   * ==========================================================================
   * PROVIDER RESPONSE SANITIZATION
   * ==========================================================================
   */

  sanitizeProviderResponse(
    response
  ) {
    return this.sanitizeAuditPayload(
      response
    );
  }

  /**
   * ==========================================================================
   * ERROR NORMALIZATION
   * ==========================================================================
   */

  normalizeError(
    error,
    notification = null
  ) {
    if (
      error instanceof
      NotificationServiceError
    ) {
      return error;
    }

    return new NotificationServiceError(
      error?.message ||
        'Notification processing failed.',
      {
        code:
          error?.code ||
          'NOTIFICATION_PROCESSING_FAILED',

        statusCode:
          error?.statusCode ||
          error?.response?.status ||
          null,

        channel:
          notification?.channel ||
          null,

        notificationId:
          notification?.id ||
          null,

        retryable:
          Boolean(
            error?.retryable
          ) ||
          RETRYABLE_ERROR_CODES.has(
            String(
              error?.code || ''
            )
          ) ||
          !error?.response,

        cause:
          error,
      }
    );
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async healthCheck() {
    const databaseAvailable =
      Boolean(
        this.db?.notifications
      );

    const queueAvailable =
      Boolean(
        this.queueService?.enqueue
      );

    return {
      healthy:
        databaseAvailable &&
        (
          queueAvailable ||
          !this.config.requireQueue
        ),

      service:
        'notificationService',

      databaseAvailable,

      queueAvailable,

      providers: {
        email:
          Boolean(
            this.emailProvider
          ),

        sms:
          Boolean(
            this.smsProvider
          ),

        push:
          Boolean(
            this.pushProvider
          ),

        webhook:
          Boolean(
            this.webhookProvider
          ),
      },

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * RESET METRICS
   * ==========================================================================
   */

  resetMetrics() {
    this.metrics = {
      created: 0,
      queued: 0,
      processed: 0,

      sent: 0,
      failed: 0,
      retried: 0,

      deadLettered: 0,

      duplicateRequests: 0,

      providerFailures: 0,

      preferenceBlocked: 0,

      queueFailures: 0,

      validationFailures: 0,

      processingConflicts: 0,

      auditFailures: 0,

      readReceipts: 0,

      byChannel: {},

      startedAt:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * CANCEL NOTIFICATION
   * ==========================================================================
   *
   * New capability.
   *
   * Cancellation is intentionally state-based and does not delete records.
   */

  async cancelNotification(
    notificationId,
    reason =
      'Notification cancelled'
  ) {
    const notification =
      await this.getNotification(
        notificationId
      );

    if (!notification) {
      throw new NotificationServiceError(
        'Notification not found.',
        {
          code:
            'NOTIFICATION_NOT_FOUND',
          notificationId,
        }
      );
    }

    if (
      TERMINAL_STATUSES.has(
        notification.status
      )
    ) {
      return notification;
    }

    this.assertStateTransition(
      notification.status,
      NOTIFICATION_STATUS.CANCELLED
    );

    notification.status =
      NOTIFICATION_STATUS.CANCELLED;

    notification.cancellationReason =
      reason;

    notification.cancelledAt =
      new Date();

    await this.updateNotification(
      notification
    );

    await this.audit(
      notification,
      'NOTIFICATION_CANCELLED'
    );

    this.emit(
      'notification.cancelled',
      notification
    );

    return notification;
  }

  /**
   * ==========================================================================
   * RETRY MANUALLY
   * ==========================================================================
   */

  async retryNotification(
    notificationId
  ) {
    const notification =
      await this.getNotification(
        notificationId
      );

    if (!notification) {
      throw new NotificationServiceError(
        'Notification not found.',
        {
          code:
            'NOTIFICATION_NOT_FOUND',
          notificationId,
        }
      );
    }

    if (
      notification.status ===
      NOTIFICATION_STATUS.SENT
    ) {
      return {
        success: false,
        action:
          'RETRY_NOT_REQUIRED',
        notification,
      };
    }

    notification.status =
      NOTIFICATION_STATUS.RETRY;

    notification.lastError =
      null;

    notification.lastErrorCode =
      null;

    await this.updateNotification(
      notification
    );

    await this.enqueueNotification(
      notification
    );

    await this.audit(
      notification,
      'NOTIFICATION_MANUAL_RETRY'
    );

    return {
      success: true,
      action:
        'RETRY_QUEUED',
      notification,
    };
  }

  /**
   * ==========================================================================
   * PROCESSOR COMPATIBILITY
   * ==========================================================================
   *
   * Useful for BullMQ / queue worker integration.
   */

  async handleQueueJob(
    job = {}
  ) {
    const notificationId =
      job?.data?.notificationId ||
      job?.notificationId ||
      null;

    if (!notificationId) {
      throw new NotificationServiceError(
        'Queue job does not contain notificationId.',
        {
          code:
            'NOTIFICATION_QUEUE_JOB_INVALID',
        }
      );
    }

    return this.processNotification(
      notificationId
    );
  }

  /**
   * ==========================================================================
   * CAPABILITIES
   * ==========================================================================
   */

  getCapabilities() {
    return {
      email:
        Boolean(
          this.emailProvider
        ),

      sms:
        Boolean(
          this.smsProvider
        ),

      push:
        Boolean(
          this.pushProvider
        ),

      webhook:
        Boolean(
          this.webhookProvider
        ),

      inApp: true,

      queue:
        Boolean(
          this.queueService?.enqueue
        ),

      persistence:
        Boolean(
          this.db?.notifications
        ),

      idempotency:
        Boolean(
          this.config.enableIdempotency
        ),

      retries: true,

      deadLetter:
        Boolean(
          this.queueService?.enqueue
        ),

      preferences:
        Boolean(
          this.db?.notificationPreferences
        ),

      templates:
        Boolean(
          this.templateService
        ),

      localization:
        Boolean(
          this.localizationService
        ),

      audit:
        Boolean(
          this.auditService
        ),

      metrics:
        Boolean(
          this.metricsService
        ),

      cancellation: true,

      manualRetry: true,

      stateMachine: true,

      tenantIsolation: true,

      providerCorrelation:
        Boolean(
          this.config
            .enableProviderCorrelation
        ),
    };
  }
}

/**
 * ============================================================================
 * EXPORT
 * ============================================================================
 */

module.exports =
  NotificationService;

module.exports.NotificationServiceError =
  NotificationServiceError;

module.exports.NOTIFICATION_STATUS =
  NOTIFICATION_STATUS;

module.exports.PROVIDER_CHANNELS =
  PROVIDER_CHANNELS;