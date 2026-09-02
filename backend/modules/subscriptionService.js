// backend/modules/subscriptionService.js
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Subscription Service
 * ============================================================================
 *
 * File:
 *   backend/modules/subscriptionService.js
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Tenant subscription lifecycle
 * - Subscription creation
 * - Trial management
 * - Plan upgrades / downgrades
 * - Proration calculation
 * - Subscription cancellation
 * - Subscription reactivation
 * - Renewal processing
 * - Past-due / grace / suspension lifecycle
 * - Tenant feature entitlement
 * - Usage-limit enforcement
 * - Billing synchronization
 * - Webhook ingestion and processing
 * - Idempotency
 * - Optimistic concurrency
 * - Durable event/outbox compatibility
 * - Audit integration
 * - Cache integration
 * - Operational metrics
 *
 * Architectural Rules
 * ----------------------------------------------------------------------------
 *
 * 1. Tenant isolation is mandatory.
 * 2. Subscription state changes must pass through explicit transition rules.
 * 3. Billing operations must be idempotent.
 * 4. Financial records must NOT be directly manipulated here.
 * 5. Invoice generation/payment collection belongs to TenantBillingService.
 * 6. SubscriptionService controls entitlement and lifecycle state.
 * 7. Historical subscription records/events must remain auditable.
 * 8. Cache is an optimization, never the source of truth.
 * 9. Feature access fails closed when subscription state is invalid.
 * 10. Renewal jobs must be safe to run repeatedly.
 * 11. Lifecycle writes must use optimistic concurrency where supported.
 * 12. Webhooks must be claimed atomically before processing.
 * 13. A webhook is not acknowledged as completed until processing succeeds.
 * 14. Event publication should support a transactional/durable outbox.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * Service Metadata
 * ============================================================================
 */

const SERVICE_NAME = 'SubscriptionService';

const SERVICE_VERSION = '2026.2';

/**
 * ============================================================================
 * Subscription Status
 * ============================================================================
 */

const SUBSCRIPTION_STATUS = Object.freeze({
  TRIALING: 'trialing',
  ACTIVE: 'active',
  PAST_DUE: 'past_due',
  GRACE: 'grace',
  CANCELLED: 'cancelled',
  SUSPENDED: 'suspended',
});

/**
 * ============================================================================
 * Explicit State Transition Matrix
 * ============================================================================
 *
 * Cancellation is intentionally allowed from all non-terminal operational
 * states. Reactivation is handled explicitly from terminal states.
 *
 * Normal billing lifecycle:
 *
 *   trialing
 *      │
 *      ├── trial expires / successful billing ──> active
 *      │
 *      └── billing failure ────────────────────> past_due
 *
 *   active
 *      │
 *      └── billing failure ────────────────────> past_due
 *
 *   past_due
 *      │
 *      ├── payment recovered ──────────────────> active
 *      │
 *      └── grace processing ───────────────────> grace
 *
 *   grace
 *      │
 *      ├── payment recovered ──────────────────> active
 *      │
 *      └── grace expired ──────────────────────> suspended
 *
 * ============================================================================
 */

const STATE_TRANSITIONS = Object.freeze({
  [SUBSCRIPTION_STATUS.TRIALING]: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.PAST_DUE,
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ]),

  [SUBSCRIPTION_STATUS.ACTIVE]: Object.freeze([
    SUBSCRIPTION_STATUS.PAST_DUE,
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ]),

  [SUBSCRIPTION_STATUS.PAST_DUE]: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.GRACE,
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ]),

  [SUBSCRIPTION_STATUS.GRACE]: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
    SUBSCRIPTION_STATUS.CANCELLED,
    SUBSCRIPTION_STATUS.SUSPENDED,
  ]),

  [SUBSCRIPTION_STATUS.CANCELLED]: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
  ]),

  [SUBSCRIPTION_STATUS.SUSPENDED]: Object.freeze([
    SUBSCRIPTION_STATUS.ACTIVE,
  ]),
});

const ENTITLED_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.TRIALING,
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.GRACE,
]);

const BILLABLE_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.TRIALING,
  SUBSCRIPTION_STATUS.ACTIVE,
  SUBSCRIPTION_STATUS.PAST_DUE,
  SUBSCRIPTION_STATUS.GRACE,
]);

const TERMINAL_STATUSES = Object.freeze([
  SUBSCRIPTION_STATUS.CANCELLED,
  SUBSCRIPTION_STATUS.SUSPENDED,
]);

/**
 * Backward-compatible export.
 */

const ACTIVE_STATUSES = ENTITLED_STATUSES;

const BILLING_CYCLES = Object.freeze([
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
]);

const PLAN_CHANGE_TYPES = Object.freeze([
  'upgrade',
  'downgrade',
]);

const WEBHOOK_STATUS = Object.freeze({
  PROCESSING: 'processing',
  PROCESSED: 'processed',
  FAILED: 'failed',
});

/**
 * ============================================================================
 * Default Configuration
 * ============================================================================
 */

const DEFAULT_CONFIG = Object.freeze({
  trialDays: 14,

  gracePeriodDays: 7,

  cacheTtl: 300,

  webhookCacheTtl: 86400,

  requireTenantId: true,

  requirePlanId: true,

  requireBillingCycle: true,

  allowDowngrade: true,

  allowUpgrade: true,

  allowReactivation: true,

  allowImmediateCancellation: true,

  failClosedEntitlements: true,

  renewalBatchSize: 100,

  renewalConcurrency: 5,

  graceBatchSize: 100,

  graceConcurrency: 5,

  webhookClaimTimeoutSeconds: 300,

  webhookMaxAttempts: 10,

  webhookRetryDelaySeconds: 30,

  maxUsageValue: Number.MAX_SAFE_INTEGER,

  emitEvents: true,

  auditRequired: true,

  failClosedAudit: false,

  idempotencyRequired: true,

  optimisticConcurrencyRequired: false,

  requireDurableEvents: false,

  requireBillingServiceForRenewal: true,

  allowRenewalWithoutCollection: false,

  cachePrefix: 'subscription',

  currency: 'UGX',

  moneyPrecision: 2,

  defaultTimezone: 'UTC',
});

/**
 * ============================================================================
 * Domain Error
 * ============================================================================
 */

class SubscriptionDomainError extends Error {
  constructor(
    code,
    message,
    {
      statusCode = 400,
      retryable = false,
      details = null,
      cause = null,
    } = {}
  ) {
    super(message);

    this.name = 'SubscriptionDomainError';

    this.code = code;

    this.statusCode = statusCode;

    this.retryable = retryable;

    this.details = details;

    if (cause) {
      this.cause = cause;
    }

    Error.captureStackTrace?.(
      this,
      SubscriptionDomainError
    );
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      statusCode: this.statusCode,
      retryable: this.retryable,
      details: this.details,
    };
  }
}

/**
 * ============================================================================
 * Utility Functions
 * ============================================================================
 */

function normalizeString(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  return String(value).trim();
}

function normalizeId(value) {
  return normalizeString(value);
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function toDate(value) {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime()
    )
  ) {
    throw new SubscriptionDomainError(
      'INVALID_DATE',
      `Invalid date value: ${value}`
    );
  }

  return date;
}

function cloneDate(value) {
  return new Date(
    toDate(value).getTime()
  );
}

function isPositiveFiniteNumber(value) {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0
  );
}

function safeInteger(value) {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value)
  );
}

function createHash(payload) {
  return crypto
    .createHash('sha256')
    .update(
      JSON.stringify(payload)
    )
    .digest('hex');
}

function sleep(milliseconds) {
  return new Promise(
    (resolve) => {
      setTimeout(
        resolve,
        milliseconds
      );
    }
  );
}

function serializeError(error) {
  if (!error) {
    return null;
  }

  return {
    name: error.name,
    message: error.message,
    code: error.code,
    statusCode: error.statusCode,
    retryable: error.retryable,
    stack: error.stack,
  };
}

/**
 * ============================================================================
 * Subscription Service
 * ============================================================================
 */

class SubscriptionService extends EventEmitter {
  constructor({
    db,
    logger,
    cache,
    queueService,
    auditService,
    metricsService,
    tenantBillingService,
    notificationService,
    featureFlagService,
    eventBus,
    outboxService,
    config = {},
  } = {}) {
    super();

    this.db = db || null;

    this.logger =
      logger || console;

    this.cache =
      cache || null;

    this.queueService =
      queueService || null;

    this.auditService =
      auditService || null;

    this.metricsService =
      metricsService || null;

    this.tenantBillingService =
      tenantBillingService || null;

    this.notificationService =
      notificationService || null;

    this.featureFlagService =
      featureFlagService || null;

    this.eventBus =
      eventBus || null;

    this.outboxService =
      outboxService || null;

    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.metrics =
      this.createMetrics();
  }

  /**
   * ==========================================================================
   * Metrics
   * ==========================================================================
   */

  createMetrics() {
    return {
      subscriptionsCreated: 0,
      subscriptionsCancelled: 0,
      subscriptionsReactivated: 0,

      stateTransitions: 0,
      concurrencyConflicts: 0,

      planChanges: 0,
      upgrades: 0,
      downgrades: 0,

      renewalsAttempted: 0,
      renewalsSucceeded: 0,
      renewalsFailed: 0,
      renewalsSkipped: 0,

      pastDueTransitions: 0,
      gracePeriodsStarted: 0,
      gracePeriodsProcessed: 0,

      subscriptionsSuspended: 0,

      webhookReceived: 0,
      webhookProcessed: 0,
      webhookDuplicates: 0,
      webhookClaimed: 0,
      webhookFailed: 0,

      cacheHits: 0,
      cacheMisses: 0,
      cacheFailures: 0,

      entitlementChecks: 0,
      entitlementDenied: 0,

      usageChecks: 0,
      usageDenied: 0,

      eventsPublished: 0,
      eventPublicationFailures: 0,

      auditFailures: 0,

      billingFailures: 0,

      failures: 0,
    };
  }

  incrementMetric(
    name,
    value = 1
  ) {
    if (
      !Object.prototype.hasOwnProperty.call(
        this.metrics,
        name
      )
    ) {
      this.metrics[name] = 0;
    }

    this.metrics[name] += value;

    if (
      this.metricsService &&
      typeof this.metricsService.increment ===
        'function'
    ) {
      try {
        this.metricsService.increment(
          `subscription_${name}`,
          value
        );
      } catch (error) {
        this.logWarn(
          'Subscription metrics integration failed.',
          {
            metric: name,
            error: error.message,
          }
        );
      }
    }
  }

  /**
   * ==========================================================================
   * Subscription Creation
   * ==========================================================================
   */

  async createSubscription({
    tenantId,
    planId,
    trial = true,
    metadata = {},
    idempotencyKey = null,
    correlationId = null,
  } = {}) {
    const normalizedTenantId =
      normalizeId(tenantId);

    const normalizedPlanId =
      normalizeId(planId);

    const requestId =
      normalizeString(correlationId) ||
      crypto.randomUUID();

    const normalizedIdempotencyKey =
      normalizeString(idempotencyKey);

    try {
      this.assertTenantId(
        normalizedTenantId
      );

      this.assertPlanId(
        normalizedPlanId
      );

      if (!isObject(metadata)) {
        throw this.createError(
          'INVALID_METADATA',
          'Subscription metadata must be an object.'
        );
      }

      if (
        this.config.idempotencyRequired &&
        !normalizedIdempotencyKey
      ) {
        throw this.createError(
          'IDEMPOTENCY_KEY_REQUIRED',
          'An idempotency key is required for subscription creation.',
          {
            statusCode: 400,
          }
        );
      }

      if (normalizedIdempotencyKey) {
        const existing =
          await this.findByIdempotencyKey(
            normalizedTenantId,
            normalizedIdempotencyKey
          );

        if (existing) {
          return {
            ...existing,
            idempotent: true,
          };
        }
      }

      const plan =
        await this.getBillingPlan(
          normalizedPlanId
        );

      if (!plan) {
        throw this.createError(
          'PLAN_NOT_FOUND',
          'Plan not found.',
          {
            statusCode: 404,
          }
        );
      }

      this.assertPlanUsable(plan);

      /**
       * We intentionally do not trust cache for this uniqueness check.
       */

      const existing =
        await this.findOperationalSubscription(
          normalizedTenantId
        );

      if (existing) {
        throw this.createError(
          'ACTIVE_SUBSCRIPTION_EXISTS',
          'Tenant already has an operational subscription.',
          {
            statusCode: 409,
            details: {
              subscriptionId: existing.id,
              status: existing.status,
            },
          }
        );
      }

      const now = new Date();

      const effectiveTrialDays =
        trial
          ? this.resolveTrialDays(plan)
          : 0;

      const status =
        effectiveTrialDays > 0
          ? SUBSCRIPTION_STATUS.TRIALING
          : SUBSCRIPTION_STATUS.ACTIVE;

      const currentPeriodEnd =
        effectiveTrialDays > 0
          ? this.addDays(
              now,
              effectiveTrialDays
            )
          : this.calculateNextBillingDate(
              now,
              plan.billingCycle
            );

      const subscription = {
        id: crypto.randomUUID(),

        tenantId:
          normalizedTenantId,

        planId:
          normalizedPlanId,

        status,

        startedAt: now,

        trialStartedAt:
          effectiveTrialDays > 0
            ? now
            : null,

        trialEndsAt:
          effectiveTrialDays > 0
            ? currentPeriodEnd
            : null,

        currentPeriodStart:
          now,

        currentPeriodEnd,

        cancelAtPeriodEnd:
          false,

        cancellationRequestedAt:
          null,

        cancelledAt:
          null,

        pastDueAt:
          null,

        graceStartedAt:
          null,

        graceEndsAt:
          null,

        suspendedAt:
          null,

        suspensionReason:
          null,

        idempotencyKey:
          normalizedIdempotencyKey ||
          null,

        correlationId:
          requestId,

        metadata: {
          ...metadata,
        },

        lifecycleVersion: 1,

        createdAt: now,

        updatedAt: now,
      };

      const persisted =
        await this.createSubscriptionAtomically(
          subscription
        );

      /**
       * Duplicate key may indicate that another concurrent request won.
       */

      if (
        persisted?.id !== subscription.id &&
        normalizedIdempotencyKey
      ) {
        return {
          ...persisted,
          idempotent: true,
        };
      }

      await this.invalidateCache(
        normalizedTenantId
      );

      await this.audit(
        normalizedTenantId,
        'SUBSCRIPTION_CREATED',
        {
          subscriptionId:
            persisted.id,
          planId:
            persisted.planId,
          status:
            persisted.status,
          trialEndsAt:
            persisted.trialEndsAt,
        },
        {
          correlationId:
            requestId,
        }
      );

      await this.publishDomainEvent(
        'subscription.created',
        persisted,
        {
          correlationId:
            requestId,
        }
      );

      this.incrementMetric(
        'subscriptionsCreated'
      );

      return persisted;
    } catch (error) {
      this.incrementMetric(
        'failures'
      );

      this.logError(
        'Create subscription failed.',
        error,
        {
          tenantId:
            normalizedTenantId,
          planId:
            normalizedPlanId,
          correlationId:
            requestId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Retrieval
   * ==========================================================================
   */

  async getSubscription(
    subscriptionId
  ) {
    const id =
      normalizeId(subscriptionId);

    if (!id) {
      return null;
    }

    const repository =
      this.getSubscriptionRepository();

    return this.repositoryFindById(
      repository,
      id
    );
  }

  async getActiveSubscription(
    tenantId
  ) {
    const normalizedTenantId =
      normalizeId(tenantId);

    this.assertTenantId(
      normalizedTenantId
    );

    const cacheKey =
      this.getCacheKey(
        normalizedTenantId
      );

    const cached =
      await this.readCache(cacheKey);

    if (cached) {
      this.incrementMetric(
        'cacheHits'
      );

      return cached;
    }

    this.incrementMetric(
      'cacheMisses'
    );

    const subscription =
      await this.findOperationalSubscription(
        normalizedTenantId
      );

    if (subscription) {
      await this.writeCache(
        cacheKey,
        subscription,
        this.config.cacheTtl
      );
    }

    return subscription;
  }

  async findOperationalSubscription(
    tenantId
  ) {
    const repository =
      this.getSubscriptionRepository();

    return this.repositoryFindOne(
      repository,
      {
        tenantId,
        status: {
          $in: ENTITLED_STATUSES,
        },
      }
    );
  }

  /**
   * ==========================================================================
   * Explicit State Transitions
   * ==========================================================================
   */

  async transitionSubscriptionState(
    subscription,
    targetStatus,
    {
      reason = null,
      correlationId = null,
      metadata = {},
      expectedVersion = null,
      additionalFields = {},
    } = {}
  ) {
    if (!subscription?.id) {
      throw this.createError(
        'INVALID_SUBSCRIPTION',
        'A valid subscription is required.'
      );
    }

    const currentStatus =
      normalizeString(
        subscription.status
      ).toLowerCase();

    const normalizedTarget =
      normalizeString(
        targetStatus
      ).toLowerCase();

    if (
      currentStatus === normalizedTarget
    ) {
      return subscription;
    }

    this.assertValidTransition(
      currentStatus,
      normalizedTarget
    );

    const now = new Date();

    const next = {
      ...subscription,

      ...additionalFields,

      status:
        normalizedTarget,

      updatedAt:
        now,

      lifecycleVersion:
        Number(
          expectedVersion ??
          subscription.lifecycleVersion ??
          0
        ) + 1,

      lastStateTransition: {
        from:
          currentStatus,

        to:
          normalizedTarget,

        reason,

        correlationId:
          correlationId || null,

        metadata:
          isObject(metadata)
            ? metadata
            : {},

        transitionedAt:
          now,
      },
    };

    switch (normalizedTarget) {
      case SUBSCRIPTION_STATUS.ACTIVE:
        next.pastDueAt = null;
        next.graceStartedAt = null;
        next.graceEndsAt = null;
        next.suspendedAt = null;
        next.suspensionReason = null;
        break;

      case SUBSCRIPTION_STATUS.PAST_DUE:
        next.pastDueAt =
          subscription.pastDueAt || now;
        break;

      case SUBSCRIPTION_STATUS.GRACE:
        next.graceStartedAt = now;

        next.graceEndsAt =
          this.addDays(
            now,
            this.config.gracePeriodDays
          );
        break;

      case SUBSCRIPTION_STATUS.SUSPENDED:
        next.suspendedAt = now;

        next.suspensionReason =
          reason ||
          'SUBSCRIPTION_SUSPENDED';
        break;

      case SUBSCRIPTION_STATUS.CANCELLED:
        next.cancelledAt =
          subscription.cancelledAt ||
          now;

        next.cancelAtPeriodEnd =
          false;
        break;

      default:
        break;
    }

    const updated =
      await this.updateSubscriptionOptimistically(
        next,
        expectedVersion ??
          subscription.lifecycleVersion
      );

    await this.invalidateCache(
      updated.tenantId
    );

    this.incrementMetric(
      'stateTransitions'
    );

    return updated;
  }

  assertValidTransition(
    fromStatus,
    toStatus
  ) {
    const allowed =
      STATE_TRANSITIONS[
        fromStatus
      ] || [];

    if (
      !allowed.includes(
        toStatus
      )
    ) {
      throw this.createError(
        'INVALID_STATE_TRANSITION',
        `Subscription cannot transition from ${fromStatus} to ${toStatus}.`,
        {
          statusCode: 409,
          details: {
            fromStatus,
            toStatus,
            allowed,
          },
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Plan Changes
   * ==========================================================================
   */

  async upgradePlan(
    tenantId,
    newPlanId,
    options = {}
  ) {
    if (!this.config.allowUpgrade) {
      throw this.createError(
        'UPGRADES_DISABLED',
        'Plan upgrades are disabled.'
      );
    }

    return this.changePlan(
      tenantId,
      newPlanId,
      'upgrade',
      options
    );
  }

  async downgradePlan(
    tenantId,
    newPlanId,
    options = {}
  ) {
    if (!this.config.allowDowngrade) {
      throw this.createError(
        'DOWNGRADES_DISABLED',
        'Plan downgrades are disabled.'
      );
    }

    return this.changePlan(
      tenantId,
      newPlanId,
      'downgrade',
      options
    );
  }

  async changePlan(
    tenantId,
    newPlanId,
    changeType,
    options = {}
  ) {
    const normalizedTenantId =
      normalizeId(tenantId);

    const normalizedNewPlanId =
      normalizeId(newPlanId);

    const correlationId =
      normalizeString(
        options.correlationId
      ) ||
      crypto.randomUUID();

    try {
      this.assertTenantId(
        normalizedTenantId
      );

      this.assertPlanId(
        normalizedNewPlanId
      );

      if (
        !PLAN_CHANGE_TYPES.includes(
          changeType
        )
      ) {
        throw this.createError(
          'INVALID_PLAN_CHANGE',
          'Invalid plan change type.'
        );
      }

      const subscription =
        await this.getActiveSubscription(
          normalizedTenantId
        );

      if (!subscription) {
        throw this.createError(
          'SUBSCRIPTION_NOT_FOUND',
          'Subscription not found.',
          {
            statusCode: 404,
          }
        );
      }

      const [
        oldPlan,
        newPlan,
      ] = await Promise.all([
        this.getBillingPlan(
          subscription.planId
        ),

        this.getBillingPlan(
          normalizedNewPlanId
        ),
      ]);

      if (!oldPlan) {
        throw this.createError(
          'CURRENT_PLAN_NOT_FOUND',
          'Current subscription plan not found.'
        );
      }

      if (!newPlan) {
        throw this.createError(
          'TARGET_PLAN_NOT_FOUND',
          'Target plan not found.',
          {
            statusCode: 404,
          }
        );
      }

      this.assertPlanUsable(
        newPlan
      );

      if (
        subscription.planId ===
        normalizedNewPlanId
      ) {
        return {
          subscription,
          proration: this.zeroProration(
            newPlan.currency ||
              oldPlan.currency
          ),
          unchanged: true,
        };
      }

      const proration =
        this.calculateProration(
          oldPlan,
          newPlan,
          subscription
        );

      const operationKey =
        this.createBillingOperationKey(
          'PLAN_CHANGE',
          subscription.id,
          {
            lifecycleVersion:
              subscription.lifecycleVersion,
            fromPlanId:
              subscription.planId,
            toPlanId:
              normalizedNewPlanId,
          }
        );

      /**
       * Billing adjustment is synchronized before changing the
       * subscription plan. If billing fails, the subscription remains
       * unchanged.
       */

      const billingResult =
        await this.synchronizePlanProration({
          tenantId:
            normalizedTenantId,

          subscription,

          oldPlan,

          newPlan,

          proration,

          changeType,

          operationKey,

          correlationId,
        });

      const now = new Date();

      const updated = {
        ...subscription,

        planId:
          normalizedNewPlanId,

        updatedAt:
          now,

        lifecycleVersion:
          Number(
            subscription.lifecycleVersion || 0
          ) + 1,

        lastPlanChange: {
          changeType,

          previousPlanId:
            subscription.planId,

          newPlanId:
            normalizedNewPlanId,

          proration,

          billingOperationKey:
            operationKey,

          billingReference:
            this.extractBillingReference(
              billingResult
            ),

          changedAt:
            now,

          correlationId,
        },
      };

      const persisted =
        await this.updateSubscriptionOptimistically(
          updated,
          subscription.lifecycleVersion
        );

      await this.invalidateCache(
        normalizedTenantId
      );

      await this.audit(
        normalizedTenantId,
        `PLAN_${changeType.toUpperCase()}`,
        {
          subscriptionId:
            persisted.id,

          oldPlanId:
            oldPlan.id,

          newPlanId:
            normalizedNewPlanId,

          proration,

          billingOperationKey:
            operationKey,
        },
        {
          correlationId,
        }
      );

      await this.publishDomainEvent(
        'subscription.plan.changed',
        {
          tenantId:
            normalizedTenantId,

          subscriptionId:
            persisted.id,

          oldPlanId:
            oldPlan.id,

          newPlanId:
            normalizedNewPlanId,

          proration,

          changeType,
        },
        {
          correlationId,
        }
      );

      this.incrementMetric(
        'planChanges'
      );

      this.incrementMetric(
        changeType === 'upgrade'
          ? 'upgrades'
          : 'downgrades'
      );

      return {
        subscription:
          persisted,

        proration,

        billing:
          billingResult || null,
      };
    } catch (error) {
      this.incrementMetric(
        'failures'
      );

      this.logError(
        'Subscription plan change failed.',
        error,
        {
          tenantId:
            normalizedTenantId,
          newPlanId:
            normalizedNewPlanId,
          changeType,
          correlationId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Cancellation
   * ==========================================================================
   */

  async cancelSubscription(
    tenantId,
    immediate = false,
    options = {}
  ) {
    const normalizedTenantId =
      normalizeId(tenantId);

    const correlationId =
      normalizeString(
        options.correlationId
      ) ||
      crypto.randomUUID();

    try {
      this.assertTenantId(
        normalizedTenantId
      );

      if (
        immediate &&
        !this.config.allowImmediateCancellation
      ) {
        throw this.createError(
          'IMMEDIATE_CANCELLATION_DISABLED',
          'Immediate cancellation is disabled.'
        );
      }

      const subscription =
        await this.getActiveSubscription(
          normalizedTenantId
        );

      if (!subscription) {
        throw this.createError(
          'SUBSCRIPTION_NOT_FOUND',
          'Subscription not found.',
          {
            statusCode: 404,
          }
        );
      }

      const now = new Date();

      let updated;

      if (immediate) {
        updated =
          await this.transitionSubscriptionState(
            subscription,
            SUBSCRIPTION_STATUS.CANCELLED,
            {
              reason:
                options.reason ||
                'IMMEDIATE_CANCELLATION',

              correlationId,

              expectedVersion:
                subscription.lifecycleVersion,
            }
          );
      } else {
        const next = {
          ...subscription,

          cancelAtPeriodEnd:
            true,

          cancellationRequestedAt:
            now,

          updatedAt:
            now,

          lifecycleVersion:
            Number(
              subscription.lifecycleVersion || 0
            ) + 1,
        };

        updated =
          await this.updateSubscriptionOptimistically(
            next,
            subscription.lifecycleVersion
          );

        await this.invalidateCache(
          normalizedTenantId
        );
      }

      await this.audit(
        normalizedTenantId,
        immediate
          ? 'SUBSCRIPTION_CANCELLED'
          : 'SUBSCRIPTION_CANCELLATION_SCHEDULED',
        {
          subscriptionId:
            updated.id,

          immediate,

          status:
            updated.status,

          cancelAtPeriodEnd:
            updated.cancelAtPeriodEnd,
        },
        {
          correlationId,
        }
      );

      await this.publishDomainEvent(
        immediate
          ? 'subscription.cancelled'
          : 'subscription.cancellation.scheduled',
        updated,
        {
          correlationId,
        }
      );

      this.incrementMetric(
        'subscriptionsCancelled'
      );

      return updated;
    } catch (error) {
      this.incrementMetric(
        'failures'
      );

      this.logError(
        'Cancel subscription failed.',
        error,
        {
          tenantId:
            normalizedTenantId,
          immediate,
          correlationId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Reactivation
   * ==========================================================================
   */

  async reactivateSubscription(
    tenantId,
    options = {}
  ) {
    if (!this.config.allowReactivation) {
      throw this.createError(
        'REACTIVATION_DISABLED',
        'Subscription reactivation is disabled.'
      );
    }

    const normalizedTenantId =
      normalizeId(tenantId);

    const correlationId =
      normalizeString(
        options.correlationId
      ) ||
      crypto.randomUUID();

    try {
      this.assertTenantId(
        normalizedTenantId
      );

      const repository =
        this.getSubscriptionRepository();

      const subscription =
        await this.repositoryFindOne(
          repository,
          {
            tenantId:
              normalizedTenantId,

            status: {
              $in:
                TERMINAL_STATUSES,
            },
          }
        );

      if (!subscription) {
        throw this.createError(
          'REACTIVATABLE_SUBSCRIPTION_NOT_FOUND',
          'No cancelled or suspended subscription was found.',
          {
            statusCode: 404,
          }
        );
      }

      const plan =
        await this.getBillingPlan(
          subscription.planId
        );

      if (!plan) {
        throw this.createError(
          'PLAN_NOT_FOUND',
          'Subscription plan not found.'
        );
      }

      this.assertPlanUsable(plan);

      const now = new Date();

      const updated =
        await this.transitionSubscriptionState(
          subscription,
          SUBSCRIPTION_STATUS.ACTIVE,
          {
            reason:
              options.reason ||
              'SUBSCRIPTION_REACTIVATED',

            correlationId,

            expectedVersion:
              subscription.lifecycleVersion,

            additionalFields: {
              cancelledAt: null,

              cancelAtPeriodEnd:
                false,

              cancellationRequestedAt:
                null,

              reactivatedAt:
                now,

              currentPeriodStart:
                now,

              currentPeriodEnd:
                this.calculateNextBillingDate(
                  now,
                  plan.billingCycle
                ),
            },
          }
        );

      await this.audit(
        normalizedTenantId,
        'SUBSCRIPTION_REACTIVATED',
        {
          subscriptionId:
            updated.id,
        },
        {
          correlationId,
        }
      );

      await this.publishDomainEvent(
        'subscription.reactivated',
        updated,
        {
          correlationId,
        }
      );

      this.incrementMetric(
        'subscriptionsReactivated'
      );

      return updated;
    } catch (error) {
      this.incrementMetric(
        'failures'
      );

      this.logError(
        'Reactivate subscription failed.',
        error,
        {
          tenantId:
            normalizedTenantId,
          correlationId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Renewal Processing
   * ==========================================================================
   *
   * Renewal safety rules:
   *
   * 1. Re-read/claim subscription using lifecycleVersion.
   * 2. Check cancellation BEFORE generating an invoice.
   * 3. Trial expiry is handled explicitly.
   * 4. Billing operation uses a deterministic idempotency key.
   * 5. Period advancement happens only after billing success.
   * 6. Billing failure transitions subscription to past_due.
   *
   * ==========================================================================
   */

  async processRenewals() {
    const now = new Date();

    const repository =
      this.getSubscriptionRepository();

    const subscriptions =
      await this.repositoryFind(
        repository,
        {
          status: {
            $in: [
              SUBSCRIPTION_STATUS.TRIALING,
              SUBSCRIPTION_STATUS.ACTIVE,
            ],
          },

          currentPeriodEnd: {
            $lte: now,
          },
        },
        {
          limit:
            this.config.renewalBatchSize,
        }
      );

    const candidates =
      Array.isArray(subscriptions)
        ? subscriptions.slice(
            0,
            this.config.renewalBatchSize
          )
        : [];

    const results = {
      attempted: 0,
      succeeded: 0,
      failed: 0,
      skipped: 0,
    };

    await this.runWithConcurrency(
      candidates,
      this.config.renewalConcurrency,
      async (subscription) => {
        results.attempted++;

        this.incrementMetric(
          'renewalsAttempted'
        );

        try {
          const result =
            await this.processSingleRenewal(
              subscription
            );

          if (result?.skipped) {
            results.skipped++;

            this.incrementMetric(
              'renewalsSkipped'
            );

            return;
          }

          results.succeeded++;

          this.incrementMetric(
            'renewalsSucceeded'
          );
        } catch (error) {
          results.failed++;

          this.incrementMetric(
            'renewalsFailed'
          );

          this.logError(
            'Subscription renewal failed.',
            error,
            {
              tenantId:
                subscription.tenantId,

              subscriptionId:
                subscription.id,
            }
          );
        }
      }
    );

    return results;
  }

  async processSingleRenewal(
    subscription
  ) {
    if (
      !subscription ||
      !subscription.id
    ) {
      throw this.createError(
        'INVALID_SUBSCRIPTION',
        'Invalid subscription supplied for renewal.'
      );
    }

    /**
     * Always re-read from persistence before making a billing decision.
     */

    const current =
      await this.getSubscription(
        subscription.id
      );

    if (!current) {
      return {
        skipped: true,
        reason:
          'SUBSCRIPTION_NOT_FOUND',
      };
    }

    if (
      TERMINAL_STATUSES.includes(
        current.status
      )
    ) {
      return {
        skipped: true,
        reason:
          'TERMINAL_SUBSCRIPTION',
      };
    }

    const now = new Date();

    const periodEnd =
      toDate(
        current.currentPeriodEnd
      );

    if (periodEnd > now) {
      return {
        skipped: true,
        reason:
          'PERIOD_NOT_DUE',
      };
    }

    /**
     * Period-end cancellation MUST occur before renewal billing.
     */

    if (current.cancelAtPeriodEnd) {
      const cancelled =
        await this.transitionSubscriptionState(
          current,
          SUBSCRIPTION_STATUS.CANCELLED,
          {
            reason:
              'PERIOD_END_CANCELLATION',

            expectedVersion:
              current.lifecycleVersion,

            additionalFields: {
              cancellationEffectiveAt:
                periodEnd,
            },
          }
        );

      await this.audit(
        cancelled.tenantId,
        'SUBSCRIPTION_CANCELLED_AT_PERIOD_END',
        {
          subscriptionId:
            cancelled.id,
          effectiveAt:
            periodEnd,
        }
      );

      await this.publishDomainEvent(
        'subscription.cancelled',
        cancelled
      );

      return {
        skipped: true,
        cancelled: true,
        subscription:
          cancelled,
      };
    }

    /**
     * Trial expiry can become active without invoice generation when the
     * trial itself is the first subscription period. If the billing contract
     * requires immediate payment at trial expiry, generateInvoice is invoked.
     */

    if (
      current.status ===
      SUBSCRIPTION_STATUS.TRIALING
    ) {
      return this.processTrialExpiry(
        current
      );
    }

    const plan =
      await this.getBillingPlan(
        current.planId
      );

    if (!plan) {
      throw this.createError(
        'PLAN_NOT_FOUND',
        `Plan ${current.planId} not found.`
      );
    }

    this.assertPlanUsable(plan);

    const operationKey =
      this.createBillingOperationKey(
        'SUBSCRIPTION_RENEWAL',
        current.id,
        {
          periodStart:
            toDate(
              current.currentPeriodStart
            ).toISOString(),

          periodEnd:
            periodEnd.toISOString(),
        }
      );

    try {
      const invoice =
        await this.generateRenewalInvoice(
          current,
          plan,
          operationKey
        );

      const newPeriodStart =
        periodEnd;

      const newPeriodEnd =
        this.calculateNextBillingDate(
          newPeriodStart,
          plan.billingCycle
        );

      const next = {
        ...current,

        currentPeriodStart:
          newPeriodStart,

        currentPeriodEnd:
          newPeriodEnd,

        lastInvoiceId:
          this.extractBillingReference(
            invoice
          ),

        lastBillingOperationKey:
          operationKey,

        lastRenewedAt:
          new Date(),

        updatedAt:
          new Date(),

        lifecycleVersion:
          Number(
            current.lifecycleVersion || 0
          ) + 1,
      };

      const persisted =
        await this.updateSubscriptionOptimistically(
          next,
          current.lifecycleVersion
        );

      await this.invalidateCache(
        persisted.tenantId
      );

      await this.audit(
        persisted.tenantId,
        'SUBSCRIPTION_RENEWED',
        {
          subscriptionId:
            persisted.id,

          invoiceId:
            persisted.lastInvoiceId,

          previousPeriodEnd:
            periodEnd,

          currentPeriodStart:
            newPeriodStart,

          currentPeriodEnd:
            newPeriodEnd,

          billingOperationKey:
            operationKey,
        }
      );

      await this.publishDomainEvent(
        'subscription.renewed',
        persisted
      );

      return persisted;
    } catch (error) {
      this.incrementMetric(
        'billingFailures'
      );

      const fresh =
        await this.getSubscription(
          current.id
        );

      if (
        fresh &&
        [
          SUBSCRIPTION_STATUS.ACTIVE,
          SUBSCRIPTION_STATUS.TRIALING,
        ].includes(
          fresh.status
        )
      ) {
        const pastDue =
          await this.transitionSubscriptionState(
            fresh,
            SUBSCRIPTION_STATUS.PAST_DUE,
            {
              reason:
                'RENEWAL_BILLING_FAILED',

              expectedVersion:
                fresh.lifecycleVersion,

              additionalFields: {
                lastBillingFailure: {
                  operationKey,
                  occurredAt:
                    new Date(),
                  error:
                    serializeError(error),
                },
              },
            }
          );

        this.incrementMetric(
          'pastDueTransitions'
        );

        await this.audit(
          pastDue.tenantId,
          'SUBSCRIPTION_PAST_DUE',
          {
            subscriptionId:
              pastDue.id,
            billingOperationKey:
              operationKey,
            reason:
              'RENEWAL_BILLING_FAILED',
          }
        );

        await this.publishDomainEvent(
          'subscription.past_due',
          pastDue
        );
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Trial Expiry
   * ==========================================================================
   */

  async processTrialExpiry(
    subscription
  ) {
    const now = new Date();

    const trialEndsAt =
      subscription.trialEndsAt
        ? toDate(
            subscription.trialEndsAt
          )
        : toDate(
            subscription.currentPeriodEnd
          );

    if (trialEndsAt > now) {
      return {
        skipped: true,
        reason:
          'TRIAL_NOT_EXPIRED',
      };
    }

    /**
     * Cancellation wins over conversion/billing.
     */

    if (subscription.cancelAtPeriodEnd) {
      const cancelled =
        await this.transitionSubscriptionState(
          subscription,
          SUBSCRIPTION_STATUS.CANCELLED,
          {
            reason:
              'TRIAL_END_CANCELLATION',

            expectedVersion:
              subscription.lifecycleVersion,
          }
        );

      return {
        skipped: true,
        cancelled: true,
        subscription:
          cancelled,
      };
    }

    const plan =
      await this.getBillingPlan(
        subscription.planId
      );

    if (!plan) {
      throw this.createError(
        'PLAN_NOT_FOUND',
        'Subscription plan not found.'
      );
    }

    this.assertPlanUsable(plan);

    const operationKey =
      this.createBillingOperationKey(
        'TRIAL_CONVERSION',
        subscription.id,
        {
          trialEndsAt:
            trialEndsAt.toISOString(),
        }
      );

    try {
      /**
       * TenantBillingService owns the commercial policy.
       *
       * If no billing integration is configured and the deployment explicitly
       * allows conversion without collection, the lifecycle can still proceed.
       */

      const invoice =
        await this.generateTrialConversionInvoice(
          subscription,
          plan,
          operationKey
        );

      const activeStart =
        trialEndsAt;

      const activeEnd =
        this.calculateNextBillingDate(
          activeStart,
          plan.billingCycle
        );

      const transitioned =
        await this.transitionSubscriptionState(
          subscription,
          SUBSCRIPTION_STATUS.ACTIVE,
          {
            reason:
              'TRIAL_EXPIRED_BILLING_SUCCEEDED',

            expectedVersion:
              subscription.lifecycleVersion,

            additionalFields: {
              currentPeriodStart:
                activeStart,

              currentPeriodEnd:
                activeEnd,

              trialConvertedAt:
                new Date(),

              lastInvoiceId:
                this.extractBillingReference(
                  invoice
                ),

              lastBillingOperationKey:
                operationKey,
            },
          }
        );

      await this.audit(
        transitioned.tenantId,
        'SUBSCRIPTION_TRIAL_CONVERTED',
        {
          subscriptionId:
            transitioned.id,

          invoiceId:
            transitioned.lastInvoiceId,

          billingOperationKey:
            operationKey,
        }
      );

      await this.publishDomainEvent(
        'subscription.trial.converted',
        transitioned
      );

      return transitioned;
    } catch (error) {
      const fresh =
        await this.getSubscription(
          subscription.id
        );

      if (
        fresh &&
        fresh.status ===
          SUBSCRIPTION_STATUS.TRIALING
      ) {
        const pastDue =
          await this.transitionSubscriptionState(
            fresh,
            SUBSCRIPTION_STATUS.PAST_DUE,
            {
              reason:
                'TRIAL_CONVERSION_BILLING_FAILED',

              expectedVersion:
                fresh.lifecycleVersion,

              additionalFields: {
                lastBillingFailure: {
                  operationKey,
                  occurredAt:
                    new Date(),
                  error:
                    serializeError(error),
                },
              },
            }
          );

        this.incrementMetric(
          'pastDueTransitions'
        );

        await this.publishDomainEvent(
          'subscription.past_due',
          pastDue
        );
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Grace Period Processing
   * ==========================================================================
   *
   * Lifecycle:
 *
   *   past_due -> grace -> suspended
   *
   * `pastDueAt` is authoritative for grace calculation. `updatedAt` must not
   * be used because unrelated writes could accidentally extend the grace period.
   *
   * ==========================================================================
   */

  async processGracePeriods() {
    const repository =
      this.getSubscriptionRepository();

    const subscriptions =
      await this.repositoryFind(
        repository,
        {
          status: {
            $in: [
              SUBSCRIPTION_STATUS.PAST_DUE,
              SUBSCRIPTION_STATUS.GRACE,
            ],
          },
        },
        {
          limit:
            this.config.graceBatchSize,
        }
      );

    const candidates =
      Array.isArray(subscriptions)
        ? subscriptions.slice(
            0,
            this.config.graceBatchSize
          )
        : [];

    const results = {
      processed: 0,
      graceStarted: 0,
      suspended: 0,
      remaining: 0,
      failed: 0,
    };

    await this.runWithConcurrency(
      candidates,
      this.config.graceConcurrency,
      async (subscription) => {
        results.processed++;

        try {
          const current =
            await this.getSubscription(
              subscription.id
            );

          if (!current) {
            return;
          }

          if (
            current.status ===
            SUBSCRIPTION_STATUS.PAST_DUE
          ) {
            const grace =
              await this.transitionSubscriptionState(
                current,
                SUBSCRIPTION_STATUS.GRACE,
                {
                  reason:
                    'BILLING_GRACE_PERIOD_STARTED',

                  expectedVersion:
                    current.lifecycleVersion,
                }
              );

            this.incrementMetric(
              'gracePeriodsStarted'
            );

            results.graceStarted++;

            await this.audit(
              grace.tenantId,
              'SUBSCRIPTION_GRACE_STARTED',
              {
                subscriptionId:
                  grace.id,

                graceEndsAt:
                  grace.graceEndsAt,
              }
            );

            await this.publishDomainEvent(
              'subscription.grace.started',
              grace
            );

            results.remaining++;

            return;
          }

          if (
            current.status ===
            SUBSCRIPTION_STATUS.GRACE
          ) {
            const graceEndsAt =
              current.graceEndsAt
                ? toDate(
                    current.graceEndsAt
                  )
                : this.addDays(
                    current.pastDueAt ||
                    current.updatedAt,
                    this.config.gracePeriodDays
                  );

            if (
              new Date() >=
              graceEndsAt
            ) {
              const suspended =
                await this.transitionSubscriptionState(
                  current,
                  SUBSCRIPTION_STATUS.SUSPENDED,
                  {
                    reason:
                      'BILLING_GRACE_PERIOD_EXPIRED',

                    expectedVersion:
                      current.lifecycleVersion,
                  }
                );

              this.incrementMetric(
                'subscriptionsSuspended'
              );

              results.suspended++;

              await this.audit(
                suspended.tenantId,
                'SUBSCRIPTION_SUSPENDED',
                {
                  subscriptionId:
                    suspended.id,

                  reason:
                    suspended.suspensionReason,
                }
              );

              await this.publishDomainEvent(
                'subscription.suspended',
                suspended
              );
            } else {
              results.remaining++;
            }
          }
        } catch (error) {
          results.failed++;

          this.incrementMetric(
            'failures'
          );

          this.logError(
            'Grace period processing failed.',
            error,
            {
              tenantId:
                subscription.tenantId,

              subscriptionId:
                subscription.id,
            }
          );
        } finally {
          this.incrementMetric(
            'gracePeriodsProcessed'
          );
        }
      }
    );

    return results;
  }

  /**
   * ==========================================================================
   * Billing Recovery
   * ==========================================================================
   *
   * This can be called by TenantBillingService/webhook handlers after a payment
   * succeeds for a past-due or grace subscription.
   *
   * ==========================================================================
   */

  async recoverSubscriptionFromPayment(
    tenantId,
    {
      subscriptionId = null,
      paymentId = null,
      correlationId = null,
    } = {}
  ) {
    const normalizedTenantId =
      normalizeId(tenantId);

    this.assertTenantId(
      normalizedTenantId
    );

    let subscription;

    if (subscriptionId) {
      subscription =
        await this.getSubscription(
          subscriptionId
        );
    } else {
      subscription =
        await this.getActiveSubscription(
          normalizedTenantId
        );
    }

    if (!subscription) {
      throw this.createError(
        'SUBSCRIPTION_NOT_FOUND',
        'Subscription not found.',
        {
          statusCode: 404,
        }
      );
    }

    if (
      ![
        SUBSCRIPTION_STATUS.PAST_DUE,
        SUBSCRIPTION_STATUS.GRACE,
      ].includes(
        subscription.status
      )
    ) {
      return subscription;
    }

    const active =
      await this.transitionSubscriptionState(
        subscription,
        SUBSCRIPTION_STATUS.ACTIVE,
        {
          reason:
            'PAYMENT_RECOVERED',

          correlationId,

          expectedVersion:
            subscription.lifecycleVersion,

          additionalFields: {
            recoveredAt:
              new Date(),

            recoveryPaymentId:
              paymentId || null,
          },
        }
      );

    await this.audit(
      active.tenantId,
      'SUBSCRIPTION_PAYMENT_RECOVERED',
      {
        subscriptionId:
          active.id,
        paymentId,
      },
      {
        correlationId,
      }
    );

    await this.publishDomainEvent(
      'subscription.recovered',
      active,
      {
        correlationId,
      }
    );

    return active;
  }

  /**
   * ==========================================================================
   * Feature Access
   * ==========================================================================
   */

  async checkFeatureAccess(
    tenantId,
    feature
  ) {
    this.incrementMetric(
      'entitlementChecks'
    );

    const normalizedTenantId =
      normalizeId(tenantId);

    const normalizedFeature =
      normalizeString(
        feature
      );

    if (
      !normalizedTenantId ||
      !normalizedFeature
    ) {
      this.incrementMetric(
        'entitlementDenied'
      );

      return false;
    }

    try {
      if (
        this.featureFlagService &&
        typeof this.featureFlagService.isEnabled ===
          'function'
      ) {
        const globallyEnabled =
          await this.featureFlagService.isEnabled(
            normalizedFeature,
            {
              tenantId:
                normalizedTenantId,
            }
          );

        if (
          globallyEnabled === false
        ) {
          this.incrementMetric(
            'entitlementDenied'
          );

          return false;
        }
      }

      const subscription =
        await this.getActiveSubscription(
          normalizedTenantId
        );

      if (
        !subscription ||
        !ENTITLED_STATUSES.includes(
          subscription.status
        )
      ) {
        this.incrementMetric(
          'entitlementDenied'
        );

        return false;
      }

      const plan =
        await this.getBillingPlan(
          subscription.planId
        );

      if (!plan) {
        this.incrementMetric(
          'entitlementDenied'
        );

        return false;
      }

      const features =
        Array.isArray(
          plan.features
        )
          ? plan.features
          : [];

      const allowed =
        features.includes(
          normalizedFeature
        );

      if (!allowed) {
        this.incrementMetric(
          'entitlementDenied'
        );
      }

      return allowed;
    } catch (error) {
      this.logWarn(
        'Feature entitlement evaluation failed.',
        {
          tenantId:
            normalizedTenantId,

          feature:
            normalizedFeature,

          error:
            error.message,
        }
      );

      if (
        this.config
          .failClosedEntitlements
      ) {
        this.incrementMetric(
          'entitlementDenied'
        );

        return false;
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Usage Limits
   * ==========================================================================
   */

  async checkUsageLimit(
    tenantId,
    metric,
    value
  ) {
    this.incrementMetric(
      'usageChecks'
    );

    const normalizedTenantId =
      normalizeId(tenantId);

    const normalizedMetric =
      normalizeString(metric);

    const numericValue =
      Number(value);

    if (
      !normalizedTenantId ||
      !normalizedMetric ||
      !Number.isFinite(
        numericValue
      ) ||
      numericValue < 0 ||
      numericValue >
        this.config.maxUsageValue
    ) {
      this.incrementMetric(
        'usageDenied'
      );

      return false;
    }

    try {
      const subscription =
        await this.getActiveSubscription(
          normalizedTenantId
        );

      if (
        !subscription ||
        !ENTITLED_STATUSES.includes(
          subscription.status
        )
      ) {
        this.incrementMetric(
          'usageDenied'
        );

        return false;
      }

      const plan =
        await this.getBillingPlan(
          subscription.planId
        );

      if (!plan) {
        this.incrementMetric(
          'usageDenied'
        );

        return false;
      }

      const limits =
        isObject(plan.limits)
          ? plan.limits
          : {};

      const limit =
        limits[
          normalizedMetric
        ];

      if (
        limit === undefined ||
        limit === null
      ) {
        return true;
      }

      const numericLimit =
        Number(limit);

      if (
        !Number.isFinite(
          numericLimit
        )
      ) {
        this.incrementMetric(
          'usageDenied'
        );

        return false;
      }

      const allowed =
        numericValue <=
        numericLimit;

      if (!allowed) {
        this.incrementMetric(
          'usageDenied'
        );
      }

      return allowed;
    } catch (error) {
      if (
        this.config
          .failClosedEntitlements
      ) {
        this.incrementMetric(
          'usageDenied'
        );

        return false;
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Webhook Ingestion
   * ==========================================================================
   *
   * Important:
 *
   * processWebhook() only claims and dispatches the webhook.
 *
   * A webhook must not be marked PROCESSED until the worker/handler successfully
   * completes the actual business operation.
   *
   * ==========================================================================
   */

  async processWebhook(
    payload = {},
    options = {}
  ) {
    this.incrementMetric(
      'webhookReceived'
    );

    if (!isObject(payload)) {
      throw this.createError(
        'INVALID_WEBHOOK',
        'Webhook payload must be an object.'
      );
    }

    const webhookId =
      normalizeString(
        payload.id ||
        payload.eventId ||
        payload.webhookId
      );

    if (!webhookId) {
      throw this.createError(
        'WEBHOOK_ID_REQUIRED',
        'Webhook ID is required.'
      );
    }

    const tenantId =
      normalizeId(
        payload.tenantId
      );

    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      throw this.createError(
        'TENANT_ID_REQUIRED',
        'Webhook tenantId is required.'
      );
    }

    const correlationId =
      normalizeString(
        options.correlationId
      ) ||
      crypto.randomUUID();

    const claim =
      await this.claimWebhook(
        webhookId,
        {
          tenantId,

          type:
            normalizeString(
              payload.type ||
              payload.event
            ),

          payload,

          correlationId,
        }
      );

    if (
      !claim.claimed
    ) {
      this.incrementMetric(
        'webhookDuplicates'
      );

      return {
        success: true,

        duplicate: true,

        webhookId,

        status:
          claim.status ||
          null,
      };
    }

    this.incrementMetric(
      'webhookClaimed'
    );

    const jobPayload = {
      webhookId,

      tenantId,

      type:
        normalizeString(
          payload.type ||
          payload.event
        ),

      payload,

      receivedAt:
        new Date(),

      correlationId,
    };

    try {
      if (
        this.queueService &&
        typeof this.queueService.enqueue ===
          'function'
      ) {
        await this.queueService.enqueue(
          'subscription-webhook',
          jobPayload,
          {
            jobId:
              `subscription-webhook:${webhookId}`,

            attempts:
              this.config.webhookMaxAttempts,

            backoff: {
              type:
                'exponential',

              delay:
                this.config
                  .webhookRetryDelaySeconds *
                1000,
            },
          }
        );

        /**
         * DO NOT mark processed here.
         * The worker must call completeWebhook().
         */

        return {
          success: true,

          queued: true,

          webhookId,
        };
      }

      /**
       * Local synchronous fallback.
       */

      const result =
        await this.handleWebhook(
          jobPayload
        );

      await this.completeWebhook(
        webhookId,
        {
          result,
        }
      );

      this.incrementMetric(
        'webhookProcessed'
      );

      return {
        success: true,

        queued: false,

        webhookId,

        result,
      };
    } catch (error) {
      await this.failWebhook(
        webhookId,
        error
      );

      this.incrementMetric(
        'webhookFailed'
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Worker Entry Point
   * ==========================================================================
   *
   * Queue workers should call this method.
   *
   * On success:
 *   claim -> handle -> complete
 *
   * On failure:
 *   fail -> throw
 *
   * ==========================================================================
   */

  async processWebhookJob(
    jobPayload = {}
  ) {
    const webhookId =
      normalizeString(
        jobPayload.webhookId
      );

    if (!webhookId) {
      throw this.createError(
        'WEBHOOK_ID_REQUIRED',
        'webhookId is required.'
      );
    }

    try {
      const result =
        await this.handleWebhook(
          jobPayload
        );

      await this.completeWebhook(
        webhookId,
        {
          result,
        }
      );

      this.incrementMetric(
        'webhookProcessed'
      );

      return result;
    } catch (error) {
      await this.failWebhook(
        webhookId,
        error
      );

      this.incrementMetric(
        'webhookFailed'
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Webhook Domain Handling
   * ==========================================================================
   *
   * The concrete billing provider can supply normalized events through:
 *
   *   - subscription.payment.succeeded
   *   - invoice.paid
   *   - subscription.payment.failed
   *   - invoice.payment_failed
   *   - subscription.cancelled
   *
   * Unknown events are emitted for extension points.
   *
   * ==========================================================================
   */

  async handleWebhook(
    jobPayload
  ) {
    const type =
      normalizeString(
        jobPayload.type
      ).toLowerCase();

    const tenantId =
      normalizeId(
        jobPayload.tenantId
      );

    const payload =
      jobPayload.payload || {};

    switch (type) {
      case 'subscription.payment.succeeded':
      case 'invoice.paid':
      case 'payment.succeeded':
        return this.recoverSubscriptionFromPayment(
          tenantId,
          {
            subscriptionId:
              payload.subscriptionId,

            paymentId:
              payload.paymentId ||
              payload.id,

            correlationId:
              jobPayload.correlationId,
          }
        );

      case 'subscription.payment.failed':
      case 'invoice.payment_failed':
      case 'payment.failed':
        return this.handlePaymentFailure(
          tenantId,
          payload,
          {
            correlationId:
              jobPayload.correlationId,
          }
        );

      default:
        await this.publishDomainEvent(
          'subscription.webhook.received',
          jobPayload,
          {
            correlationId:
              jobPayload.correlationId,
          }
        );

        return {
          handled: false,

          reason:
            'UNHANDLED_WEBHOOK_TYPE',

          type,
        };
    }
  }

  async handlePaymentFailure(
    tenantId,
    payload = {},
    {
      correlationId = null,
    } = {}
  ) {
    const subscriptionId =
      normalizeId(
        payload.subscriptionId
      );

    let subscription;

    if (subscriptionId) {
      subscription =
        await this.getSubscription(
          subscriptionId
        );
    } else {
      subscription =
        await this.getActiveSubscription(
          tenantId
        );
    }

    if (!subscription) {
      throw this.createError(
        'SUBSCRIPTION_NOT_FOUND',
        'Subscription not found.',
        {
          statusCode: 404,
        }
      );
    }

    if (
      [
        SUBSCRIPTION_STATUS.PAST_DUE,
        SUBSCRIPTION_STATUS.GRACE,
        SUBSCRIPTION_STATUS.SUSPENDED,
        SUBSCRIPTION_STATUS.CANCELLED,
      ].includes(
        subscription.status
      )
    ) {
      return subscription;
    }

    const pastDue =
      await this.transitionSubscriptionState(
        subscription,
        SUBSCRIPTION_STATUS.PAST_DUE,
        {
          reason:
            payload.reason ||
            'PAYMENT_FAILED',

          correlationId,

          expectedVersion:
            subscription.lifecycleVersion,
        }
      );

    this.incrementMetric(
      'pastDueTransitions'
    );

    await this.publishDomainEvent(
      'subscription.past_due',
      pastDue,
      {
        correlationId,
      }
    );

    return pastDue;
  }

  /**
   * ==========================================================================
   * Atomic Webhook Claiming
   * ==========================================================================
   */

  async claimWebhook(
    webhookId,
    {
      tenantId = null,
      type = null,
      payload = null,
      correlationId = null,
    } = {}
  ) {
    const repository =
      this.getWebhookRepository(
        false
      );

    const now = new Date();

    const claimExpiresAt =
      new Date(
        now.getTime() +
        this.config
          .webhookClaimTimeoutSeconds *
        1000
      );

    /**
     * Preferred repository contract:
     *
     * repository.claim(webhookId, document, options)
     *
     * Return:
     *
     * {
     *   claimed: Boolean,
     *   status: 'processing' | 'processed' | ...
     * }
     */

    if (
      repository &&
      typeof repository.claim ===
        'function'
    ) {
      return repository.claim(
        webhookId,
        {
          id:
            crypto.randomUUID(),

          webhookId,

          tenantId,

          type,

          payload,

          status:
            WEBHOOK_STATUS.PROCESSING,

          correlationId,

          attempts: 1,

          claimedAt:
            now,

          claimExpiresAt,

          createdAt:
            now,

          updatedAt:
            now,
        },
        {
          reclaimExpired:
            true,

          claimExpiresAt,
        }
      );
    }

    /**
     * Mongoose-style atomic findOneAndUpdate compatibility.
     */

    if (
      repository &&
      typeof repository.findOneAndUpdate ===
        'function'
    ) {
      const document =
        await repository.findOneAndUpdate(
          {
            webhookId,

            $or: [
              {
                status: {
                  $exists:
                    false,
                },
              },
              {
                status:
                  WEBHOOK_STATUS.FAILED,
              },
              {
                status:
                  WEBHOOK_STATUS.PROCESSING,

                claimExpiresAt: {
                  $lte: now,
                },
              },
            ],
          },
          {
            $set: {
              tenantId,

              type,

              payload,

              status:
                WEBHOOK_STATUS.PROCESSING,

              correlationId,

              claimedAt:
                now,

              claimExpiresAt,

              updatedAt:
                now,
            },

            $inc: {
              attempts: 1,
            },

            $setOnInsert: {
              id:
                crypto.randomUUID(),

              webhookId,

              createdAt:
                now,
            },
          },
          {
            new: true,

            upsert: true,
          }
        );

      if (document) {
        return {
          claimed: true,

          webhook:
            document,

          status:
            WEBHOOK_STATUS.PROCESSING,
        };
      }

      return {
        claimed: false,
      };
    }

    /**
     * Generic create fallback.
     *
     * Unique webhookId must be enforced by persistence.
     */

    if (
      repository &&
      typeof repository.create ===
        'function'
    ) {
      try {
        const webhook =
          await repository.create({
            id:
              crypto.randomUUID(),

            webhookId,

            tenantId,

            type,

            payload,

            status:
              WEBHOOK_STATUS.PROCESSING,

            correlationId,

            attempts: 1,

            claimedAt:
              now,

            claimExpiresAt,

            createdAt:
              now,

            updatedAt:
              now,
          });

        return {
          claimed: true,
          webhook,
          status:
            WEBHOOK_STATUS.PROCESSING,
        };
      } catch (error) {
        if (
          this.isDuplicateKeyError(
            error
          )
        ) {
          return {
            claimed: false,
            status:
              WEBHOOK_STATUS.PROCESSING,
          };
        }

        throw error;
      }
    }

    /**
     * Cache-only fallback is intentionally not authoritative but provides
     * basic replay protection when no durable repository exists.
     */

    const cacheKey =
      this.getWebhookCacheKey(
        webhookId
      );

    if (this.cache) {
      const existing =
        await this.readCache(
          cacheKey
        );

      if (existing) {
        return {
          claimed: false,
          status:
            existing.status ||
            null,
        };
      }

      await this.writeCache(
        cacheKey,
        {
          status:
            WEBHOOK_STATUS.PROCESSING,
          claimExpiresAt,
        },
        this.config
          .webhookClaimTimeoutSeconds
      );

      return {
        claimed: true,
        status:
          WEBHOOK_STATUS.PROCESSING,
      };
    }

    throw this.createError(
      'WEBHOOK_REPOSITORY_UNAVAILABLE',
      'Atomic webhook storage is unavailable.',
      {
        statusCode: 503,
        retryable: true,
      }
    );
  }

  async completeWebhook(
    webhookId,
    {
      result = null,
    } = {}
  ) {
    const repository =
      this.getWebhookRepository(
        false
      );

    const now = new Date();

    if (
      repository &&
      typeof repository.complete ===
        'function'
    ) {
      await repository.complete(
        webhookId,
        {
          result,
          processedAt:
            now,
        }
      );
    } else if (
      repository &&
      typeof repository.updateOne ===
        'function'
    ) {
      await repository.updateOne(
        {
          webhookId,

          status:
            WEBHOOK_STATUS.PROCESSING,
        },
        {
          $set: {
            status:
              WEBHOOK_STATUS.PROCESSED,

            processedAt:
              now,

            result,

            updatedAt:
              now,
          },

          $unset: {
            claimExpiresAt: '',
          },
        }
      );
    } else if (
      repository &&
      typeof repository.update ===
        'function'
    ) {
      const existing =
        await this.repositoryFindOne(
          repository,
          {
            webhookId,
          }
        );

      if (existing) {
        await repository.update(
          existing.id,
          {
            ...existing,

            status:
              WEBHOOK_STATUS.PROCESSED,

            processedAt:
              now,

            result,

            claimExpiresAt:
              null,

            updatedAt:
              now,
          }
        );
      }
    }

    await this.writeCache(
      this.getWebhookCacheKey(
        webhookId
      ),
      {
        status:
          WEBHOOK_STATUS.PROCESSED,
      },
      this.config.webhookCacheTtl
    );
  }

  async failWebhook(
    webhookId,
    error
  ) {
    const repository =
      this.getWebhookRepository(
        false
      );

    const now = new Date();

    if (
      repository &&
      typeof repository.fail ===
        'function'
    ) {
      await repository.fail(
        webhookId,
        {
          error:
            serializeError(error),

          failedAt:
            now,
        }
      );
    } else if (
      repository &&
      typeof repository.updateOne ===
        'function'
    ) {
      await repository.updateOne(
        {
          webhookId,
        },
        {
          $set: {
            status:
              WEBHOOK_STATUS.FAILED,

            lastError:
              serializeError(error),

            failedAt:
              now,

            updatedAt:
              now,

            claimExpiresAt:
              new Date(
                now.getTime() +
                this.config
                  .webhookRetryDelaySeconds *
                1000
              ),
          },
        }
      );
    }

    await this.writeCache(
      this.getWebhookCacheKey(
        webhookId
      ),
      {
        status:
          WEBHOOK_STATUS.FAILED,
      },
      Math.min(
        this.config.webhookRetryDelaySeconds,
        300
      )
    );
  }

  /**
   * ==========================================================================
   * Backward-Compatible Webhook Idempotency Methods
   * ==========================================================================
   */

  async isWebhookProcessed(
    webhookId
  ) {
    const cacheKey =
      this.getWebhookCacheKey(
        webhookId
      );

    const cached =
      await this.readCache(
        cacheKey
      );

    if (
      cached &&
      cached.status ===
        WEBHOOK_STATUS.PROCESSED
    ) {
      return true;
    }

    const repository =
      this.getWebhookRepository(
        false
      );

    if (!repository) {
      return false;
    }

    const existing =
      await this.repositoryFindOne(
        repository,
        {
          webhookId,

          status:
            WEBHOOK_STATUS.PROCESSED,
        }
      );

    return Boolean(existing);
  }

  async markWebhookProcessed(
    webhookId
  ) {
    return this.completeWebhook(
      webhookId
    );
  }

  /**
   * ==========================================================================
   * Metrics API
   * ==========================================================================
   */

  async getMetrics() {
    const repository =
      this.getSubscriptionRepository();

    const countByStatus =
      async (status) => {
        return this.repositoryCount(
          repository,
          {
            status,
          }
        );
      };

    const [
      active,
      cancelled,
      suspended,
      trialing,
      pastDue,
      grace,
    ] = await Promise.all([
      countByStatus(
        SUBSCRIPTION_STATUS.ACTIVE
      ),

      countByStatus(
        SUBSCRIPTION_STATUS.CANCELLED
      ),

      countByStatus(
        SUBSCRIPTION_STATUS.SUSPENDED
      ),

      countByStatus(
        SUBSCRIPTION_STATUS.TRIALING
      ),

      countByStatus(
        SUBSCRIPTION_STATUS.PAST_DUE
      ),

      countByStatus(
        SUBSCRIPTION_STATUS.GRACE
      ),
    ]);

    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      subscriptions: {
        active,
        cancelled,
        suspended,
        trialing,
        pastDue,
        grace,
      },

      ...this.metrics,

      timestamp:
        new Date().toISOString(),
    };
  }

  /**
   * ==========================================================================
   * Billing Plan Helpers
   * ==========================================================================
   */

  async getBillingPlan(
    planId
  ) {
    const repository =
      this.getBillingPlanRepository();

    return this.repositoryFindById(
      repository,
      planId
    );
  }

  assertPlanUsable(
    plan
  ) {
    if (!plan) {
      throw this.createError(
        'PLAN_NOT_FOUND',
        'Billing plan not found.'
      );
    }

    const cycle =
      normalizeString(
        plan.billingCycle
      ).toLowerCase();

    if (
      this.config.requireBillingCycle &&
      !BILLING_CYCLES.includes(
        cycle
      )
    ) {
      throw this.createError(
        'INVALID_BILLING_CYCLE',
        'Billing plan has an invalid billing cycle.'
      );
    }

    if (
      plan.active === false ||
      [
        'archived',
        'disabled',
        'inactive',
      ].includes(
        normalizeString(
          plan.status
        ).toLowerCase()
      )
    ) {
      throw this.createError(
        'PLAN_UNAVAILABLE',
        'Billing plan is not available.'
      );
    }

    if (
      plan.price !== undefined
    ) {
      this.toMinorUnits(
        plan.price
      );
    }
  }

  resolveTrialDays(
    plan
  ) {
    const value =
      plan.trialDays !==
      undefined
        ? Number(
            plan.trialDays
          )
        : Number(
            this.config.trialDays
          );

    if (
      !Number.isFinite(value) ||
      value <= 0
    ) {
      return 0;
    }

    return Math.floor(
      value
    );
  }

  /**
   * ==========================================================================
   * Billing Synchronization
   * ==========================================================================
   */

  async generateRenewalInvoice(
    subscription,
    plan,
    operationKey
  ) {
    const billing =
      this.requireBillingService();

    if (
      typeof billing.generateSubscriptionRenewal ===
      'function'
    ) {
      return billing.generateSubscriptionRenewal(
        subscription.tenantId,
        {
          subscriptionId:
            subscription.id,

          planId:
            subscription.planId,

          billingPeriodStart:
            subscription.currentPeriodStart,

          billingPeriodEnd:
            subscription.currentPeriodEnd,

          idempotencyKey:
            operationKey,

          correlationId:
            subscription.correlationId ||
            null,
        }
      );
    }

    if (
      typeof billing.generateInvoice ===
      'function'
    ) {
      return billing.generateInvoice(
        subscription.tenantId,
        {
          subscriptionId:
            subscription.id,

          planId:
            subscription.planId,

          billingPeriodStart:
            subscription.currentPeriodStart,

          billingPeriodEnd:
            subscription.currentPeriodEnd,

          idempotencyKey:
            operationKey,

          operationType:
            'SUBSCRIPTION_RENEWAL',
        }
      );
    }

    throw this.createError(
      'BILLING_SERVICE_CONTRACT_UNSUPPORTED',
      'TenantBillingService does not expose a supported renewal contract.',
      {
        statusCode: 503,
        retryable: false,
      }
    );
  }

  async generateTrialConversionInvoice(
    subscription,
    plan,
    operationKey
  ) {
    if (
      !this.tenantBillingService
    ) {
      if (
        this.config.allowRenewalWithoutCollection
      ) {
        return null;
      }

      if (
        this.config.requireBillingServiceForRenewal
      ) {
        throw this.createError(
          'BILLING_SERVICE_UNAVAILABLE',
          'Tenant billing service is unavailable.',
          {
            statusCode: 503,
            retryable: true,
          }
        );
      }

      return null;
    }

    return this.generateRenewalInvoice(
      {
        ...subscription,

        currentPeriodStart:
          subscription.trialEndsAt ||
          subscription.currentPeriodEnd,

        currentPeriodEnd:
          this.calculateNextBillingDate(
            subscription.trialEndsAt ||
            subscription.currentPeriodEnd,
            plan.billingCycle
          ),
      },
      plan,
      operationKey
    );
  }

  async synchronizePlanProration({
    tenantId,
    subscription,
    oldPlan,
    newPlan,
    proration,
    changeType,
    operationKey,
    correlationId,
  }) {
    if (
      !this.tenantBillingService
    ) {
      if (
        proration.differenceMinor === 0
      ) {
        return null;
      }

      throw this.createError(
        'BILLING_SERVICE_UNAVAILABLE',
        'Tenant billing service is required for billable plan changes.',
        {
          statusCode: 503,
          retryable: true,
        }
      );
    }

    const billing =
      this.tenantBillingService;

    const request = {
      subscriptionId:
        subscription.id,

      oldPlanId:
        oldPlan.id,

      newPlanId:
        newPlan.id,

      changeType,

      proration,

      idempotencyKey:
        operationKey,

      correlationId,
    };

    if (
      typeof billing.applySubscriptionProration ===
      'function'
    ) {
      return billing.applySubscriptionProration(
        tenantId,
        request
      );
    }

    if (
      typeof billing.createProrationAdjustment ===
      'function'
    ) {
      return billing.createProrationAdjustment(
        tenantId,
        request
      );
    }

    if (
      typeof billing.generateInvoice ===
      'function'
    ) {
      if (
        proration.differenceMinor === 0
      ) {
        return null;
      }

      return billing.generateInvoice(
        tenantId,
        {
          subscriptionId:
            subscription.id,

          operationType:
            'SUBSCRIPTION_PRORATION',

          idempotencyKey:
            operationKey,

          proration,
        }
      );
    }

    throw this.createError(
      'BILLING_SERVICE_CONTRACT_UNSUPPORTED',
      'TenantBillingService does not expose a supported proration contract.'
    );
  }

  requireBillingService() {
    if (
      !this.tenantBillingService
    ) {
      throw this.createError(
        'BILLING_SERVICE_UNAVAILABLE',
        'Tenant billing service is unavailable.',
        {
          statusCode: 503,
          retryable: true,
        }
      );
    }

    return this.tenantBillingService;
  }

  createBillingOperationKey(
    operation,
    subscriptionId,
    payload = {}
  ) {
    const fingerprint =
      createHash({
        operation,
        subscriptionId,
        payload,
      }).slice(0, 32);

    return [
      'SUBSCRIPTION',
      operation,
      subscriptionId,
      fingerprint,
    ].join(':');
  }

  extractBillingReference(
    result
  ) {
    if (!result) {
      return null;
    }

    return (
      result.invoiceId ||
      result.id ||
      result.reference ||
      result.paymentId ||
      result.billingId ||
      null
    );
  }

  /**
   * ==========================================================================
   * Subscription Persistence
   * ==========================================================================
   */

  async createSubscriptionAtomically(
    subscription
  ) {
    const repository =
      this.getSubscriptionRepository();

    /**
     * Preferred repository contract:
     *
     * createIfAbsent({ tenantId, idempotencyKey, document })
     */

    if (
      typeof repository.createIfAbsent ===
      'function'
    ) {
      return repository.createIfAbsent({
        tenantId:
          subscription.tenantId,

        idempotencyKey:
          subscription.idempotencyKey,

        document:
          subscription,
      });
    }

    try {
      return await this.repositoryCreate(
        repository,
        subscription
      );
    } catch (error) {
      if (
        this.isDuplicateKeyError(
          error
        )
      ) {
        if (
          subscription.idempotencyKey
        ) {
          const existing =
            await this.findByIdempotencyKey(
              subscription.tenantId,
              subscription.idempotencyKey
            );

          if (existing) {
            return existing;
          }
        }

        const existingOperational =
          await this.findOperationalSubscription(
            subscription.tenantId
          );

        if (existingOperational) {
          return existingOperational;
        }
      }

      throw error;
    }
  }

  /**
   * Backward-compatible method.
   */

  async createSubscriptionRecord(
    subscription
  ) {
    return this.createSubscriptionAtomically(
      subscription
    );
  }

  async updateSubscription(
    subscription
  ) {
    return this.updateSubscriptionOptimistically(
      subscription,
      subscription.lifecycleVersion !== undefined
        ? Number(
            subscription.lifecycleVersion
          ) - 1
        : null
    );
  }

  async updateSubscriptionOptimistically(
    subscription,
    expectedVersion = null
  ) {
    const repository =
      this.getSubscriptionRepository();

    const currentVersion =
      expectedVersion === null ||
      expectedVersion === undefined
        ? null
        : Number(
            expectedVersion
          );

    if (
      currentVersion !== null &&
      !Number.isFinite(
        currentVersion
      )
    ) {
      throw this.createError(
        'INVALID_LIFECYCLE_VERSION',
        'Expected lifecycle version is invalid.'
      );
    }

    /**
     * Preferred repository contract.
     */

    if (
      typeof repository.updateWithVersion ===
      'function'
    ) {
      const result =
        await repository.updateWithVersion(
          subscription.id,
          currentVersion,
          subscription
        );

      return this.assertOptimisticUpdate(
        result,
        subscription,
        currentVersion
      );
    }

    /**
     * Mongoose / Mongo-compatible atomic update.
     */

    if (
      typeof repository.findOneAndUpdate ===
      'function' &&
      currentVersion !== null
    ) {
      const result =
        await repository.findOneAndUpdate(
          {
            id:
              subscription.id,

            lifecycleVersion:
              currentVersion,
          },
          {
            $set:
              subscription,
          },
          {
            new: true,
          }
        );

      return this.assertOptimisticUpdate(
        result,
        subscription,
        currentVersion
      );
    }

    if (
      typeof repository.updateOne ===
      'function' &&
      currentVersion !== null
    ) {
      const result =
        await repository.updateOne(
          {
            id:
              subscription.id,

            lifecycleVersion:
              currentVersion,
          },
          {
            $set:
              subscription,
          }
        );

      const modified =
        result?.modifiedCount ??
        result?.matchedCount ??
        0;

      if (!modified) {
        this.incrementMetric(
          'concurrencyConflicts'
        );

        throw this.createError(
          'SUBSCRIPTION_CONCURRENCY_CONFLICT',
          'Subscription was modified by another operation.',
          {
            statusCode: 409,
            retryable: true,
            details: {
              subscriptionId:
                subscription.id,
              expectedVersion:
                currentVersion,
            },
          }
        );
      }

      return this.getSubscription(
        subscription.id
      );
    }

    /**
     * Generic repository fallback.
     */

    if (
      typeof repository.update ===
      'function'
    ) {
      if (
        currentVersion !== null &&
        this.config
          .optimisticConcurrencyRequired
      ) {
        throw this.createError(
          'OPTIMISTIC_CONCURRENCY_UNSUPPORTED',
          'Subscription repository does not support versioned updates.',
          {
            statusCode: 503,
          }
        );
      }

      const result =
        await repository.update(
          subscription.id,
          subscription
        );

      return result ||
        subscription;
    }

    throw this.createError(
      'SUBSCRIPTION_REPOSITORY_UNAVAILABLE',
      'Subscription repository does not support updates.',
      {
        statusCode: 503,
      }
    );
  }

  assertOptimisticUpdate(
    result,
    fallback,
    expectedVersion
  ) {
    if (
      result === null ||
      result === undefined ||
      result === false
    ) {
      this.incrementMetric(
        'concurrencyConflicts'
      );

      throw this.createError(
        'SUBSCRIPTION_CONCURRENCY_CONFLICT',
        'Subscription was modified by another operation.',
        {
          statusCode: 409,
          retryable: true,
          details: {
            subscriptionId:
              fallback.id,
            expectedVersion,
          },
        }
      );
    }

    return result;
  }

  async findByIdempotencyKey(
    tenantId,
    idempotencyKey
  ) {
    const key =
      normalizeString(
        idempotencyKey
      );

    if (!key) {
      return null;
    }

    const repository =
      this.getSubscriptionRepository();

    return this.repositoryFindOne(
      repository,
      {
        tenantId,
        idempotencyKey:
          key,
      }
    );
  }

  /**
   * ==========================================================================
   * Billing Dates
   * ==========================================================================
   */

  calculateNextBillingDate(
    start,
    cycle
  ) {
    const date =
      cloneDate(start);

    const normalizedCycle =
      normalizeString(
        cycle
      ).toLowerCase();

    if (
      !BILLING_CYCLES.includes(
        normalizedCycle
      )
    ) {
      throw this.createError(
        'INVALID_BILLING_CYCLE',
        `Unsupported billing cycle: ${cycle}`
      );
    }

    const originalDay =
      date.getDate();

    switch (
      normalizedCycle
    ) {
      case 'yearly':
        date.setFullYear(
          date.getFullYear() + 1
        );
        break;

      case 'quarterly':
        this.addMonthsSafely(
          date,
          3,
          originalDay
        );
        break;

      case 'monthly':
        this.addMonthsSafely(
          date,
          1,
          originalDay
        );
        break;

      case 'weekly':
        date.setDate(
          date.getDate() + 7
        );
        break;

      default:
        break;
    }

    return date;
  }

  addMonthsSafely(
    date,
    months,
    originalDay
  ) {
    date.setDate(1);

    date.setMonth(
      date.getMonth() + months
    );

    const lastDay =
      new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
      ).getDate();

    date.setDate(
      Math.min(
        originalDay,
        lastDay
      )
    );

    return date;
  }

  addDays(
    value,
    days
  ) {
    const date =
      cloneDate(value);

    date.setDate(
      date.getDate() +
      Number(days)
    );

    return date;
  }

  /**
   * ==========================================================================
   * Money-Safe Proration
   * ==========================================================================
   *
   * Monetary arithmetic is performed in integer minor units.
   *
   * Returned fields retain backward compatibility:
 *
   *   credit
   *   charge
   *   difference
   *
   * Additional authoritative integer fields:
 *
   *   creditMinor
   *   chargeMinor
   *   differenceMinor
   *
   * ==========================================================================
   */

  calculateProration(
    oldPlan,
    newPlan,
    subscription,
    now = new Date()
  ) {
    if (
      !oldPlan ||
      !newPlan ||
      !subscription
    ) {
      throw this.createError(
        'INVALID_PRORATION_INPUT',
        'Invalid proration input.'
      );
    }

    const periodStart =
      toDate(
        subscription.currentPeriodStart
      );

    const periodEnd =
      toDate(
        subscription.currentPeriodEnd
      );

    const totalMilliseconds =
      periodEnd.getTime() -
      periodStart.getTime();

    const remainingMilliseconds =
      Math.max(
        0,
        periodEnd.getTime() -
        toDate(now).getTime()
      );

    const currency =
      newPlan.currency ||
      oldPlan.currency ||
      this.config.currency;

    if (
      totalMilliseconds <= 0
    ) {
      return this.zeroProration(
        currency
      );
    }

    const ratio =
      Math.min(
        1,
        remainingMilliseconds /
          totalMilliseconds
      );

    const oldPriceMinor =
      this.toMinorUnits(
        oldPlan.price || 0
      );

    const newPriceMinor =
      this.toMinorUnits(
        newPlan.price || 0
      );

    const creditMinor =
      Math.round(
        oldPriceMinor * ratio
      );

    const chargeMinor =
      Math.round(
        newPriceMinor * ratio
      );

    const differenceMinor =
      chargeMinor -
      creditMinor;

    return {
      credit:
        this.fromMinorUnits(
          creditMinor
        ),

      charge:
        this.fromMinorUnits(
          chargeMinor
        ),

      difference:
        this.fromMinorUnits(
          differenceMinor
        ),

      creditMinor,

      chargeMinor,

      differenceMinor,

      ratio,

      currency,
    };
  }

  zeroProration(
    currency =
      this.config.currency
  ) {
    return {
      credit: 0,
      charge: 0,
      difference: 0,

      creditMinor: 0,
      chargeMinor: 0,
      differenceMinor: 0,

      ratio: 0,

      currency,
    };
  }

  toMinorUnits(
    amount
  ) {
    const value =
      Number(amount);

    if (
      !Number.isFinite(value)
    ) {
      throw this.createError(
        'INVALID_PLAN_PRICE',
        'Plan price must be numeric.'
      );
    }

    const factor =
      10 **
      Number(
        this.config.moneyPrecision
      );

    const minor =
      Math.round(
        (
          value +
          Number.EPSILON
        ) *
        factor
      );

    if (
      !safeInteger(minor)
    ) {
      throw this.createError(
        'INVALID_MONEY_VALUE',
        'Monetary value exceeds safe integer precision.'
      );
    }

    return minor;
  }

  fromMinorUnits(
    minor
  ) {
    if (
      !safeInteger(minor)
    ) {
      throw this.createError(
        'INVALID_MONEY_VALUE',
        'Minor monetary value is invalid.'
      );
    }

    const factor =
      10 **
      Number(
        this.config.moneyPrecision
      );

    return minor / factor;
  }

  roundMoney(
    amount
  ) {
    return this.fromMinorUnits(
      this.toMinorUnits(
        amount
      )
    );
  }

  /**
   * ==========================================================================
   * Cache
   * ==========================================================================
   *
   * Supports cache clients that:
 *
   *   - accept native objects
   *   - require JSON strings
   *   - expose set(key, value, ttl)
   *   - expose set(key, value, { EX: ttl })
   *
   * ==========================================================================
   */

  getCacheKey(
    tenantId
  ) {
    return [
      this.config.cachePrefix,
      'tenant',
      tenantId,
      'active',
    ].join(':');
  }

  getWebhookCacheKey(
    webhookId
  ) {
    return [
      this.config.cachePrefix,
      'webhook',
      webhookId,
    ].join(':');
  }

  async readCache(
    key
  ) {
    if (!this.cache) {
      return null;
    }

    try {
      const value =
        await this.cache.get(key);

      if (
        value === null ||
        value === undefined
      ) {
        return null;
      }

      if (
        Buffer.isBuffer(value)
      ) {
        return this.deserializeCacheValue(
          value.toString('utf8')
        );
      }

      if (
        typeof value === 'string'
      ) {
        return this.deserializeCacheValue(
          value
        );
      }

      return value;
    } catch (error) {
      this.incrementMetric(
        'cacheFailures'
      );

      this.logWarn(
        'Subscription cache read failed.',
        {
          key,
          error:
            error.message,
        }
      );

      return null;
    }
  }

  deserializeCacheValue(
    value
  ) {
    if (
      typeof value !== 'string'
    ) {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch (error) {
      return value;
    }
  }

  async writeCache(
    key,
    value,
    ttlSeconds
  ) {
    if (!this.cache) {
      return;
    }

    try {
      const serialized =
        JSON.stringify(value);

      try {
        await this.cache.set(
          key,
          serialized,
          ttlSeconds
        );
      } catch (firstError) {
        await this.cache.set(
          key,
          serialized,
          {
            EX:
              ttlSeconds,
          }
        );
      }
    } catch (error) {
      this.incrementMetric(
        'cacheFailures'
      );

      this.logWarn(
        'Subscription cache write failed.',
        {
          key,
          error:
            error.message,
        }
      );
    }
  }

  async invalidateCache(
    tenantId
  ) {
    if (!this.cache) {
      return;
    }

    try {
      const key =
        this.getCacheKey(
          tenantId
        );

      if (
        typeof this.cache.del ===
        'function'
      ) {
        await this.cache.del(key);
      } else if (
        typeof this.cache.delete ===
        'function'
      ) {
        await this.cache.delete(key);
      }
    } catch (error) {
      this.incrementMetric(
        'cacheFailures'
      );

      this.logWarn(
        'Subscription cache invalidation failed.',
        {
          tenantId,
          error:
            error.message,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Durable Events / Outbox
   * ==========================================================================
   */

  async publishDomainEvent(
    eventName,
    payload,
    context = {}
  ) {
    if (
      !this.config.emitEvents
    ) {
      return null;
    }

    const event = {
      eventId:
        crypto.randomUUID(),

      eventName,

      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      tenantId:
        payload?.tenantId ||
        context.tenantId ||
        null,

      subscriptionId:
        payload?.id ||
        payload?.subscriptionId ||
        payload?.subscription?.id ||
        null,

      correlationId:
        context.correlationId ||
        payload?.correlationId ||
        null,

      idempotencyKey:
        context.idempotencyKey ||
        null,

      payload,

      occurredAt:
        new Date().toISOString(),
    };

    let durablePublished = false;

    try {
      if (
        this.outboxService &&
        typeof this.outboxService.enqueue ===
          'function'
      ) {
        await this.outboxService.enqueue(
          event
        );

        durablePublished = true;
      } else if (
        this.outboxService &&
        typeof this.outboxService.publish ===
          'function'
      ) {
        await this.outboxService.publish(
          event
        );

        durablePublished = true;
      } else if (
        this.db?.subscriptionOutbox &&
        typeof this.db.subscriptionOutbox.create ===
          'function'
      ) {
        await this.db.subscriptionOutbox.create(
          {
            ...event,

            status:
              'pending',

            createdAt:
              new Date(),
          }
        );

        durablePublished = true;
      }

      /**
       * Local EventEmitter remains backward-compatible.
       */

      this.emit(
        eventName,
        event
      );

      if (
        this.eventBus &&
        typeof this.eventBus.publish ===
          'function'
      ) {
        await this.eventBus.publish(
          eventName,
          event
        );
      }

      this.incrementMetric(
        'eventsPublished'
      );

      return {
        event,
        durable:
          durablePublished,
      };
    } catch (error) {
      this.incrementMetric(
        'eventPublicationFailures'
      );

      this.logError(
        'Subscription event publication failed.',
        error,
        {
          eventName,
          eventId:
            event.eventId,
        }
      );

      if (
        this.config.requireDurableEvents
      ) {
        throw this.createError(
          'EVENT_PUBLICATION_FAILED',
          'Durable subscription event publication failed.',
          {
            statusCode: 503,
            retryable: true,
            cause: error,
          }
        );
      }

      return {
        event,
        durable: false,
        error:
          serializeError(error),
      };
    }
  }

  /**
   * Backward-compatible synchronous event API.
   */

  emitEvent(
    eventName,
    payload,
    context = {}
  ) {
    this.publishDomainEvent(
      eventName,
      payload,
      context
    ).catch(
      (error) => {
        this.logError(
          'Asynchronous subscription event publication failed.',
          error,
          {
            eventName,
          }
        );
      }
    );
  }

  /**
   * ==========================================================================
   * Audit
   * ==========================================================================
   */

  async audit(
    tenantId,
    action,
    payload = {},
    context = {}
  ) {
    if (!this.auditService) {
      if (
        this.config.auditRequired
      ) {
        this.logWarn(
          'Audit service unavailable.',
          {
            tenantId,
            action,
          }
        );
      }

      return;
    }

    try {
      if (
        typeof this.auditService.log !==
        'function'
      ) {
        throw this.createError(
          'AUDIT_SERVICE_CONTRACT_UNSUPPORTED',
          'Audit service does not expose log().'
        );
      }

      await this.auditService.log({
        tenantId,

        action,

        payload,

        correlationId:
          context.correlationId ||
          null,

        service:
          SERVICE_NAME,

        serviceVersion:
          SERVICE_VERSION,

        timestamp:
          new Date(),
      });
    } catch (error) {
      this.incrementMetric(
        'auditFailures'
      );

      this.logError(
        'Subscription audit failed.',
        error,
        {
          tenantId,
          action,
        }
      );

      if (
        this.config.auditRequired &&
        this.config.failClosedAudit
      ) {
        throw error;
      }
    }
  }

  /**
   * ==========================================================================
   * Repository Compatibility Layer
   * ==========================================================================
   */

  getSubscriptionRepository() {
    if (
      !this.db ||
      !this.db.subscriptions
    ) {
      throw this.createError(
        'SUBSCRIPTION_REPOSITORY_UNAVAILABLE',
        'Subscription repository is unavailable.',
        {
          statusCode: 503,
          retryable: true,
        }
      );
    }

    return this.db.subscriptions;
  }

  getBillingPlanRepository() {
    if (
      !this.db ||
      !this.db.billingPlans
    ) {
      throw this.createError(
        'BILLING_PLAN_REPOSITORY_UNAVAILABLE',
        'Billing plan repository is unavailable.',
        {
          statusCode: 503,
          retryable: true,
        }
      );
    }

    return this.db.billingPlans;
  }

  getWebhookRepository(
    required = true
  ) {
    const repository =
      this.db?.subscriptionWebhooks ||
      this.db?.webhooks ||
      null;

    if (
      required &&
      !repository
    ) {
      throw this.createError(
        'WEBHOOK_REPOSITORY_UNAVAILABLE',
        'Subscription webhook repository is unavailable.',
        {
          statusCode: 503,
          retryable: true,
        }
      );
    }

    return repository;
  }

  async repositoryFindById(
    repository,
    id
  ) {
    if (
      typeof repository.findById ===
      'function'
    ) {
      return repository.findById(id);
    }

    if (
      typeof repository.findOne ===
      'function'
    ) {
      return repository.findOne({
        id,
      });
    }

    throw this.createError(
      'REPOSITORY_METHOD_UNSUPPORTED',
      'Repository does not support findById/findOne.'
    );
  }

  async repositoryFindOne(
    repository,
    query
  ) {
    if (
      typeof repository.findOne !==
      'function'
    ) {
      throw this.createError(
        'REPOSITORY_METHOD_UNSUPPORTED',
        'Repository does not support findOne.'
      );
    }

    return repository.findOne(
      query
    );
  }

  async repositoryFind(
    repository,
    query,
    options = {}
  ) {
    if (
      typeof repository.find !==
      'function'
    ) {
      throw this.createError(
        'REPOSITORY_METHOD_UNSUPPORTED',
        'Repository does not support find.'
      );
    }

    const result =
      await repository.find(
        query,
        options
      );

    return Array.isArray(result)
      ? result
      : result?.items ||
        result?.data ||
        [];
  }

  async repositoryCreate(
    repository,
    document
  ) {
    if (
      typeof repository.create !==
      'function'
    ) {
      throw this.createError(
        'REPOSITORY_METHOD_UNSUPPORTED',
        'Repository does not support create.'
      );
    }

    return repository.create(
      document
    );
  }

  async repositoryCount(
    repository,
    query
  ) {
    if (
      typeof repository.count ===
      'function'
    ) {
      return repository.count(
        query
      );
    }

    if (
      typeof repository.countDocuments ===
      'function'
    ) {
      return repository.countDocuments(
        query
      );
    }

    const records =
      await this.repositoryFind(
        repository,
        query
      );

    return records.length;
  }

  /**
   * ==========================================================================
   * Concurrency Helpers
   * ==========================================================================
   */

  async runWithConcurrency(
    items,
    concurrency,
    worker
  ) {
    const list =
      Array.isArray(items)
        ? items
        : [];

    const limit =
      Math.max(
        1,
        Math.floor(
          Number(concurrency) || 1
        )
      );

    let cursor = 0;

    const runners =
      Array.from(
        {
          length:
            Math.min(
              limit,
              list.length
            ),
        },
        async () => {
          while (true) {
            const index =
              cursor++;

            if (
              index >=
              list.length
            ) {
              return;
            }

            await worker(
              list[index],
              index
            );
          }
        }
      );

    await Promise.all(
      runners
    );
  }

  /**
   * ==========================================================================
   * Validation
   * ==========================================================================
   */

  assertTenantId(
    tenantId
  ) {
    if (
      this.config.requireTenantId &&
      !normalizeId(
        tenantId
      )
    ) {
      throw this.createError(
        'TENANT_ID_REQUIRED',
        'tenantId is required.'
      );
    }
  }

  assertPlanId(
    planId
  ) {
    if (
      this.config.requirePlanId &&
      !normalizeId(
        planId
      )
    ) {
      throw this.createError(
        'PLAN_ID_REQUIRED',
        'planId is required.'
      );
    }
  }

  /**
   * ==========================================================================
   * Errors
   * ==========================================================================
   */

  createError(
    code,
    message,
    options = {}
  ) {
    return new SubscriptionDomainError(
      code,
      message,
      options
    );
  }

  isDuplicateKeyError(
    error
  ) {
    return Boolean(
      error &&
      (
        error.code === 11000 ||
        error.codeName ===
          'DuplicateKey' ||
        error.code ===
          'DUPLICATE_KEY'
      )
    );
  }

  /**
   * ==========================================================================
   * Logging
   * ==========================================================================
   */

  logInfo(
    message,
    metadata = {}
  ) {
    if (
      this.logger &&
      typeof this.logger.info ===
        'function'
    ) {
      this.logger.info(
        message,
        {
          service:
            SERVICE_NAME,

          version:
            SERVICE_VERSION,

          ...metadata,
        }
      );
    }
  }

  logWarn(
    message,
    metadata = {}
  ) {
    if (
      this.logger &&
      typeof this.logger.warn ===
        'function'
    ) {
      this.logger.warn(
        message,
        {
          service:
            SERVICE_NAME,

          version:
            SERVICE_VERSION,

          ...metadata,
        }
      );
    }
  }

  logError(
    message,
    error,
    metadata = {}
  ) {
    if (
      this.logger &&
      typeof this.logger.error ===
        'function'
    ) {
      this.logger.error(
        message,
        {
          service:
            SERVICE_NAME,

          version:
            SERVICE_VERSION,

          error:
            serializeError(error),

          ...metadata,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Health
   * ==========================================================================
   */

  async healthCheck() {
    const dependencies = {
      database:
        this.checkDatabaseDependency(),

      subscriptions:
        this.checkSubscriptionRepository(),

      billingPlans:
        this.checkBillingPlanRepository(),

      billing:
        this.checkBillingDependency(),

      cache:
        this.checkDependency(
          this.cache,
          [
            'get',
            'set',
          ]
        ),

      queue:
        this.checkDependency(
          this.queueService,
          [
            'enqueue',
          ]
        ),

      audit:
        this.checkDependency(
          this.auditService,
          [
            'log',
          ]
        ),

      notifications:
        Boolean(
          this.notificationService
        ),

      featureFlags:
        Boolean(
          this.featureFlagService
        ),

      eventBus:
        this.checkDependency(
          this.eventBus,
          [
            'publish',
          ]
        ),

      outbox:
        Boolean(
          this.outboxService ||
          this.db?.subscriptionOutbox
        ),

      webhookRepository:
        Boolean(
          this.getWebhookRepository(
            false
          )
        ),
    };

    const requiredHealthy =
      dependencies.database &&
      dependencies.subscriptions &&
      dependencies.billingPlans;

    const billingHealthy =
      !this.config.requireBillingServiceForRenewal ||
      dependencies.billing;

    return {
      healthy:
        requiredHealthy &&
        billingHealthy,

      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      dependencies,

      configuration: {
        renewalConcurrency:
          this.config
            .renewalConcurrency,

        graceConcurrency:
          this.config
            .graceConcurrency,

        renewalBatchSize:
          this.config
            .renewalBatchSize,

        graceBatchSize:
          this.config
            .graceBatchSize,

        optimisticConcurrencyRequired:
          this.config
            .optimisticConcurrencyRequired,

        requireDurableEvents:
          this.config
            .requireDurableEvents,
      },

      timestamp:
        new Date().toISOString(),
    };
  }

  checkDatabaseDependency() {
    return Boolean(
      this.db
    );
  }

  checkSubscriptionRepository() {
    try {
      const repository =
        this.getSubscriptionRepository();

      return Boolean(
        repository &&
        (
          typeof repository.findOne ===
            'function' ||
          typeof repository.findById ===
            'function'
        ) &&
        (
          typeof repository.create ===
            'function' ||
          typeof repository.createIfAbsent ===
            'function'
        )
      );
    } catch (error) {
      return false;
    }
  }

  checkBillingPlanRepository() {
    try {
      const repository =
        this.getBillingPlanRepository();

      return Boolean(
        repository &&
        (
          typeof repository.findById ===
            'function' ||
          typeof repository.findOne ===
            'function'
        )
      );
    } catch (error) {
      return false;
    }
  }

  checkBillingDependency() {
    const billing =
      this.tenantBillingService;

    return Boolean(
      billing &&
      (
        typeof billing.generateSubscriptionRenewal ===
          'function' ||
        typeof billing.generateInvoice ===
          'function'
      )
    );
  }

  checkDependency(
    dependency,
    methods = []
  ) {
    if (!dependency) {
      return false;
    }

    if (
      methods.length === 0
    ) {
      return true;
    }

    return methods.some(
      (method) =>
        typeof dependency[method] ===
        'function'
    );
  }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
  SubscriptionService;

module.exports.SubscriptionService =
  SubscriptionService;

module.exports.SubscriptionDomainError =
  SubscriptionDomainError;

module.exports.SUBSCRIPTION_STATUS =
  SUBSCRIPTION_STATUS;

module.exports.ACTIVE_STATUSES =
  ACTIVE_STATUSES;

module.exports.ENTITLED_STATUSES =
  ENTITLED_STATUSES;

module.exports.BILLABLE_STATUSES =
  BILLABLE_STATUSES;

module.exports.TERMINAL_STATUSES =
  TERMINAL_STATUSES;

module.exports.STATE_TRANSITIONS =
  STATE_TRANSITIONS;

module.exports.BILLING_CYCLES =
  BILLING_CYCLES;

module.exports.PLAN_CHANGE_TYPES =
  PLAN_CHANGE_TYPES;

module.exports.WEBHOOK_STATUS =
  WEBHOOK_STATUS;