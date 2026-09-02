'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Tenant Billing Service
 * ============================================================================
 *
 * File:
 *   backend/modules/tenantBillingService.js
 *
 * Production-grade multi-tenant SaaS billing orchestration engine.
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Billing plan management
 * - Tenant subscription billing coordination
 * - Trial billing support
 * - Subscription renewal generation
 * - Plan upgrade / downgrade proration
 * - Invoice generation and lifecycle tracking
 * - Payment orchestration
 * - Payment recovery callbacks
 * - Usage metering
 * - Overdue invoice processing
 * - Grace-period enforcement
 * - Tenant suspension / reactivation
 * - Deterministic idempotency
 * - Atomic billing-operation claiming
 * - Duplicate invoice prevention
 * - Concurrent worker safety
 * - Audit logging
 * - Cache management
 * - Queue integration
 * - Notification integration
 * - Metrics integration
 * - Domain event publication
 *
 * Ownership Boundary
 * ----------------------------------------------------------------------------
 *
 * SubscriptionService owns:
 *
 *   - Subscription lifecycle state
 *   - active / trialing / past_due / grace / suspended / cancelled
 *   - recovery from successful payment
 *   - lifecycle transitions
 *
 * TenantBillingService owns:
 *
 *   - Billable operations
 *   - Renewal operations
 *   - Invoice creation
 *   - Invoice lifecycle
 *   - Payment attempts
 *   - Payment recovery callbacks
 *   - Usage and proration calculations
 *
 * Financial Posting Boundary
 * ----------------------------------------------------------------------------
 *
 * This service MUST NOT directly mutate:
 *
 *   - Ledger balances
 *   - Journal entries
 *   - Financial account balances
 *
 * Financial posting remains delegated to the established Finance / Ledger
 * subsystem.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * ERROR TYPES
 * ============================================================================
 */

class BillingError extends Error {
  constructor(
    message,
    {
      code = 'BILLING_ERROR',
      statusCode = 400,
      details = undefined,
      cause = undefined,
      retryable = false,
    } = {}
  ) {
    super(message);

    this.name = 'BillingError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
    this.retryable = retryable;

    if (cause) {
      this.cause = cause;
    }

    Error.captureStackTrace?.(
      this,
      BillingError
    );
  }
}

/**
 * ============================================================================
 * BILLING OPERATION STATES
 * ============================================================================
 */

const BILLING_OPERATION_STATUS = Object.freeze({
  PROCESSING: 'processing',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  RECOVERABLE: 'recoverable',
});

const INVOICE_STATUS = Object.freeze({
  DRAFT: 'draft',
  PENDING: 'pending',
  PROCESSING: 'processing',
  PAID: 'paid',
  OVERDUE: 'overdue',
  FAILED: 'failed',
  VOID: 'void',
});

const SUBSCRIPTION_ACTIVE_STATUSES = Object.freeze([
  'active',
  'trialing',
  'past_due',
  'grace',
]);

/**
 * ============================================================================
 * SERVICE
 * ============================================================================
 */

class TenantBillingService extends EventEmitter {
  constructor({
    logger,
    db,
    cache,
    paymentGateway,
    subscriptionService,
    queueService,
    auditService,
    metricsService,
    notificationService,
    config = {},
  } = {}) {
    super();

    this.logger =
      logger ||
      console;

    this.db =
      db ||
      null;

    this.cache =
      cache ||
      null;

    this.paymentGateway =
      paymentGateway ||
      null;

    /**
     * Optional lifecycle authority.
     *
     * The service remains backward-compatible with deployments where
     * SubscriptionService is not yet injected.
     */
    this.subscriptionService =
      subscriptionService ||
      null;

    this.queueService =
      queueService ||
      null;

    this.auditService =
      auditService ||
      null;

    this.metricsService =
      metricsService ||
      null;

    this.notificationService =
      notificationService ||
      null;

    this.config = {
      serviceName:
        'TenantBillingService',

      invoicePrefix:
        'INV',

      defaultCurrency:
        'USD',

      gracePeriodDays:
        7,

      retryAttempts:
        3,

      retryDelayHours:
        24,

      cacheTtl:
        300,

      /**
       * Idempotency records should generally outlive short cache TTLs.
       *
       * Persistent storage is preferred when billingOperations repository
       * is available.
       */
      idempotencyTtl:
        24 * 60 * 60,

      operationClaimTtl:
        10 * 60,

      maxUsageQuantity:
        1000000000,

      maxPlanPrice:
        1000000000000,

      supportedBillingCycles: [
        'weekly',
        'monthly',
        'quarterly',
        'yearly',
      ],

      activeSubscriptionStatuses:
        [...SUBSCRIPTION_ACTIVE_STATUSES],

      billableSubscriptionStatuses: [
        'active',
      ],

      ...config,
    };

    this.metrics = {
      plansCreated: 0,
      plansUpdated: 0,

      subscriptionsCreated: 0,
      subscriptionsChanged: 0,
      subscriptionsCancelled: 0,
      subscriptionsReactivated: 0,

      renewalsGenerated: 0,
      renewalDuplicatesPrevented: 0,

      prorationOperations: 0,

      invoicesGenerated: 0,
      invoicesPaid: 0,
      invoicesFailed: 0,
      invoicesOverdue: 0,

      usageRecordsCreated: 0,

      billingCyclesProcessed: 0,
      billingCycleFailures: 0,

      overdueProcessed: 0,

      tenantsSuspended: 0,
      tenantsReactivated: 0,

      operationsClaimed: 0,
      operationClaimConflicts: 0,
      operationRecoveries: 0,

      idempotentHits: 0,

      failures: 0,
    };
  }

  /**
   * ==========================================================================
   * PLAN MANAGEMENT
   * ==========================================================================
   */

  async createPlan(payload = {}) {
    const startedAt =
      Date.now();

    try {
      this.assertDatabase();

      const normalized =
        this.validatePlanPayload(
          payload
        );

      const existing =
        await this.db.billingPlans.findOne({
          code:
            normalized.code,
        });

      if (existing) {
        throw new BillingError(
          'Billing plan code already exists.',
          {
            code:
              'BILLING_PLAN_CODE_EXISTS',
            statusCode:
              409,
          }
        );
      }

      const now =
        new Date();

      const plan = {
        id:
          crypto.randomUUID(),

        ...normalized,

        active:
          true,

        createdAt:
          now,

        updatedAt:
          now,

        version:
          1,
      };

      await this.db.billingPlans.create(
        plan
      );

      this.metrics.plansCreated++;

      await this.audit(
        null,
        'BILLING_PLAN_CREATED',
        this.sanitizePlanForAudit(
          plan
        )
      );

      this.emitSafe(
        'billing.plan.created',
        plan
      );

      this.recordMetric(
        'billing.plan.created',
        1,
        {
          planCode:
            plan.code,
        }
      );

      this.logInfo(
        'Billing plan created.',
        {
          planId:
            plan.id,
          code:
            plan.code,
          durationMs:
            Date.now() -
            startedAt,
        }
      );

      return plan;
    } catch (error) {
      this.recordFailure(
        'createPlan'
      );

      this.logError(
        'Failed to create billing plan.',
        error
      );

      throw error;
    }
  }

  async updatePlan(
    planId,
    updates = {}
  ) {
    try {
      this.assertDatabase();

      const plan =
        await this.db.billingPlans.findById(
          planId
        );

      if (!plan) {
        throw new BillingError(
          'Billing plan not found.',
          {
            code:
              'BILLING_PLAN_NOT_FOUND',
            statusCode:
              404,
          }
        );
      }

      const normalized =
        this.validatePlanUpdate(
          updates
        );

      const updated = {
        ...plan,
        ...normalized,

        id:
          plan.id,

        createdAt:
          plan.createdAt,

        updatedAt:
          new Date(),

        version:
          Number(
            plan.version || 0
          ) + 1,
      };

      await this.db.billingPlans.update(
        planId,
        updated
      );

      this.metrics.plansUpdated++;

      await this.audit(
        null,
        'BILLING_PLAN_UPDATED',
        {
          planId,

          changes:
            this.sanitizePlanForAudit(
              normalized
            ),
        }
      );

      this.emitSafe(
        'billing.plan.updated',
        updated
      );

      return updated;
    } catch (error) {
      this.recordFailure(
        'updatePlan'
      );

      this.logError(
        'Failed to update billing plan.',
        error
      );

      throw error;
    }
  }

  async getPlan(planId) {
    this.assertDatabase();

    return this.db.billingPlans.findById(
      planId
    );
  }

  async listPlans(filters = {}) {
    this.assertDatabase();

    return this.db.billingPlans.find(
      filters
    );
  }

  /**
   * ==========================================================================
   * TENANT SUBSCRIPTION MANAGEMENT
   * ==========================================================================
   */

  async subscribeTenant({
    tenantId,
    planId,
    trial = true,
    metadata = {},
    idempotencyKey = null,
  } = {}) {
    try {
      this.assertTenantId(
        tenantId
      );

      this.assertRequired(
        planId,
        'planId'
      );

      const operationKey =
        this.createDeterministicOperationKey(
          'subscribe',
          {
            tenantId,
            planId,
            trial:
              Boolean(trial),
          },
          idempotencyKey
        );

      const existingResult =
        await this.getIdempotentResult(
          operationKey
        );

      if (existingResult) {
        this.metrics.idempotentHits++;

        return existingResult;
      }

      const existing =
        await this.getActiveSubscription(
          tenantId
        );

      if (existing) {
        throw new BillingError(
          'Tenant already has an active subscription.',
          {
            code:
              'ACTIVE_SUBSCRIPTION_EXISTS',
            statusCode:
              409,
          }
        );
      }

      const plan =
        await this.getRequiredActivePlan(
          planId
        );

      const now =
        new Date();

      const hasTrial =
        Boolean(
          trial &&
          Number(
            plan.trialDays
          ) > 0
        );

      const subscription = {
        id:
          crypto.randomUUID(),

        tenantId,

        planId,

        status:
          hasTrial
            ? 'trialing'
            : 'active',

        startedAt:
          now,

        trialEndsAt:
          hasTrial
            ? this.addDays(
                now,
                Number(
                  plan.trialDays
                )
              )
            : null,

        currentPeriodStart:
          now,

        currentPeriodEnd:
          this.calculateNextBillingDate(
            now,
            plan.billingCycle
          ),

        cancelAtPeriodEnd:
          false,

        cancelledAt:
          null,

        metadata:
          this.cloneMetadata(
            metadata
          ),

        createdAt:
          now,

        updatedAt:
          now,

        version:
          1,
      };

      await this.createSubscriptionSafely(
        subscription
      );

      await this.invalidateTenantCache(
        tenantId
      );

      await this.audit(
        tenantId,
        'TENANT_SUBSCRIBED',
        this.subscriptionAuditPayload(
          subscription
        )
      );

      this.metrics.subscriptionsCreated++;

      this.emitSafe(
        'tenant.subscription.created',
        subscription
      );

      await this.storeIdempotentResult(
        operationKey,
        subscription
      );

      return subscription;
    } catch (error) {
      this.recordFailure(
        'subscribeTenant'
      );

      this.logError(
        'Failed to subscribe tenant.',
        error,
        {
          tenantId,
        }
      );

      throw error;
    }
  }

  async changePlan({
    tenantId,
    newPlanId,
    changeType = 'change',
    idempotencyKey = null,
  } = {}) {
    try {
      this.assertTenantId(
        tenantId
      );

      this.assertRequired(
        newPlanId,
        'newPlanId'
      );

      const subscription =
        await this.getActiveSubscription(
          tenantId
        );

      if (!subscription) {
        throw new BillingError(
          'Subscription not found.',
          {
            code:
              'SUBSCRIPTION_NOT_FOUND',
            statusCode:
              404,
          }
        );
      }

      const oldPlan =
        await this.getRequiredPlan(
          subscription.planId
        );

      const newPlan =
        await this.getRequiredActivePlan(
          newPlanId
        );

      if (
        oldPlan.id ===
        newPlan.id
      ) {
        return {
          subscription,
          proration: {
            credit: 0,
            charge: 0,
            difference: 0,
            ratio: 0,
          },
        };
      }

      const operationKey =
        this.createDeterministicOperationKey(
          'change-plan',
          {
            tenantId,
            subscriptionId:
              subscription.id,
            previousPlanId:
              oldPlan.id,
            newPlanId:
              newPlan.id,
            periodStart:
              subscription.currentPeriodStart,
          },
          idempotencyKey
        );

      const idempotent =
        await this.getIdempotentResult(
          operationKey
        );

      if (idempotent) {
        this.metrics.idempotentHits++;

        return idempotent;
      }

      const proration =
        await this.applySubscriptionProration({
          subscription,
          oldPlan,
          newPlan,
          operationKey,
        });

      const previousPlanId =
        subscription.planId;

      const updated = {
        ...subscription,

        planId:
          newPlan.id,

        updatedAt:
          new Date(),

        version:
          Number(
            subscription.version || 0
          ) + 1,
      };

      await this.updateSubscriptionSafely(
        subscription.id,
        updated,
        subscription
      );

      await this.invalidateTenantCache(
        tenantId
      );

      this.metrics.subscriptionsChanged++;

      const result = {
        subscription:
          updated,

        proration,
      };

      await this.audit(
        tenantId,
        `SUBSCRIPTION_PLAN_${String(
          changeType
        ).toUpperCase()}`,
        {
          subscriptionId:
            subscription.id,

          previousPlanId,

          newPlanId:
            newPlan.id,

          proration,
        }
      );

      this.emitSafe(
        'tenant.subscription.plan.changed',
        {
          tenantId,
          subscription:
            updated,
          oldPlan,
          newPlan,
          proration,
        }
      );

      await this.storeIdempotentResult(
        operationKey,
        result
      );

      return result;
    } catch (error) {
      this.recordFailure(
        'changePlan'
      );

      this.logError(
        'Failed to change subscription plan.',
        error,
        {
          tenantId,
          newPlanId,
        }
      );

      throw error;
    }
  }

  async cancelSubscription(
    tenantId,
    immediate = false
  ) {
    try {
      this.assertTenantId(
        tenantId
      );

      const subscription =
        await this.getActiveSubscription(
          tenantId
        );

      if (!subscription) {
        throw new BillingError(
          'Subscription not found.',
          {
            code:
              'SUBSCRIPTION_NOT_FOUND',
            statusCode:
              404,
          }
        );
      }

      const now =
        new Date();

      const updated = {
        ...subscription,

        cancelAtPeriodEnd:
          !immediate,

        status:
          immediate
            ? 'cancelled'
            : subscription.status,

        cancelledAt:
          immediate
            ? now
            : subscription.cancelledAt,

        updatedAt:
          now,

        version:
          Number(
            subscription.version || 0
          ) + 1,
      };

      await this.updateSubscriptionSafely(
        subscription.id,
        updated,
        subscription
      );

      await this.invalidateTenantCache(
        tenantId
      );

      this.metrics.subscriptionsCancelled++;

      await this.audit(
        tenantId,
        immediate
          ? 'SUBSCRIPTION_CANCELLED_IMMEDIATELY'
          : 'SUBSCRIPTION_CANCEL_AT_PERIOD_END',
        {
          subscriptionId:
            subscription.id,

          immediate,

          effectiveAt:
            immediate
              ? now
              : subscription.currentPeriodEnd,
        }
      );

      this.emitSafe(
        'tenant.subscription.cancelled',
        updated
      );

      return updated;
    } catch (error) {
      this.recordFailure(
        'cancelSubscription'
      );

      this.logError(
        'Failed to cancel subscription.',
        error,
        {
          tenantId,
        }
      );

      throw error;
    }
  }

  async getActiveSubscription(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    const cacheKey =
      this.subscriptionCacheKey(
        tenantId
      );

    try {
      if (this.cache) {
        const cached =
          await this.cache.get(
            cacheKey
          );

        if (cached) {
          return cached;
        }
      }
    } catch (error) {
      this.logWarn(
        'Subscription cache read failed.',
        {
          tenantId,
          error:
            error.message,
        }
      );
    }

    this.assertDatabase();

    const subscription =
      await this.db.tenantSubscriptions.findOne(
        {
          tenantId,

          status: {
            $in:
              this.config
                .activeSubscriptionStatuses,
          },
        }
      );

    if (
      subscription &&
      this.cache
    ) {
      try {
        await this.cache.set(
          cacheKey,
          subscription,
          this.config.cacheTtl
        );
      } catch (error) {
        this.logWarn(
          'Subscription cache write failed.',
          {
            tenantId,
            error:
              error.message,
          }
        );
      }
    }

    return subscription;
  }

  /**
   * ==========================================================================
   * SUBSCRIPTION RENEWAL
   * ==========================================================================
   *
   * The renewal operation is deterministic.
   *
   * A repeated scheduler job for the same subscription + billing period must
   * return the already-created operation/invoice rather than generating another
   * invoice.
   */

  async generateSubscriptionRenewal(
    subscriptionOrId,
    {
      idempotencyKey = null,
      periodStart = null,
      periodEnd = null,
      source = 'billing-cycle',
    } = {}
  ) {
    try {
      this.assertDatabase();

      const subscription =
        await this.resolveSubscription(
          subscriptionOrId
        );

      if (!subscription) {
        throw new BillingError(
          'Subscription not found.',
          {
            code:
              'SUBSCRIPTION_NOT_FOUND',
            statusCode:
              404,
          }
        );
      }

      const effectivePeriodStart =
        periodStart ||
        subscription.currentPeriodStart;

      const effectivePeriodEnd =
        periodEnd ||
        subscription.currentPeriodEnd;

      const periodIdentity =
        this.createBillingPeriodIdentity(
          effectivePeriodStart,
          effectivePeriodEnd
        );

      const operationKey =
        this.createDeterministicOperationKey(
          'subscription-renewal',
          {
            subscriptionId:
              subscription.id,
            tenantId:
              subscription.tenantId,
            periodIdentity,
          },
          idempotencyKey
        );

      /**
       * First check completed operations.
       */
      const previous =
        await this.getCompletedBillingOperation(
          operationKey
        );

      if (previous) {
        this.metrics.idempotentHits++;
        this.metrics.renewalDuplicatesPrevented++;

        return this.normalizeRenewalOperationResult(
          previous
        );
      }

      /**
       * Database-level duplicate invoice protection.
       */
      const existingInvoice =
        await this.findInvoiceForSubscriptionPeriod(
          subscription.id,
          effectivePeriodStart,
          effectivePeriodEnd
        );

      if (existingInvoice) {
        const result =
          this.createRenewalResult(
            subscription,
            existingInvoice,
            {
              duplicate:
                true,
              source,
            }
          );

        await this.storeBillingOperationSuccess(
          operationKey,
          result
        );

        this.metrics.renewalDuplicatesPrevented++;

        return result;
      }

      /**
       * Atomic operation claim.
       *
       * If another worker already owns this renewal operation, either return
       * its completed result or surface a retry-safe conflict.
       */
      const claim =
        await this.claimBillingOperation(
          operationKey,
          {
            type:
              'subscription_renewal',

            tenantId:
              subscription.tenantId,

            subscriptionId:
              subscription.id,

            periodStart:
              effectivePeriodStart,

            periodEnd:
              effectivePeriodEnd,

            source,
          }
        );

      if (
        !claim.claimed
      ) {
        const recovered =
          await this.waitForBillingOperationResult(
            operationKey
          );

        if (recovered) {
          this.metrics.idempotentHits++;
          this.metrics.renewalDuplicatesPrevented++;

          return this.normalizeRenewalOperationResult(
            recovered
          );
        }

        throw new BillingError(
          'Billing renewal is already being processed.',
          {
            code:
              'BILLING_OPERATION_IN_PROGRESS',
            statusCode:
              409,
            retryable:
              true,
          }
        );
      }

      try {
        /**
         * Re-check after claiming.
         *
         * This protects against a competing worker which completed immediately
         * before this claim was acquired.
         */
        const invoice =
          await this.generateInvoice(
            subscription.tenantId,
            {
              periodStart:
                effectivePeriodStart,

              periodEnd:
                effectivePeriodEnd,

              idempotencyKey:
                operationKey,
            }
          );

        const result =
          this.createRenewalResult(
            subscription,
            invoice,
            {
              duplicate:
                false,
              source,
            }
          );

        await this.completeBillingOperation(
          operationKey,
          result
        );

        this.metrics.renewalsGenerated++;

        await this.audit(
          subscription.tenantId,
          'SUBSCRIPTION_RENEWAL_GENERATED',
          {
            subscriptionId:
              subscription.id,

            invoiceId:
              this.getInvoiceIdentifier(
                invoice
              ),

            invoiceReference:
              this.getInvoiceReference(
                invoice
              ),

            periodStart:
              effectivePeriodStart,

            periodEnd:
              effectivePeriodEnd,

            source,
          }
        );

        this.emitSafe(
          'subscription.renewal.generated',
          result
        );

        return result;
      } catch (error) {
        await this.failBillingOperation(
          operationKey,
          error
        );

        throw error;
      }
    } catch (error) {
      this.recordFailure(
        'generateSubscriptionRenewal'
      );

      this.logError(
        'Subscription renewal generation failed.',
        error
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * SUBSCRIPTION PRORATION
   * ==========================================================================
   *
   * Calculates the commercial adjustment and, when non-zero, creates a billing
   * adjustment record/invoice representation without directly touching ledger
   * balances.
   */

  async applySubscriptionProration({
    subscription,
    oldPlan,
    newPlan,
    operationKey = null,
    metadata = {},
  } = {}) {
    if (!subscription) {
      throw new BillingError(
        'Subscription is required for proration.',
        {
          code:
            'SUBSCRIPTION_REQUIRED',
        }
      );
    }

    if (!oldPlan || !newPlan) {
      throw new BillingError(
        'Old and new billing plans are required.',
        {
          code:
            'PRORATION_PLAN_REQUIRED',
        }
      );
    }

    const key =
      operationKey ||
      this.createDeterministicOperationKey(
        'subscription-proration',
        {
          subscriptionId:
            subscription.id,
          oldPlanId:
            oldPlan.id,
          newPlanId:
            newPlan.id,
          periodStart:
            subscription.currentPeriodStart,
          periodEnd:
            subscription.currentPeriodEnd,
        }
      );

    const existing =
      await this.getIdempotentResult(
        key
      );

    if (existing) {
      this.metrics.idempotentHits++;

      return existing;
    }

    const calculation =
      this.calculateProration(
        oldPlan,
        newPlan,
        subscription
      );

    const result = {
      operationKey:
        key,

      subscriptionId:
        subscription.id,

      tenantId:
        subscription.tenantId,

      previousPlanId:
        oldPlan.id,

      newPlanId:
        newPlan.id,

      credit:
        calculation.credit,

      charge:
        calculation.charge,

      difference:
        calculation.difference,

      ratio:
        calculation.ratio,

      adjustmentRequired:
        calculation.difference !==
        0,

      adjustmentType:
        calculation.difference > 0
          ? 'charge'
          : calculation.difference < 0
            ? 'credit'
            : 'none',

      metadata:
        this.cloneMetadata(
          metadata
        ),

      calculatedAt:
        new Date(),
    };

    this.metrics.prorationOperations++;

    await this.audit(
      subscription.tenantId,
      'SUBSCRIPTION_PRORATION_CALCULATED',
      result
    );

    this.emitSafe(
      'subscription.proration.calculated',
      result
    );

    await this.storeIdempotentResult(
      key,
      result
    );

    return result;
  }

  /**
   * ==========================================================================
   * INVOICE MANAGEMENT
   * ==========================================================================
   */

  async generateInvoice(
    tenantId,
    {
      idempotencyKey = null,
      periodStart = null,
      periodEnd = null,
      subscriptionId = null,
      metadata = {},
    } = {}
  ) {
    try {
      this.assertTenantId(
        tenantId
      );

      const subscription =
        subscriptionId
          ? await this.resolveSubscription(
              subscriptionId
            )
          : await this.getActiveSubscription(
              tenantId
            );

      if (!subscription) {
        throw new BillingError(
          'No active subscription.',
          {
            code:
              'ACTIVE_SUBSCRIPTION_NOT_FOUND',
            statusCode:
              404,
          }
        );
      }

      const plan =
        await this.getRequiredPlan(
          subscription.planId
        );

      const effectivePeriodStart =
        periodStart ||
        subscription.currentPeriodStart;

      const effectivePeriodEnd =
        periodEnd ||
        subscription.currentPeriodEnd;

      const periodIdentity =
        this.createBillingPeriodIdentity(
          effectivePeriodStart,
          effectivePeriodEnd
        );

      const operationKey =
        this.createDeterministicOperationKey(
          'invoice-generation',
          {
            tenantId,
            subscriptionId:
              subscription.id,
            periodIdentity,
          },
          idempotencyKey
        );

      const idempotent =
        await this.getIdempotentResult(
          operationKey
        );

      if (idempotent) {
        this.metrics.idempotentHits++;

        return this.normalizeInvoiceReturn(
          idempotent
        );
      }

      /**
       * Strong duplicate guard before operation creation.
       */
      const existing =
        await this.findInvoiceForSubscriptionPeriod(
          subscription.id,
          effectivePeriodStart,
          effectivePeriodEnd
        );

      if (existing) {
        await this.storeIdempotentResult(
          operationKey,
          existing
        );

        this.metrics.renewalDuplicatesPrevented++;

        return this.normalizeInvoiceReturn(
          existing
        );
      }

      const claim =
        await this.claimBillingOperation(
          operationKey,
          {
            type:
              'invoice_generation',

            tenantId,

            subscriptionId:
              subscription.id,

            periodStart:
              effectivePeriodStart,

            periodEnd:
              effectivePeriodEnd,
          }
        );

      if (!claim.claimed) {
        const result =
          await this.waitForBillingOperationResult(
            operationKey
          );

        if (result) {
          return this.normalizeInvoiceReturn(
            result
          );
        }

        /**
         * A final database lookup is useful when the operation state store
         * degraded but the invoice write itself succeeded.
         */
        const recoveredInvoice =
          await this.findInvoiceForSubscriptionPeriod(
            subscription.id,
            effectivePeriodStart,
            effectivePeriodEnd
          );

        if (recoveredInvoice) {
          return this.normalizeInvoiceReturn(
            recoveredInvoice
          );
        }

        throw new BillingError(
          'Invoice generation is already in progress.',
          {
            code:
              'INVOICE_OPERATION_IN_PROGRESS',
            statusCode:
              409,
            retryable:
              true,
          }
        );
      }

      try {
        /**
         * Re-check after claim acquisition.
         */
        const duplicate =
          await this.findInvoiceForSubscriptionPeriod(
            subscription.id,
            effectivePeriodStart,
            effectivePeriodEnd
          );

        if (duplicate) {
          await this.completeBillingOperation(
            operationKey,
            duplicate
          );

          return this.normalizeInvoiceReturn(
            duplicate
          );
        }

        const now =
          new Date();

        const amount =
          this.normalizeMoney(
            plan.price
          );

        const invoice = {
          id:
            crypto.randomUUID(),

          invoiceNumber:
            await this.generateInvoiceNumber(),

          tenantId,

          subscriptionId:
            subscription.id,

          planId:
            plan.id,

          currency:
            plan.currency ||
            this.config.defaultCurrency,

          periodStart:
            new Date(
              effectivePeriodStart
            ),

          periodEnd:
            new Date(
              effectivePeriodEnd
            ),

          amount,

          subtotal:
            amount,

          tax:
            0,

          discount:
            0,

          total:
            amount,

          status:
            INVOICE_STATUS.PENDING,

          operationStatus:
            'completed',

          dueDate:
            new Date(
              effectivePeriodEnd
            ),

          paymentAttempts:
            0,

          retryCount:
            0,

          createdAt:
            now,

          updatedAt:
            now,

          metadata: {
            billingCycle:
              plan.billingCycle,

            generatedBy:
              this.config.serviceName,

            idempotencyKey:
              operationKey,

            ...this.cloneMetadata(
              metadata
            ),
          },

          version:
            1,
        };

        try {
          await this.db.invoices.create(
            invoice
          );
        } catch (error) {
          if (
            this.isDuplicateKeyError(
              error
            )
          ) {
            const duplicateInvoice =
              await this.findInvoiceForSubscriptionPeriod(
                subscription.id,
                effectivePeriodStart,
                effectivePeriodEnd
              );

            if (duplicateInvoice) {
              await this.completeBillingOperation(
                operationKey,
                duplicateInvoice
              );

              return this.normalizeInvoiceReturn(
                duplicateInvoice
              );
            }
          }

          throw error;
        }

        this.metrics.invoicesGenerated++;

        await this.audit(
          tenantId,
          'INVOICE_GENERATED',
          this.invoiceAuditPayload(
            invoice
          )
        );

        this.emitSafe(
          'invoice.generated',
          invoice
        );

        await this.completeBillingOperation(
          operationKey,
          invoice
        );

        await this.storeIdempotentResult(
          operationKey,
          invoice
        );

        return this.normalizeInvoiceReturn(
          invoice
        );
      } catch (error) {
        await this.failBillingOperation(
          operationKey,
          error
        );

        throw error;
      }
    } catch (error) {
      this.recordFailure(
        'generateInvoice'
      );

      this.logError(
        'Invoice generation failed.',
        error,
        {
          tenantId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * PAYMENT
   * ==========================================================================
   */

  async payInvoice(
    invoiceId,
    paymentMethodId,
    {
      idempotencyKey = null,
    } = {}
  ) {
    try {
      this.assertRequired(
        invoiceId,
        'invoiceId'
      );

      this.assertRequired(
        paymentMethodId,
        'paymentMethodId'
      );

      this.assertDatabase();

      const invoice =
        await this.resolveInvoice(
          invoiceId
        );

      if (!invoice) {
        throw new BillingError(
          'Invoice not found.',
          {
            code:
              'INVOICE_NOT_FOUND',
            statusCode:
              404,
          }
        );
      }

      if (
        invoice.status ===
        INVOICE_STATUS.PAID
      ) {
        return this.normalizeInvoiceReturn(
          invoice
        );
      }

      if (
        invoice.status ===
        INVOICE_STATUS.VOID
      ) {
        throw new BillingError(
          'Cannot pay a void invoice.',
          {
            code:
              'INVOICE_VOID',
            statusCode:
              409,
          }
        );
      }

      const operationKey =
        this.createDeterministicOperationKey(
          'invoice-payment',
          {
            invoiceId:
              invoice.id,
            invoiceReference:
              this.getInvoiceReference(
                invoice
              ),
          },
          idempotencyKey
        );

      const previous =
        await this.getCompletedBillingOperation(
          operationKey
        );

      if (previous) {
        this.metrics.idempotentHits++;

        return this.normalizeInvoiceReturn(
          previous.invoice ||
          previous
        );
      }

      const claim =
        await this.claimBillingOperation(
          operationKey,
          {
            type:
              'invoice_payment',

            tenantId:
              invoice.tenantId,

            invoiceId:
              invoice.id,
          }
        );

      if (!claim.claimed) {
        const completed =
          await this.waitForBillingOperationResult(
            operationKey
          );

        if (completed) {
          return this.normalizeInvoiceReturn(
            completed.invoice ||
            completed
          );
        }

        throw new BillingError(
          'Invoice payment is already being processed.',
          {
            code:
              'PAYMENT_OPERATION_IN_PROGRESS',
            statusCode:
              409,
            retryable:
              true,
          }
        );
      }

      try {
        if (
          !this.paymentGateway ||
          typeof this.paymentGateway.charge !==
            'function'
        ) {
          throw new BillingError(
            'Payment gateway is unavailable.',
            {
              code:
                'PAYMENT_GATEWAY_UNAVAILABLE',
              statusCode:
                503,
              retryable:
                true,
            }
          );
        }

        const attempts =
          Number(
            invoice.paymentAttempts || 0
          ) + 1;

        const processingInvoice = {
          ...invoice,

          status:
            INVOICE_STATUS.PROCESSING,

          paymentAttempts:
            attempts,

          lastPaymentAttemptAt:
            new Date(),

          updatedAt:
            new Date(),

          version:
            Number(
              invoice.version || 0
            ) + 1,
        };

        await this.updateInvoiceSafely(
          invoice.id,
          processingInvoice,
          invoice
        );

        let payment;

        try {
          payment =
            await this.paymentGateway.charge(
              {
                amount:
                  invoice.total,

                currency:
                  invoice.currency,

                paymentMethodId,

                invoiceId:
                  invoice.id,

                invoiceReference:
                  this.getInvoiceReference(
                    invoice
                  ),

                tenantId:
                  invoice.tenantId,

                idempotencyKey:
                  operationKey,
              }
            );
        } catch (error) {
          await this.handlePaymentFailure(
            processingInvoice,
            error
          );

          await this.failBillingOperation(
            operationKey,
            error
          );

          throw new BillingError(
            'Invoice payment failed.',
            {
              code:
                'INVOICE_PAYMENT_FAILED',
              statusCode:
                402,
              cause:
                error,
              retryable:
                this.isRetryablePaymentError(
                  error
                ),
            }
          );
        }

        if (
          !payment ||
          !payment.id
        ) {
          throw new BillingError(
            'Payment gateway returned an invalid response.',
            {
              code:
                'INVALID_PAYMENT_RESPONSE',
              statusCode:
                502,
            }
          );
        }

        const paidInvoice =
          await this.handlePaymentSucceeded(
            {
              invoice:
                processingInvoice,

              payment,

              operationKey,
            }
          );

        const result = {
          invoice:
            paidInvoice,

          invoiceId:
            this.getInvoiceIdentifier(
              paidInvoice
            ),

          invoiceReference:
            this.getInvoiceReference(
              paidInvoice
            ),

          paymentId:
            payment.id,

          recoveredSubscription:
            true,
        };

        await this.completeBillingOperation(
          operationKey,
          result
        );

        await this.storeIdempotentResult(
          operationKey,
          result
        );

        return this.normalizeInvoiceReturn(
          paidInvoice
        );
      } catch (error) {
        await this.failBillingOperation(
          operationKey,
          error
        );

        throw error;
      }
    } catch (error) {
      this.recordFailure(
        'payInvoice'
      );

      this.logError(
        'Invoice payment failed.',
        error,
        {
          invoiceId,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * PAYMENT SUCCESS RECOVERY
   * ==========================================================================
   *
   * Primary coordination rule:
   *
   * payment succeeded
   *        ↓
   * invoice paid
   *        ↓
   * SubscriptionService.recoverSubscriptionFromPayment()
   *
   * The method intentionally supports several possible SubscriptionService
   * signatures to preserve integration compatibility.
   */

  async handlePaymentSucceeded({
    invoice,
    payment,
    operationKey = null,
  } = {}) {
    if (!invoice?.id) {
      throw new BillingError(
        'Invoice is required.',
        {
          code:
            'INVOICE_REQUIRED',
        }
      );
    }

    if (!payment?.id) {
      throw new BillingError(
        'Payment result is required.',
        {
          code:
            'PAYMENT_REQUIRED',
        }
      );
    }

    const paidAt =
      new Date();

    const paidInvoice = {
      ...invoice,

      status:
        INVOICE_STATUS.PAID,

      operationStatus:
        'completed',

      paymentId:
        payment.id,

      paidAt,

      updatedAt:
        paidAt,

      version:
        Number(
          invoice.version || 0
        ) + 1,
    };

    await this.updateInvoiceSafely(
      invoice.id,
      paidInvoice,
      invoice
    );

    this.metrics.invoicesPaid++;

    /**
     * Subscription lifecycle recovery.
     *
     * Invoice payment is financially successful even if lifecycle recovery
     * temporarily fails. Recovery failure is therefore queued and made
     * observable instead of reversing the paid invoice.
     */
    try {
      await this.recoverSubscriptionFromPayment(
        {
          invoice:
            paidInvoice,
          payment,
          operationKey,
        }
      );
    } catch (error) {
      await this.enqueueSafe(
        'billing-payment-recovery',
        {
          invoiceId:
            paidInvoice.id,

          invoiceReference:
            this.getInvoiceReference(
              paidInvoice
            ),

          paymentId:
            payment.id,

          tenantId:
            paidInvoice.tenantId,
        },
        {
          jobId:
            `billing-payment-recovery:${paidInvoice.id}:${payment.id}`,
        }
      );

      this.logError(
        'Subscription recovery after payment failed.',
        error,
        {
          invoiceId:
            paidInvoice.id,

          paymentId:
            payment.id,
        }
      );
    }

    await this.audit(
      paidInvoice.tenantId,
      'INVOICE_PAID',
      {
        invoiceId:
          paidInvoice.id,

        invoiceReference:
          this.getInvoiceReference(
            paidInvoice
          ),

        paymentId:
          payment.id,

        amount:
          paidInvoice.total,

        currency:
          paidInvoice.currency,
      }
    );

    this.emitSafe(
      'invoice.paid',
      paidInvoice
    );

    await this.enqueueSafe(
      'billing-invoice-paid',
      {
        invoiceId:
          paidInvoice.id,

        invoiceReference:
          this.getInvoiceReference(
            paidInvoice
          ),

        tenantId:
          paidInvoice.tenantId,

        paymentId:
          payment.id,
      },
      {
        jobId:
          `invoice-paid:${paidInvoice.id}:${payment.id}`,
      }
    );

    return paidInvoice;
  }

  async recoverSubscriptionFromPayment({
    invoice,
    payment,
    operationKey = null,
  } = {}) {
    if (
      !this.subscriptionService
    ) {
      /**
       * Compatibility fallback.
       *
       * Billing remains functional while SubscriptionService is being
       * integrated.
       */
      await this.markSubscriptionRecoveredFallback(
        invoice
      );

      return {
        recovered:
          true,

        strategy:
          'billing-fallback',
      };
    }

    const payload = {
      tenantId:
        invoice.tenantId,

      subscriptionId:
        invoice.subscriptionId,

      invoiceId:
        invoice.id,

      invoiceReference:
        this.getInvoiceReference(
          invoice
        ),

      paymentId:
        payment.id,

      operationKey,

      amount:
        invoice.total,

      currency:
        invoice.currency,

      paidAt:
        invoice.paidAt ||
        new Date(),
    };

    if (
      typeof this.subscriptionService
        .recoverSubscriptionFromPayment ===
      'function'
    ) {
      return this.subscriptionService
        .recoverSubscriptionFromPayment(
          payload
        );
    }

    if (
      typeof this.subscriptionService
        .recoverFromPayment ===
      'function'
    ) {
      return this.subscriptionService
        .recoverFromPayment(
          payload
        );
    }

    if (
      typeof this.subscriptionService
        .reactivateSubscription ===
      'function'
    ) {
      return this.subscriptionService
        .reactivateSubscription(
          invoice.subscriptionId,
          payload
        );
    }

    /**
     * Graceful compatibility fallback.
     */
    await this.markSubscriptionRecoveredFallback(
      invoice
    );

    return {
      recovered:
        true,

      strategy:
        'billing-fallback',
    };
  }

  /**
   * ==========================================================================
   * PAYMENT FAILURE → SUBSCRIPTION PAST_DUE
   * ==========================================================================
   */

  async transitionSubscriptionToPastDue(
    invoice,
    {
      reason =
        'PAYMENT_FAILED',
      error = null,
    } = {}
  ) {
    if (
      !invoice?.subscriptionId
    ) {
      return null;
    }

    /**
     * Prefer lifecycle authority.
     */
    if (
      this.subscriptionService
    ) {
      try {
        if (
          typeof this.subscriptionService
            .markSubscriptionPastDue ===
          'function'
        ) {
          return await this.subscriptionService
            .markSubscriptionPastDue({
              tenantId:
                invoice.tenantId,

              subscriptionId:
                invoice.subscriptionId,

              invoiceId:
                invoice.id,

              reason,

              error:
                this.safeErrorMessage(
                  error
                ),
            });
        }

        if (
          typeof this.subscriptionService
            .transitionToPastDue ===
          'function'
        ) {
          return await this.subscriptionService
            .transitionToPastDue(
              invoice.subscriptionId,
              {
                tenantId:
                  invoice.tenantId,

                invoiceId:
                  invoice.id,

                reason,
              }
            );
        }
      } catch (serviceError) {
        this.logError(
          'SubscriptionService past_due transition failed.',
          serviceError,
          {
            invoiceId:
              invoice.id,
          }
        );
      }
    }

    /**
     * Backward-compatible fallback.
     */
    const subscription =
      await this.resolveSubscription(
        invoice.subscriptionId
      );

    if (!subscription) {
      return null;
    }

    if (
      subscription.status ===
      'cancelled'
    ) {
      return subscription;
    }

    const now =
      new Date();

    const updated = {
      ...subscription,

      status:
        'past_due',

      pastDueAt:
        subscription.pastDueAt ||
        now,

      graceStartedAt:
        subscription.graceStartedAt ||
        now,

      lastBillingFailure:
        reason,

      updatedAt:
        now,

      version:
        Number(
          subscription.version || 0
        ) + 1,
    };

    await this.updateSubscriptionSafely(
      subscription.id,
      updated,
      subscription
    );

    await this.invalidateTenantCache(
      invoice.tenantId
    );

    this.emitSafe(
      'tenant.subscription.past_due',
      {
        subscription:
          updated,

        invoiceId:
          invoice.id,

        reason,
      }
    );

    return updated;
  }

  /**
   * ==========================================================================
   * PAYMENT FAILURE HANDLING
   * ==========================================================================
   */

  async handlePaymentFailure(
    invoice,
    error
  ) {
    const retryCount =
      Number(
        invoice.retryCount || 0
      );

    const nextRetry =
      retryCount + 1;

    const terminal =
      nextRetry >=
      this.config.retryAttempts;

    const status =
      terminal
        ? INVOICE_STATUS.FAILED
        : INVOICE_STATUS.OVERDUE;

    const updated = {
      ...invoice,

      status,

      operationStatus:
        terminal
          ? 'failed'
          : 'recoverable',

      retryCount:
        nextRetry,

      lastPaymentError:
        this.safeErrorMessage(
          error
        ),

      lastPaymentAttemptAt:
        new Date(),

      updatedAt:
        new Date(),

      version:
        Number(
          invoice.version || 0
        ) + 1,
    };

    await this.updateInvoiceSafely(
      invoice.id,
      updated,
      invoice
    );

    /**
     * Critical lifecycle coordination:
     *
     * payment failed → past_due
     */
    await this.transitionSubscriptionToPastDue(
      updated,
      {
        reason:
          terminal
            ? 'PAYMENT_RETRIES_EXHAUSTED'
            : 'PAYMENT_FAILED',

        error,
      }
    );

    this.metrics.invoicesFailed++;

    await this.audit(
      invoice.tenantId,
      'INVOICE_PAYMENT_FAILED',
      {
        invoiceId:
          invoice.id,

        invoiceReference:
          this.getInvoiceReference(
            invoice
          ),

        attempt:
          nextRetry,

        status,
      }
    );

    if (
      nextRetry <
      this.config.retryAttempts
    ) {
      await this.enqueueSafe(
        'billing-retry',
        {
          invoiceId:
            invoice.id,

          invoiceReference:
            this.getInvoiceReference(
              invoice
            ),

          tenantId:
            invoice.tenantId,

          retryCount:
            nextRetry,
        },
        {
          jobId:
            `payment-retry:${invoice.id}:${nextRetry}`,

          delay:
            this.config
              .retryDelayHours *
            60 *
            60 *
            1000,
        }
      );
    }

    return updated;
  }

  /**
   * ==========================================================================
   * PAYMENT RECOVERY CALLBACK
   * ==========================================================================
   *
   * Intended for:
   *
   * - Payment provider webhooks
   * - Retry workers
   * - Settlement recovery workers
   * - Manual reconciliation
   */

  async processPaymentRecoveryCallback(
    payload = {},
    {
      idempotencyKey = null,
    } = {}
  ) {
    if (
      !payload ||
      typeof payload !==
        'object'
    ) {
      throw new BillingError(
        'Invalid payment recovery payload.',
        {
          code:
            'INVALID_PAYMENT_RECOVERY_PAYLOAD',
        }
      );
    }

    const invoice =
      await this.resolveInvoiceFromReference(
        payload
      );

    if (!invoice) {
      throw new BillingError(
        'Invoice not found for payment recovery.',
        {
          code:
            'PAYMENT_RECOVERY_INVOICE_NOT_FOUND',
            statusCode:
              404,
          }
        );
    }

    const operationKey =
      this.createDeterministicOperationKey(
        'payment-recovery',
        {
          invoiceId:
            invoice.id,

          paymentId:
            payload.paymentId ||
            payload.id ||
            payload.transactionId,

          status:
            payload.status ||
            payload.eventType ||
            payload.type,
        },
        idempotencyKey
      );

    const previous =
      await this.getIdempotentResult(
        operationKey
      );

    if (previous) {
      this.metrics.idempotentHits++;

      return previous;
    }

    const normalizedStatus =
      String(
        payload.status ||
        payload.eventType ||
        payload.type ||
        ''
      )
        .trim()
        .toLowerCase();

    let result;

    if (
      [
        'paid',
        'success',
        'successful',
        'payment_succeeded',
      ].includes(
        normalizedStatus
      )
    ) {
      result =
        await this.handlePaymentSucceeded(
          {
            invoice,

            payment: {
              id:
                payload.paymentId ||
                payload.id ||
                payload.transactionId ||
                crypto.randomUUID(),
            },

            operationKey,
          }
        );
    } else if (
      [
        'failed',
        'failure',
        'payment_failed',
        'declined',
      ].includes(
        normalizedStatus
      )
    ) {
      result =
        await this.handlePaymentFailure(
          invoice,
          new BillingError(
            payload.message ||
            'Payment recovery callback reported failure.',
            {
              code:
                'PAYMENT_CALLBACK_FAILURE',
            }
          )
        );
    } else {
      throw new BillingError(
        'Unsupported payment recovery status.',
        {
          code:
            'UNSUPPORTED_PAYMENT_RECOVERY_STATUS',
          details: {
            status:
              normalizedStatus,
          },
        }
      );
    }

    await this.storeIdempotentResult(
      operationKey,
      result
    );

    return result;
  }

  /**
   * ==========================================================================
   * USAGE BILLING
   * ==========================================================================
   */

  async recordUsage({
    tenantId,
    metric,
    quantity,
    idempotencyKey = null,
    metadata = {},
  } = {}) {
    try {
      this.assertTenantId(
        tenantId
      );

      this.assertRequired(
        metric,
        'metric'
      );

      const normalizedQuantity =
        Number(
          quantity
        );

      if (
        !Number.isFinite(
          normalizedQuantity
        ) ||
        normalizedQuantity < 0
      ) {
        throw new BillingError(
          'Usage quantity must be a non-negative finite number.',
          {
            code:
              'INVALID_USAGE_QUANTITY',
          }
        );
      }

      if (
        normalizedQuantity >
        this.config.maxUsageQuantity
      ) {
        throw new BillingError(
          'Usage quantity exceeds configured maximum.',
          {
            code:
              'USAGE_QUANTITY_EXCEEDED',
          }
        );
      }

      const operationKey =
        this.createDeterministicOperationKey(
          'usage',
          {
            tenantId,
            metric:
              String(metric).trim(),
            quantity:
              normalizedQuantity,
          },
          idempotencyKey
        );

      const existing =
        await this.getIdempotentResult(
          operationKey
        );

      if (existing) {
        this.metrics.idempotentHits++;

        return existing;
      }

      const usage = {
        id:
          crypto.randomUUID(),

        tenantId,

        metric:
          String(metric)
            .trim(),

        quantity:
          normalizedQuantity,

        metadata:
          this.cloneMetadata(
            metadata
          ),

        timestamp:
          new Date(),

        createdAt:
          new Date(),
      };

      await this.db.usageRecords.create(
        usage
      );

      this.metrics.usageRecordsCreated++;

      await this.audit(
        tenantId,
        'BILLING_USAGE_RECORDED',
        {
          usageId:
            usage.id,

          metric:
            usage.metric,

          quantity:
            usage.quantity,
        }
      );

      await this.storeIdempotentResult(
        operationKey,
        usage
      );

      return usage;
    } catch (error) {
      this.recordFailure(
        'recordUsage'
      );

      this.logError(
        'Failed to record billing usage.',
        error,
        {
          tenantId,
        }
      );

      throw error;
    }
  }

  async getUsage(
    tenantId,
    startDate,
    endDate
  ) {
    this.assertTenantId(
      tenantId
    );

    if (
      !startDate ||
      !endDate
    ) {
      throw new BillingError(
        'Usage date range is required.',
        {
          code:
            'USAGE_DATE_RANGE_REQUIRED',
        }
      );
    }

    const start =
      new Date(
        startDate
      );

    const end =
      new Date(
        endDate
      );

    if (
      Number.isNaN(
        start.getTime()
      ) ||
      Number.isNaN(
        end.getTime()
      ) ||
      start > end
    ) {
      throw new BillingError(
        'Invalid usage date range.',
        {
          code:
            'INVALID_USAGE_DATE_RANGE',
        }
      );
    }

    this.assertDatabase();

    return this.db.usageRecords.find({
      tenantId,

      timestamp: {
        $gte:
          start,

        $lte:
          end,
      },
    });
  }

  /**
   * ==========================================================================
   * OVERDUE INVOICES
   * ==========================================================================
   */

  async processOverdueInvoices() {
    this.assertDatabase();

    const now =
      new Date();

    const overdue =
      await this.db.invoices.find({
        status:
          INVOICE_STATUS.PENDING,

        dueDate: {
          $lt:
            now,
        },
      });

    const results = [];

    for (
      const invoice of overdue
    ) {
      try {
        const result =
          await this.handleOverdueInvoice(
            invoice
          );

        results.push(
          result
        );
      } catch (error) {
        this.recordFailure(
          'processOverdueInvoices'
        );

        this.logError(
          'Failed processing overdue invoice.',
          error,
          {
            invoiceId:
              invoice.id,
          }
        );
      }
    }

    return results;
  }

  async handleOverdueInvoice(
    invoice
  ) {
    if (!invoice?.id) {
      throw new BillingError(
        'Invalid invoice.',
        {
          code:
            'INVALID_INVOICE',
        }
      );
    }

    const now =
      new Date();

    const updated = {
      ...invoice,

      status:
        INVOICE_STATUS.OVERDUE,

      overdueAt:
        invoice.overdueAt ||
        now,

      retryCount:
        Number(
          invoice.retryCount || 0
        ),

      updatedAt:
        now,

      version:
        Number(
          invoice.version || 0
        ) + 1,
    };

    await this.updateInvoiceSafely(
      invoice.id,
      updated,
      invoice
    );

    /**
     * An overdue invoice should also place the subscription into a
     * recoverable delinquent lifecycle state.
     */
    await this.transitionSubscriptionToPastDue(
      updated,
      {
        reason:
          'INVOICE_OVERDUE',
      }
    );

    this.metrics.invoicesOverdue++;
    this.metrics.overdueProcessed++;

    await this.audit(
      invoice.tenantId,
      'INVOICE_OVERDUE',
      {
        invoiceId:
          invoice.id,

        invoiceReference:
          this.getInvoiceReference(
            invoice
          ),

        dueDate:
          invoice.dueDate,

        total:
          invoice.total,
      }
    );

    await this.notifySafe({
      tenantId:
        invoice.tenantId,

      type:
        'billing_overdue',

      data: {
        invoiceId:
          invoice.id,

        invoiceReference:
          this.getInvoiceReference(
            invoice
          ),

        amount:
          invoice.total,

        currency:
          invoice.currency,

        dueDate:
          invoice.dueDate,
      },
    });

    const retryCount =
      Number(
        invoice.retryCount || 0
      );

    if (
      retryCount <
      this.config.retryAttempts
    ) {
      await this.enqueueSafe(
        'billing-retry',
        {
          invoiceId:
            invoice.id,

          invoiceReference:
            this.getInvoiceReference(
              invoice
            ),

          tenantId:
            invoice.tenantId,

          retryCount:
            retryCount + 1,
        },
        {
          jobId:
            `billing-retry:${invoice.id}:${retryCount + 1}`,

          delay:
            this.config
              .retryDelayHours *
            60 *
            60 *
            1000,
        }
      );
    }

    return updated;
  }

  /**
   * ==========================================================================
   * BILLING CYCLE
   * ==========================================================================
   */

  async processBillingCycle() {
    this.assertDatabase();

    const now =
      new Date();

    const subscriptions =
      await this.db.tenantSubscriptions.find({
        status: {
          $in:
            this.config
              .billableSubscriptionStatuses,
        },

        currentPeriodEnd: {
          $lte:
            now,
        },
      });

    const results = [];

    for (
      const subscription of subscriptions
    ) {
      try {
        const result =
          await this.processSubscriptionBillingCycle(
            subscription
          );

        results.push(
          result
        );

        this.metrics
          .billingCyclesProcessed++;
      } catch (error) {
        this.metrics
          .billingCycleFailures++;

        this.logError(
          'Billing cycle failed.',
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

    return results;
  }

  async processSubscriptionBillingCycle(
    subscription
  ) {
    if (!subscription?.id) {
      throw new BillingError(
        'Invalid subscription.',
        {
          code:
            'INVALID_SUBSCRIPTION',
        }
      );
    }

    const tenantId =
      subscription.tenantId;

    const plan =
      await this.getRequiredPlan(
        subscription.planId
      );

    /**
     * The renewal operation is responsible for duplicate prevention.
     */
    const renewal =
      await this.generateSubscriptionRenewal(
        subscription,
        {
          periodStart:
            subscription.currentPeriodStart,

          periodEnd:
            subscription.currentPeriodEnd,

          source:
            'billing-cycle',
        }
      );

    /**
     * Cancellation at period end does not advance into another billable period.
     */
    if (
      subscription.cancelAtPeriodEnd
    ) {
      const updated = {
        ...subscription,

        status:
          'cancelled',

        cancelledAt:
          subscription.cancelledAt ||
          new Date(),

        updatedAt:
          new Date(),

        version:
          Number(
            subscription.version || 0
          ) + 1,
      };

      await this.updateSubscriptionSafely(
        subscription.id,
        updated,
        subscription
      );

      await this.invalidateTenantCache(
        tenantId
      );

      this.emitSafe(
        'tenant.subscription.cancelled',
        updated
      );

      return {
        subscription:
          updated,

        invoice:
          renewal.invoice,

        invoiceId:
          renewal.invoiceId,

        invoiceReference:
          renewal.invoiceReference,

        renewal,
      };
    }

    const nextPeriodStart =
      new Date(
        subscription.currentPeriodEnd
      );

    const nextPeriodEnd =
      this.calculateNextBillingDate(
        nextPeriodStart,
        plan.billingCycle
      );

    const updated = {
      ...subscription,

      currentPeriodStart:
        nextPeriodStart,

      currentPeriodEnd:
        nextPeriodEnd,

      updatedAt:
        new Date(),

      version:
        Number(
          subscription.version || 0
        ) + 1,
    };

    await this.updateSubscriptionSafely(
      subscription.id,
      updated,
      subscription
    );

    await this.invalidateTenantCache(
      tenantId
    );

    this.emitSafe(
      'tenant.subscription.renewed',
      {
        subscription:
          updated,

        invoice:
          renewal.invoice,

        invoiceId:
          renewal.invoiceId,

        invoiceReference:
          renewal.invoiceReference,
      }
    );

    return {
      subscription:
        updated,

      invoice:
        renewal.invoice,

      invoiceId:
        renewal.invoiceId,

      invoiceReference:
        renewal.invoiceReference,

      renewal,
    };
  }

  /**
   * ==========================================================================
   * GRACE / SUSPENSION
   * ==========================================================================
   */

  async processGracePeriods() {
    this.assertDatabase();

    const subscriptions =
      await this.db.tenantSubscriptions.find({
        status: {
          $in: [
            'past_due',
            'grace',
          ],
        },
      });

    const results = [];

    for (
      const subscription of subscriptions
    ) {
      const graceStart =
        subscription.graceStartedAt ||
        subscription.pastDueAt ||
        subscription.updatedAt ||
        subscription.createdAt;

      const graceEnd =
        this.addDays(
          new Date(
            graceStart
          ),
          this.config
            .gracePeriodDays
        );

      if (
        new Date() >
        graceEnd
      ) {
        const updated = {
          ...subscription,

          status:
            'suspended',

          suspendedAt:
            new Date(),

          suspensionReason:
            'BILLING_GRACE_PERIOD_EXPIRED',

          updatedAt:
            new Date(),

          version:
            Number(
              subscription.version || 0
            ) + 1,
        };

        await this.updateSubscriptionSafely(
          subscription.id,
          updated,
          subscription
        );

        await this.suspendTenant(
          subscription.tenantId,
          'BILLING_GRACE_PERIOD_EXPIRED'
        );

        results.push(
          updated
        );
      }
    }

    return results;
  }

  /**
   * ==========================================================================
   * TENANT SUSPENSION
   * ==========================================================================
   */

  async suspendTenant(
    tenantId,
    reason
  ) {
    this.assertTenantId(
      tenantId
    );

    this.assertDatabase();

    await this.db.tenants.update(
      tenantId,
      {
        status:
          'suspended',

        suspendedAt:
          new Date(),

        suspensionReason:
          reason,
      }
    );

    this.metrics.tenantsSuspended++;

    await this.audit(
      tenantId,
      'TENANT_SUSPENDED',
      {
        reason,
      }
    );

    this.emitSafe(
      'tenant.suspended',
      {
        tenantId,
        reason,
      }
    );

    await this.notifySafe({
      tenantId,

      type:
        'tenant_suspended',

      data: {
        reason,
      },
    });

    await this.invalidateTenantCache(
      tenantId
    );
  }

  async reactivateTenant(
    tenantId
  ) {
    this.assertTenantId(
      tenantId
    );

    this.assertDatabase();

    await this.db.tenants.update(
      tenantId,
      {
        status:
          'active',

        suspendedAt:
          null,

        suspensionReason:
          null,
      }
    );

    this.metrics.tenantsReactivated++;

    await this.audit(
      tenantId,
      'TENANT_REACTIVATED'
    );

    this.emitSafe(
      'tenant.reactivated',
      {
        tenantId,
      }
    );

    await this.invalidateTenantCache(
      tenantId
    );
  }

  /**
   * ==========================================================================
   * WEBHOOKS
   * ==========================================================================
   */

  async processWebhook(
    payload = {},
    {
      idempotencyKey = null,
    } = {}
  ) {
    if (
      !payload ||
      typeof payload !==
        'object'
    ) {
      throw new BillingError(
        'Invalid webhook payload.',
        {
          code:
            'INVALID_WEBHOOK_PAYLOAD',
        }
      );
    }

    const sourceKey =
      idempotencyKey ||
      payload.id ||
      payload.eventId ||
      payload.reference;

    if (!sourceKey) {
      throw new BillingError(
        'Webhook idempotency key is required.',
        {
          code:
            'WEBHOOK_IDEMPOTENCY_KEY_REQUIRED',
        }
      );
    }

    const operationKey =
      this.createDeterministicOperationKey(
        'subscription-webhook',
        {
          sourceKey,
          eventType:
            payload.eventType ||
            payload.type ||
            payload.status,
        }
      );

    const existing =
      await this.getIdempotentResult(
        operationKey
      );

    if (existing) {
      this.metrics.idempotentHits++;

      return existing;
    }

    /**
     * Payment callbacks are handled immediately so that lifecycle recovery
     * is not delayed unnecessarily.
     */
    const type =
      String(
        payload.eventType ||
        payload.type ||
        ''
      )
        .toLowerCase();

    if (
      type.includes('payment') ||
      payload.paymentId ||
      payload.transactionId
    ) {
      try {
        const result =
          await this.processPaymentRecoveryCallback(
            payload,
            {
              idempotencyKey:
                operationKey,
            }
          );

        await this.storeIdempotentResult(
          operationKey,
          result
        );

        return result;
      } catch (error) {
        /**
         * Continue to queue unknown webhook shapes.
         */
        this.logWarn(
          'Webhook was not processed as a payment recovery callback.',
          {
            error:
              this.safeErrorMessage(
                error
              ),
          }
        );
      }
    }

    const result = {
      accepted:
        true,

      queuedAt:
        new Date(),

      eventId:
        payload.eventId ||
        payload.id ||
        crypto.randomUUID(),

      operationKey,
    };

    await this.enqueueSafe(
      'subscription-webhook',
      payload,
      {
        jobId:
          `subscription-webhook:${operationKey}`,
      }
    );

    await this.storeIdempotentResult(
      operationKey,
      result
    );

    await this.audit(
      payload.tenantId ||
        null,
      'SUBSCRIPTION_WEBHOOK_ACCEPTED',
      {
        eventId:
          result.eventId,

        eventType:
          payload.eventType ||
          payload.type,
      }
    );

    return result;
  }

  /**
   * ==========================================================================
   * BILLING OPERATION CLAIMING
   * ==========================================================================
   *
   * Preferred repository contract:
   *
   * billingOperations.claim(operationKey, payload)
   *
   * or:
   *
   * findOneAndUpdate(
   *   { operationKey },
   *   {
   *     $setOnInsert: {
   *       status: 'processing',
   *       ...
   *     }
   *   },
   *   { upsert: true, new: true }
   * )
   *
   * Fallback:
   *
   * Cache add/setNX if available.
   */

  async claimBillingOperation(
    operationKey,
    payload = {}
  ) {
    this.assertRequired(
      operationKey,
      'operationKey'
    );

    const repository =
      this.db?.billingOperations;

    /**
     * Preferred custom repository primitive.
     */
    if (
      repository &&
      typeof repository.claim ===
        'function'
    ) {
      const result =
        await repository.claim(
          operationKey,
          {
            operationKey,

            status:
              BILLING_OPERATION_STATUS.PROCESSING,

            ...payload,

            claimedAt:
              new Date(),

            expiresAt:
              this.addSeconds(
                new Date(),
                this.config
                  .operationClaimTtl
              ),
          }
        );

      const claimed =
        Boolean(
          result?.claimed ??
          result?.created ??
          result === true
        );

      if (claimed) {
        this.metrics.operationsClaimed++;
      } else {
        this.metrics.operationClaimConflicts++;
      }

      return {
        claimed,

        operation:
          result?.operation ||
          result ||
          null,
      };
    }

    /**
     * Generic atomic repository support.
     */
    if (
      repository &&
      typeof repository.findOneAndUpdate ===
        'function'
    ) {
      const now =
        new Date();

      const created =
        await repository.findOneAndUpdate(
          {
            operationKey,
          },
          {
            $setOnInsert: {
              id:
                crypto.randomUUID(),

              operationKey,

              status:
                BILLING_OPERATION_STATUS.PROCESSING,

              ...payload,

              createdAt:
                now,

              updatedAt:
                now,

              claimedAt:
                now,

              expiresAt:
                this.addSeconds(
                  now,
                  this.config
                    .operationClaimTtl
                ),
            },
          },
          {
            upsert:
              true,

            new:
              true,
          }
        );

      const operation =
        created?.value ||
        created;

      const claimed =
        Boolean(
          operation &&
          operation.status ===
            BILLING_OPERATION_STATUS.PROCESSING &&
          String(
            operation.operationKey
          ) ===
            operationKey
        );

      if (claimed) {
        this.metrics.operationsClaimed++;
      }

      return {
        claimed,
        operation,
      };
    }

    /**
     * Cache atomic primitive fallback.
     */
    const cacheKey =
      this.operationClaimCacheKey(
        operationKey
      );

    if (
      this.cache &&
      typeof this.cache.setNX ===
        'function'
    ) {
      const claimed =
        await this.cache.setNX(
          cacheKey,
          {
            operationKey,

            status:
              BILLING_OPERATION_STATUS.PROCESSING,

            ...payload,

            claimedAt:
              new Date(),
          },
          this.config.operationClaimTtl
        );

      if (claimed) {
        this.metrics.operationsClaimed++;
      } else {
        this.metrics.operationClaimConflicts++;
      }

      return {
        claimed:
          Boolean(claimed),
      };
    }

    /**
     * Last-resort non-atomic compatibility fallback.
     *
     * Production deployments should provide billingOperations or cache.setNX.
     */
    const existing =
      await this.getIdempotentResult(
        cacheKey
      );

    if (existing) {
      this.metrics.operationClaimConflicts++;

      return {
        claimed:
          false,

        operation:
          existing,
      };
    }

    await this.storeIdempotentResult(
      cacheKey,
      {
        operationKey,

        status:
          BILLING_OPERATION_STATUS.PROCESSING,

        ...payload,

        claimedAt:
          new Date(),
      }
    );

    this.metrics.operationsClaimed++;

    return {
      claimed:
        true,
    };
  }

  async completeBillingOperation(
    operationKey,
    result
  ) {
    const repository =
      this.db?.billingOperations;

    const record = {
      operationKey,

      status:
        BILLING_OPERATION_STATUS.SUCCEEDED,

      result,

      completedAt:
        new Date(),

      updatedAt:
        new Date(),
    };

    if (
      repository &&
      typeof repository.complete ===
        'function'
    ) {
      await repository.complete(
        operationKey,
        record
      );
    } else if (
      repository &&
      typeof repository.updateByOperationKey ===
        'function'
    ) {
      await repository.updateByOperationKey(
        operationKey,
        record
      );
    } else if (
      repository &&
      typeof repository.updateOne ===
        'function'
    ) {
      await repository.updateOne(
        {
          operationKey,
        },
        {
          $set:
            record,
        }
      );
    }

    await this.storeIdempotentResult(
      operationKey,
      result
    );

    return record;
  }

  async failBillingOperation(
    operationKey,
    error
  ) {
    if (!operationKey) {
      return;
    }

    const repository =
      this.db?.billingOperations;

    const record = {
      operationKey,

      status:
        BILLING_OPERATION_STATUS.RECOVERABLE,

      error:
        this.safeErrorMessage(
          error
        ),

      errorCode:
        error?.code,

      failedAt:
        new Date(),

      updatedAt:
        new Date(),
    };

    try {
      if (
        repository &&
        typeof repository.fail ===
          'function'
      ) {
        await repository.fail(
          operationKey,
          record
        );
      } else if (
        repository &&
        typeof repository.updateByOperationKey ===
          'function'
      ) {
        await repository.updateByOperationKey(
          operationKey,
          record
        );
      } else if (
        repository &&
        typeof repository.updateOne ===
          'function'
      ) {
        await repository.updateOne(
          {
            operationKey,
          },
          {
            $set:
              record,
          }
        );
      }
    } catch (operationError) {
      this.logError(
        'Failed to update billing operation state.',
        operationError,
        {
          operationKey,
        }
      );
    }
  }

  async getCompletedBillingOperation(
    operationKey
  ) {
    const repository =
      this.db?.billingOperations;

    try {
      if (
        repository &&
        typeof repository.findOne ===
          'function'
      ) {
        const operation =
          await repository.findOne({
            operationKey,

            status:
              BILLING_OPERATION_STATUS.SUCCEEDED,
          });

        if (
          operation?.result
        ) {
          return operation.result;
        }
      }
    } catch (error) {
      this.logWarn(
        'Billing operation repository lookup failed.',
        {
          operationKey,

          error:
            this.safeErrorMessage(
              error
            ),
        }
      );
    }

    return this.getIdempotentResult(
      operationKey
    );
  }

  async storeBillingOperationSuccess(
    operationKey,
    result
  ) {
    try {
      await this.completeBillingOperation(
        operationKey,
        result
      );
    } catch (error) {
      this.logWarn(
        'Unable to persist billing operation success.',
        {
          operationKey,

          error:
            this.safeErrorMessage(
              error
            ),
        }
      );

      await this.storeIdempotentResult(
        operationKey,
        result
      );
    }
  }

  async waitForBillingOperationResult(
    operationKey,
    {
      attempts = 3,
      delayMs = 150,
    } = {}
  ) {
    for (
      let attempt = 0;
      attempt < attempts;
      attempt++
    ) {
      const result =
        await this.getCompletedBillingOperation(
          operationKey
        );

      if (result) {
        return result;
      }

      if (
        attempt <
        attempts - 1
      ) {
        await this.sleep(
          delayMs *
          (attempt + 1)
        );
      }
    }

    return null;
  }

  /**
   * ==========================================================================
   * INVOICE / SUBSCRIPTION RESOLUTION
   * ==========================================================================
   */

  async resolveSubscription(
    subscriptionOrId
  ) {
    if (!subscriptionOrId) {
      return null;
    }

    if (
      typeof subscriptionOrId ===
      'object'
    ) {
      return subscriptionOrId;
    }

    this.assertDatabase();

    return this.db
      .tenantSubscriptions
      .findById(
        subscriptionOrId
      );
  }

  async resolveInvoice(
    invoiceId
  ) {
    if (!invoiceId) {
      return null;
    }

    return this.db.invoices.findById(
      invoiceId
    );
  }

  async resolveInvoiceFromReference(
    payload
  ) {
    if (
      payload.invoiceId
    ) {
      const invoice =
        await this.resolveInvoice(
          payload.invoiceId
        );

      if (invoice) {
        return invoice;
      }
    }

    const reference =
      payload.invoiceReference ||
      payload.invoiceNumber ||
      payload.reference;

    if (
      !reference
    ) {
      return null;
    }

    return this.db.invoices.findOne({
      $or: [
        {
          invoiceNumber:
            reference,
        },
        {
          reference,
        },
        {
          id:
            reference,
        },
      ],
    });
  }

  async findInvoiceForSubscriptionPeriod(
    subscriptionId,
    periodStart,
    periodEnd
  ) {
    this.assertDatabase();

    const start =
      new Date(
        periodStart
      );

    const end =
      new Date(
        periodEnd
      );

    const direct =
      await this.db.invoices.findOne({
        subscriptionId,

        periodStart:
          start,

        periodEnd:
          end,
      });

    if (direct) {
      return direct;
    }

    /**
     * Compatibility fallback for repositories that serialize dates
     * differently.
     */
    const invoices =
      await this.db.invoices.find({
        subscriptionId,
      });

    const startTime =
      start.getTime();

    const endTime =
      end.getTime();

    return (
      invoices.find(
        (invoice) =>
          new Date(
            invoice.periodStart
          ).getTime() ===
            startTime &&
          new Date(
            invoice.periodEnd
          ).getTime() ===
            endTime
      ) ||
      null
    );
  }

  /**
   * ==========================================================================
   * COMPATIBLE RETURN CONTRACTS
   * ==========================================================================
   *
   * Existing callers may consume:
   *
   *   invoice.id
   *
   * Others may expect:
   *
   *   invoiceId
   *   invoiceReference
   *   invoiceNumber
   *
   * The returned invoice therefore retains the original object while exposing
   * stable aliases.
   */

  normalizeInvoiceReturn(
    invoice
  ) {
    if (!invoice) {
      return invoice;
    }

    const invoiceId =
      this.getInvoiceIdentifier(
        invoice
      );

    const invoiceReference =
      this.getInvoiceReference(
        invoice
      );

    return {
      ...invoice,

      invoiceId,

      invoiceReference,

      reference:
        invoice.reference ||
        invoiceReference,
    };
  }

  getInvoiceIdentifier(
    invoice
  ) {
    return (
      invoice?.invoiceId ||
      invoice?.id ||
      invoice?._id ||
      null
    );
  }

  getInvoiceReference(
    invoice
  ) {
    return (
      invoice?.invoiceReference ||
      invoice?.invoiceNumber ||
      invoice?.reference ||
      this.getInvoiceIdentifier(
        invoice
      )
    );
  }

  createRenewalResult(
    subscription,
    invoice,
    {
      duplicate = false,
      source = null,
    } = {}
  ) {
    const normalizedInvoice =
      this.normalizeInvoiceReturn(
        invoice
      );

    return {
      subscription,

      subscriptionId:
        subscription.id,

      invoice:
        normalizedInvoice,

      invoiceId:
        normalizedInvoice.invoiceId,

      invoiceReference:
        normalizedInvoice.invoiceReference,

      duplicate,

      source,

      generatedAt:
        new Date(),
    };
  }

  normalizeRenewalOperationResult(
    result
  ) {
    if (
      result?.invoice
    ) {
      return {
        ...result,

        invoice:
          this.normalizeInvoiceReturn(
            result.invoice
          ),

        invoiceId:
          result.invoiceId ||
          this.getInvoiceIdentifier(
            result.invoice
          ),

        invoiceReference:
          result.invoiceReference ||
          this.getInvoiceReference(
            result.invoice
          ),
      };
    }

    /**
     * Recovery path when an older operation stored only the invoice.
     */
    if (
      result?.id ||
      result?.invoiceNumber
    ) {
      const invoice =
        this.normalizeInvoiceReturn(
          result
        );

      return {
        invoice,

        invoiceId:
          invoice.invoiceId,

        invoiceReference:
          invoice.invoiceReference,

        duplicate:
          true,
      };
    }

    return result;
  }

  /**
   * ==========================================================================
   * OPTIMISTIC UPDATE SAFETY
   * ==========================================================================
   */

  async updateSubscriptionSafely(
    subscriptionId,
    updated,
    previous
  ) {
    const repository =
      this.db.tenantSubscriptions;

    /**
     * Preferred optimistic locking support.
     */
    if (
      typeof repository.updateOne ===
      'function'
    ) {
      const expectedVersion =
        previous?.version;

      if (
        expectedVersion !==
        undefined
      ) {
        const result =
          await repository.updateOne(
            {
              id:
                subscriptionId,

              version:
                expectedVersion,
            },
            {
              $set:
                updated,
            }
          );

        if (
          result &&
          (
            result.matchedCount === 0 ||
            result.modifiedCount === 0 &&
            result.matchedCount === 0
          )
        ) {
          throw new BillingError(
            'Subscription was modified concurrently.',
            {
              code:
                'SUBSCRIPTION_CONCURRENCY_CONFLICT',
              statusCode:
                409,
              retryable:
                true,
            }
          );
        }

        return result;
      }
    }

    await repository.update(
      subscriptionId,
      updated
    );
  }

  async updateInvoiceSafely(
    invoiceId,
    updated,
    previous
  ) {
    const repository =
      this.db.invoices;

    if (
      typeof repository.updateOne ===
      'function'
    ) {
      const expectedVersion =
        previous?.version;

      if (
        expectedVersion !==
        undefined
      ) {
        const result =
          await repository.updateOne(
            {
              id:
                invoiceId,

              version:
                expectedVersion,
            },
            {
              $set:
                updated,
            }
          );

        if (
          result &&
          result.matchedCount ===
            0
        ) {
          throw new BillingError(
            'Invoice was modified concurrently.',
            {
              code:
                'INVOICE_CONCURRENCY_CONFLICT',
              statusCode:
                409,
              retryable:
                true,
            }
          );
        }

        return result;
      }
    }

    await repository.update(
      invoiceId,
      updated
    );
  }

  async updateInvoiceFields(
    invoiceId,
    fields
  ) {
    const invoice =
      await this.db.invoices.findById(
        invoiceId
      );

    if (!invoice) {
      throw new BillingError(
        'Invoice not found.',
        {
          code:
            'INVOICE_NOT_FOUND',

          statusCode:
            404,
        }
      );
    }

    const updated = {
      ...invoice,
      ...fields,

      version:
        Number(
          invoice.version || 0
        ) + 1,
    };

    await this.updateInvoiceSafely(
      invoiceId,
      updated,
      invoice
    );

    return updated;
  }

  async createSubscriptionSafely(
    subscription
  ) {
    try {
      await this.db
        .tenantSubscriptions
        .create(
          subscription
        );
    } catch (error) {
      if (
        this.isDuplicateKeyError(
          error
        )
      ) {
        throw new BillingError(
          'Tenant already has an active subscription.',
          {
            code:
              'ACTIVE_SUBSCRIPTION_EXISTS',

            statusCode:
              409,

            cause:
              error,
          }
        );
      }

      throw error;
    }
  }

  /**
   * ==========================================================================
   * SUBSCRIPTION RECOVERY FALLBACK
   * ==========================================================================
   */

  async markSubscriptionRecoveredFallback(
    invoice
  ) {
    if (
      !invoice?.subscriptionId
    ) {
      return null;
    }

    const subscription =
      await this.resolveSubscription(
        invoice.subscriptionId
      );

    if (!subscription) {
      return null;
    }

    if (
      subscription.status ===
      'cancelled'
    ) {
      return subscription;
    }

    const updated = {
      ...subscription,

      status:
        'active',

      pastDueAt:
        null,

      graceStartedAt:
        null,

      suspendedAt:
        null,

      suspensionReason:
        null,

      updatedAt:
        new Date(),

      version:
        Number(
          subscription.version || 0
        ) + 1,
    };

    await this.updateSubscriptionSafely(
      subscription.id,
      updated,
      subscription
    );

    await this.invalidateTenantCache(
      subscription.tenantId
    );

    this.emitSafe(
      'tenant.subscription.recovered',
      {
        subscription:
          updated,

        invoiceId:
          invoice.id,
      }
    );

    return updated;
  }

  /**
   * ==========================================================================
   * CACHE
   * ==========================================================================
   */

  subscriptionCacheKey(
    tenantId
  ) {
    return `billing:subscription:${tenantId}`;
  }

  operationClaimCacheKey(
    operationKey
  ) {
    return `billing:operation:claim:${operationKey}`;
  }

  async invalidateTenantCache(
    tenantId
  ) {
    if (!this.cache) {
      return;
    }

    try {
      await this.cache.del(
        this.subscriptionCacheKey(
          tenantId
        )
      );
    } catch (error) {
      this.logWarn(
        'Billing cache invalidation failed.',
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
   * DETERMINISTIC IDEMPOTENCY
   * ==========================================================================
   */

  createDeterministicOperationKey(
    operation,
    payload = {},
    suppliedKey = null
  ) {
    if (
      suppliedKey &&
      String(
        suppliedKey
      ).trim()
    ) {
      return `billing:idempotency:${this.hashValue(
        String(
          suppliedKey
        ).trim()
      )}`;
    }

    const canonical =
      this.stableStringify({
        operation,
        payload,
      });

    return `billing:idempotency:${this.hashValue(
      canonical
    )}`;
  }

  buildIdempotencyKey(
    ...parts
  ) {
    return this.createDeterministicOperationKey(
      'legacy',
      {
        parts,
      }
    );
  }

  hashValue(
    value
  ) {
    return crypto
      .createHash(
        'sha256'
      )
      .update(
        String(value)
      )
      .digest(
        'hex'
      );
  }

  stableStringify(
    value
  ) {
    if (
      value === null ||
      typeof value !==
        'object'
    ) {
      return JSON.stringify(
        value
      );
    }

    if (
      value instanceof Date
    ) {
      return JSON.stringify(
        value.toISOString()
      );
    }

    if (
      Array.isArray(
        value
      )
    ) {
      return `[${value
        .map(
          (item) =>
            this.stableStringify(
              item
            )
        )
        .join(',')}]`;
    }

    const keys =
      Object.keys(
        value
      ).sort();

    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(
            key
          )}:${this.stableStringify(
            value[key]
          )}`
      )
      .join(',')}}`;
  }

  createBillingPeriodIdentity(
    periodStart,
    periodEnd
  ) {
    const start =
      new Date(
        periodStart
      );

    const end =
      new Date(
        periodEnd
      );

    if (
      Number.isNaN(
        start.getTime()
      ) ||
      Number.isNaN(
        end.getTime()
      )
    ) {
      throw new BillingError(
        'Invalid billing period.',
        {
          code:
            'INVALID_BILLING_PERIOD',
        }
      );
    }

    return {
      start:
        start.toISOString(),

      end:
        end.toISOString(),
    };
  }

  async getIdempotentResult(
    key
  ) {
    if (!this.cache) {
      return null;
    }

    try {
      return await this.cache.get(
        key
      );
    } catch (error) {
      this.logWarn(
        'Idempotency cache read failed.',
        {
          error:
            error.message,
        }
      );

      return null;
    }
  }

  async storeIdempotentResult(
    key,
    value
  ) {
    if (!this.cache) {
      return;
    }

    try {
      await this.cache.set(
        key,
        value,
        this.config
          .idempotencyTtl
      );
    } catch (error) {
      this.logWarn(
        'Idempotency cache write failed.',
        {
          error:
            error.message,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * DATE / MONEY HELPERS
   * ==========================================================================
   */

  calculateNextBillingDate(
    startDate,
    cycle
  ) {
    const date =
      new Date(
        startDate
      );

    if (
      Number.isNaN(
        date.getTime()
      )
    ) {
      throw new BillingError(
        'Invalid billing start date.',
        {
          code:
            'INVALID_BILLING_DATE',
        }
      );
    }

    const normalizedCycle =
      cycle ||
      'monthly';

    switch (
      normalizedCycle
    ) {
      case 'weekly':
        date.setDate(
          date.getDate() + 7
        );
        break;

      case 'monthly':
        this.addCalendarMonths(
          date,
          1
        );
        break;

      case 'quarterly':
        this.addCalendarMonths(
          date,
          3
        );
        break;

      case 'yearly':
        date.setFullYear(
          date.getFullYear() + 1
        );
        break;

      default:
        throw new BillingError(
          `Unsupported billing cycle: ${normalizedCycle}`,
          {
            code:
              'UNSUPPORTED_BILLING_CYCLE',
          }
        );
    }

    return date;
  }

  addCalendarMonths(
    date,
    months
  ) {
    const day =
      date.getDate();

    date.setDate(
      1
    );

    date.setMonth(
      date.getMonth() +
      months
    );

    const lastDay =
      new Date(
        date.getFullYear(),
        date.getMonth() + 1,
        0
      ).getDate();

    date.setDate(
      Math.min(
        day,
        lastDay
      )
    );

    return date;
  }

  calculateProration(
    oldPlan,
    newPlan,
    subscription
  ) {
    const periodStart =
      new Date(
        subscription.currentPeriodStart
      ).getTime();

    const periodEnd =
      new Date(
        subscription.currentPeriodEnd
      ).getTime();

    const now =
      Date.now();

    const total =
      periodEnd -
      periodStart;

    const remaining =
      Math.max(
        0,
        periodEnd -
          Math.max(
            now,
            periodStart
          )
      );

    if (
      total <= 0
    ) {
      return {
        credit:
          0,

        charge:
          0,

        difference:
          0,

        ratio:
          0,
      };
    }

    const ratio =
      Math.min(
        1,
        Math.max(
          0,
          remaining /
            total
        )
      );

    const oldPrice =
      this.normalizeMoney(
        oldPlan.price
      );

    const newPrice =
      this.normalizeMoney(
        newPlan.price
      );

    const credit =
      this.roundMoney(
        oldPrice *
        ratio
      );

    const charge =
      this.roundMoney(
        newPrice *
        ratio
      );

    return {
      credit,

      charge,

      difference:
        this.roundMoney(
          charge -
          credit
        ),

      ratio,
    };
  }

  generateInvoiceNumber() {
    const timestamp =
      Date.now()
        .toString(36)
        .toUpperCase();

    const random =
      crypto
        .randomBytes(5)
        .toString('hex')
        .toUpperCase();

    return `${this.config.invoicePrefix}-${timestamp}-${random}`;
  }

  normalizeMoney(
    value
  ) {
    const amount =
      Number(value);

    if (
      !Number.isFinite(
        amount
      ) ||
      amount < 0
    ) {
      throw new BillingError(
        'Invalid monetary amount.',
        {
          code:
            'INVALID_MONETARY_AMOUNT',
        }
      );
    }

    if (
      amount >
      this.config.maxPlanPrice
    ) {
      throw new BillingError(
        'Monetary amount exceeds configured maximum.',
        {
          code:
            'MONETARY_AMOUNT_EXCEEDED',
        }
      );
    }

    return this.roundMoney(
      amount
    );
  }

  roundMoney(
    amount
  ) {
    return Math.round(
      (
        Number(amount) +
        Number.EPSILON
      ) *
        100
    ) / 100;
  }

  addDays(
    date,
    days
  ) {
    const result =
      new Date(
        date
      );

    result.setDate(
      result.getDate() +
      Number(days)
    );

    return result;
  }

  addSeconds(
    date,
    seconds
  ) {
    const result =
      new Date(
        date
      );

    result.setSeconds(
      result.getSeconds() +
      Number(seconds)
    );

    return result;
  }

  sleep(
    milliseconds
  ) {
    return new Promise(
      (resolve) =>
        setTimeout(
          resolve,
          milliseconds
        )
    );
  }

  /**
   * ==========================================================================
   * VALIDATION
   * ==========================================================================
   */

  validatePlanPayload(
    payload
  ) {
    if (
      !payload.name ||
      typeof payload.name !==
        'string'
    ) {
      throw new BillingError(
        'Plan name is required.',
        {
          code:
            'INVALID_PLAN_NAME',
        }
      );
    }

    if (
      !payload.code ||
      typeof payload.code !==
        'string'
    ) {
      throw new BillingError(
        'Plan code is required.',
        {
          code:
            'INVALID_PLAN_CODE',
        }
      );
    }

    const price =
      this.normalizeMoney(
        payload.price
      );

    const billingCycle =
      payload.billingCycle ||
      'monthly';

    if (
      !this.config
        .supportedBillingCycles
        .includes(
          billingCycle
        )
    ) {
      throw new BillingError(
        'Unsupported billing cycle.',
        {
          code:
            'UNSUPPORTED_BILLING_CYCLE',
        }
      );
    }

    const trialDays =
      Number(
        payload.trialDays || 0
      );

    if (
      !Number.isInteger(
        trialDays
      ) ||
      trialDays < 0
    ) {
      throw new BillingError(
        'Trial days must be a non-negative integer.',
        {
          code:
            'INVALID_TRIAL_DAYS',
        }
      );
    }

    return {
      name:
        payload.name.trim(),

      code:
        payload.code
          .trim()
          .toUpperCase(),

      price,

      currency:
        String(
          payload.currency ||
          this.config
            .defaultCurrency
        )
          .trim()
          .toUpperCase(),

      billingCycle,

      trialDays,

      features:
        Array.isArray(
          payload.features
        )
          ? [
              ...new Set(
                payload.features
              ),
            ]
          : [],

      limits:
        this.cloneMetadata(
          payload.limits ||
          {}
        ),

      metadata:
        this.cloneMetadata(
          payload.metadata ||
          {}
        ),
    };
  }

  validatePlanUpdate(
    updates
  ) {
    const normalized = {
      ...updates,
    };

    if (
      normalized.price !==
      undefined
    ) {
      normalized.price =
        this.normalizeMoney(
          normalized.price
        );
    }

    if (
      normalized.billingCycle !==
      undefined
    ) {
      if (
        !this.config
          .supportedBillingCycles
          .includes(
            normalized.billingCycle
          )
      ) {
        throw new BillingError(
          'Unsupported billing cycle.',
          {
            code:
              'UNSUPPORTED_BILLING_CYCLE',
          }
        );
      }
    }

    if (
      normalized.trialDays !==
      undefined
    ) {
      normalized.trialDays =
        Number(
          normalized.trialDays
        );

      if (
        !Number.isInteger(
          normalized.trialDays
        ) ||
        normalized.trialDays < 0
      ) {
        throw new BillingError(
          'Invalid trial period.',
          {
            code:
              'INVALID_TRIAL_DAYS',
          }
        );
      }
    }

    if (
      normalized.code !==
      undefined
    ) {
      normalized.code =
        String(
          normalized.code
        )
          .trim()
          .toUpperCase();
    }

    return normalized;
  }

  /**
   * ==========================================================================
   * PLAN / ENTITY HELPERS
   * ==========================================================================
   */

  async getRequiredPlan(
    planId
  ) {
    this.assertDatabase();

    const plan =
      await this.db.billingPlans.findById(
        planId
      );

    if (!plan) {
      throw new BillingError(
        'Billing plan not found.',
        {
          code:
            'BILLING_PLAN_NOT_FOUND',

          statusCode:
            404,
        }
      );
    }

    return plan;
  }

  async getRequiredActivePlan(
    planId
  ) {
    const plan =
      await this.getRequiredPlan(
        planId
      );

    if (
      plan.active === false
    ) {
      throw new BillingError(
        'Billing plan is inactive.',
        {
          code:
            'BILLING_PLAN_INACTIVE',

          statusCode:
            409,
        }
      );
    }

    return plan;
  }

  /**
   * ==========================================================================
   * VALIDATION / ASSERTIONS
   * ==========================================================================
   */

  assertDatabase() {
    if (!this.db) {
      throw new BillingError(
        'Billing database dependency is unavailable.',
        {
          code:
            'BILLING_DATABASE_UNAVAILABLE',

          statusCode:
            503,
        }
      );
    }
  }

  assertTenantId(
    tenantId
  ) {
    if (
      !tenantId ||
      typeof tenantId !==
        'string'
    ) {
      throw new BillingError(
        'Tenant ID is required.',
        {
          code:
            'TENANT_ID_REQUIRED',

          statusCode:
            400,
        }
      );
    }
  }

  assertRequired(
    value,
    field
  ) {
    if (
      value ===
        undefined ||
      value ===
        null ||
      value ===
        ''
    ) {
      throw new BillingError(
        `${field} is required.`,
        {
          code:
            'REQUIRED_FIELD_MISSING',

          details: {
            field,
          },
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
    tenantId,
    action,
    payload = {}
  ) {
    if (
      !this.auditService ||
      typeof this.auditService.log !==
        'function'
    ) {
      return;
    }

    try {
      await this.auditService.log({
        tenantId,

        action,

        payload:
          this.sanitizeAuditPayload(
            payload
          ),

        timestamp:
          new Date(),

        service:
          this.config.serviceName,
      });
    } catch (error) {
      this.logError(
        'Billing audit logging failed.',
        error,
        {
          tenantId,
          action,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * NOTIFICATIONS
   * ==========================================================================
   */

  async notifySafe(
    payload
  ) {
    if (
      !this.notificationService ||
      typeof this.notificationService.send !==
        'function'
    ) {
      return;
    }

    try {
      await this.notificationService.send(
        payload
      );
    } catch (error) {
      this.logError(
        'Billing notification failed.',
        error,
        {
          tenantId:
            payload?.tenantId,

          type:
            payload?.type,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * QUEUE
   * ==========================================================================
   */

  async enqueueSafe(
    queue,
    payload,
    options = {}
  ) {
    if (
      !this.queueService ||
      typeof this.queueService.enqueue !==
        'function'
    ) {
      this.logWarn(
        'Queue service unavailable.',
        {
          queue,
        }
      );

      return null;
    }

    try {
      return await this.queueService.enqueue(
        queue,
        payload,
        options
      );
    } catch (error) {
      this.logError(
        'Billing queue enqueue failed.',
        error,
        {
          queue,
        }
      );

      return null;
    }
  }

  /**
   * ==========================================================================
   * AUDIT SANITIZATION
   * ==========================================================================
   */

  sanitizePlanForAudit(
    plan
  ) {
    if (!plan) {
      return {};
    }

    return {
      id:
        plan.id,

      name:
        plan.name,

      code:
        plan.code,

      price:
        plan.price,

      currency:
        plan.currency,

      billingCycle:
        plan.billingCycle,

      trialDays:
        plan.trialDays,

      active:
        plan.active,
    };
  }

  subscriptionAuditPayload(
    subscription
  ) {
    return {
      subscriptionId:
        subscription.id,

      tenantId:
        subscription.tenantId,

      planId:
        subscription.planId,

      status:
        subscription.status,

      startedAt:
        subscription.startedAt,

      trialEndsAt:
        subscription.trialEndsAt,

      currentPeriodStart:
        subscription.currentPeriodStart,

      currentPeriodEnd:
        subscription.currentPeriodEnd,
    };
  }

  invoiceAuditPayload(
    invoice
  ) {
    return {
      invoiceId:
        this.getInvoiceIdentifier(
          invoice
        ),

      invoiceReference:
        this.getInvoiceReference(
          invoice
        ),

      tenantId:
        invoice.tenantId,

      subscriptionId:
        invoice.subscriptionId,

      currency:
        invoice.currency,

      total:
        invoice.total,

      status:
        invoice.status,

      periodStart:
        invoice.periodStart,

      periodEnd:
        invoice.periodEnd,

      dueDate:
        invoice.dueDate,
    };
  }

  sanitizeAuditPayload(
    payload
  ) {
    if (
      payload ===
      null
    ) {
      return null;
    }

    if (
      typeof payload !==
      'object'
    ) {
      return payload;
    }

    const sensitiveFields =
      new Set([
        'paymentMethodId',
        'cardNumber',
        'cvv',
        'cvc',
        'secret',
        'token',
        'accessToken',
        'refreshToken',
        'authorization',
      ]);

    const result =
      Array.isArray(
        payload
      )
        ? []
        : {};

    for (
      const [
        key,
        value,
      ] of Object.entries(
        payload
      )
    ) {
      if (
        sensitiveFields.has(
          key
        )
      ) {
        result[key] =
          '[REDACTED]';

        continue;
      }

      if (
        value &&
        typeof value ===
          'object'
      ) {
        result[key] =
          this.sanitizeAuditPayload(
            value
          );
      } else {
        result[key] =
          value;
      }
    }

    return result;
  }

  cloneMetadata(
    value
  ) {
    if (
      !value ||
      typeof value !==
        'object'
    ) {
      return {};
    }

    try {
      return JSON.parse(
        JSON.stringify(
          value
        )
      );
    } catch {
      return {};
    }
  }

  /**
   * ==========================================================================
   * HEALTH
   * ==========================================================================
   */

  async healthCheck() {
    const checks = {
      database:
        false,

      cache:
        !this.cache,

      paymentGateway:
        Boolean(
          this.paymentGateway
        ),

      subscriptionService:
        Boolean(
          this.subscriptionService
        ),

      queue:
        !this.queueService,

      billingOperationRepository:
        Boolean(
          this.db?.billingOperations
        ),
    };

    try {
      if (
        this.db?.tenantSubscriptions
      ) {
        await this.db
          .tenantSubscriptions
          .count(
            {}
          );

        checks.database =
          true;
      }
    } catch {
      checks.database =
        false;
    }

    if (
      this.cache
    ) {
      try {
        checks.cache =
          typeof this.cache.get ===
          'function';
      } catch {
        checks.cache =
          false;
      }
    }

    if (
      this.queueService
    ) {
      checks.queue =
        typeof this.queueService.enqueue ===
        'function';
    }

    return {
      healthy:
        checks.database,

      service:
        this.config.serviceName,

      checks,

      timestamp:
        new Date(),
    };
  }

  /**
   * ==========================================================================
   * METRICS
   * ==========================================================================
   */

  async getBillingMetrics() {
    this.assertDatabase();

    const [
      subscriptions,
      activeSubscriptions,
      trialingSubscriptions,
      cancelledSubscriptions,
      suspendedSubscriptions,
      invoices,
      pendingInvoices,
      paidInvoices,
      overdueInvoices,
    ] =
      await Promise.all([
        this.db
          .tenantSubscriptions
          .count(
            {}
          ),

        this.db
          .tenantSubscriptions
          .count({
            status:
              'active',
          }),

        this.db
          .tenantSubscriptions
          .count({
            status:
              'trialing',
          }),

        this.db
          .tenantSubscriptions
          .count({
            status:
              'cancelled',
          }),

        this.db
          .tenantSubscriptions
          .count({
            status:
              'suspended',
          }),

        this.db.invoices.count(
          {}
        ),

        this.db.invoices.count({
          status:
            INVOICE_STATUS.PENDING,
        }),

        this.db.invoices.count({
          status:
            INVOICE_STATUS.PAID,
        }),

        this.db.invoices.count({
          status:
            INVOICE_STATUS.OVERDUE,
        }),
      ]);

    return {
      service:
        this.config.serviceName,

      subscriptions,

      activeSubscriptions,

      trialingSubscriptions,

      cancelledSubscriptions,

      suspendedSubscriptions,

      invoices,

      pendingInvoices,

      paidInvoices,

      overdueInvoices,

      runtime:
        {
          ...this.metrics,
        },

      timestamp:
        new Date(),
    };
  }

  recordMetric(
    name,
    value,
    labels = {}
  ) {
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
          name,
          value,
          labels
        );
      } else if (
        typeof this.metricsService.inc ===
        'function'
      ) {
        this.metricsService.inc(
          name,
          value,
          labels
        );
      }
    } catch {
      // Metrics must never break billing.
    }
  }

  recordFailure(
    operation
  ) {
    this.metrics.failures++;

    this.recordMetric(
      'billing.operation.failure',
      1,
      {
        operation,
      }
    );
  }

  /**
   * ==========================================================================
   * LOGGING
   * ==========================================================================
   */

  logInfo(
    message,
    context = {}
  ) {
    try {
      if (
        typeof this.logger.info ===
        'function'
      ) {
        this.logger.info(
          message,
          context
        );
      }
    } catch {
      // Logging must never break billing.
    }
  }

  logWarn(
    message,
    context = {}
  ) {
    try {
      if (
        typeof this.logger.warn ===
        'function'
      ) {
        this.logger.warn(
          message,
          context
        );
      }
    } catch {
      // Logging must never break billing.
    }
  }

  logError(
    message,
    error,
    context = {}
  ) {
    try {
      if (
        typeof this.logger.error ===
        'function'
      ) {
        this.logger.error(
          message,
          {
            ...context,

            error:
              this.safeErrorMessage(
                error
              ),

            code:
              error?.code,

            stack:
              error?.stack,
          }
        );
      }
    } catch {
      // Logging must never break billing.
    }
  }

  safeErrorMessage(
    error
  ) {
    if (
      !error
    ) {
      return 'Unknown error';
    }

    return (
      error.message ||
      String(
        error
      )
    );
  }

  isRetryablePaymentError(
    error
  ) {
    if (
      !error
    ) {
      return false;
    }

    if (
      error.retryable ===
      true
    ) {
      return true;
    }

    const statusCode =
      Number(
        error.statusCode ||
        error.status
      );

    return (
      statusCode === 408 ||
      statusCode === 429 ||
      statusCode >= 500
    );
  }

  /**
   * ==========================================================================
   * EVENTS
   * ==========================================================================
   */

  emitSafe(
    event,
    payload
  ) {
    try {
      this.emit(
        event,
        payload
      );
    } catch (error) {
      this.logError(
        'Billing event listener failed.',
        error,
        {
          event,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * DUPLICATE KEY DETECTION
   * ==========================================================================
   */

  isDuplicateKeyError(
    error
  ) {
    return Boolean(
      error &&
      (
        error.code ===
          11000 ||
        error.code ===
          'DUPLICATE_KEY' ||
        /duplicate/i.test(
          error.message ||
          ''
        )
      )
    );
  }
}

module.exports =
  TenantBillingService;