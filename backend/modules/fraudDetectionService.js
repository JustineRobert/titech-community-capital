// backend/modules/fraudDetectionService.js
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Fraud Detection Service
 * ============================================================================
 *
 * File:
 *   backend/modules/fraudDetectionService.js
 *
 * Purpose:
 *   Central fraud detection and transaction risk assessment service.
 *
 * Responsibilities:
 *
 *   • Transaction fraud evaluation
 *   • Velocity detection
 *   • Large-amount detection
 *   • Geographic anomaly detection
 *   • Device-risk detection
 *   • IP reputation detection
 *   • Account-takeover detection
 *   • Risk scoring
 *   • Fraud assessment persistence
 *   • Fraud alert lifecycle
 *   • Fraud case lifecycle
 *   • Audit integration
 *   • Notification integration
 *   • Metrics integration
 *   • Optional AML correlation
 *   • Idempotent assessment processing
 *   • Multi-tenant isolation
 *
 * Design principles:
 *
 *   • Never mutate financial records directly.
 *   • Fraud decisions are advisory/risk-control decisions.
 *   • High-risk activity fails closed by default.
 *   • Every material fraud decision is auditable.
 *   • Tenant boundaries are enforced at the service layer.
 *   • Optional intelligence providers must not crash the service.
 *   • Duplicate transaction assessments must be prevented.
 *   • Alerts should be deduplicated.
 *   • Risk scores are deterministic and bounded 0–100.
 *   • Configuration must remain externally overridable.
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const FRAUD_STATUS = Object.freeze({
  CLEAR: 'clear',
  REVIEW: 'review',
  BLOCKED: 'blocked',
});

const CASE_STATUS = Object.freeze({
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  CLOSED: 'closed',
});

const ALERT_STATUS = Object.freeze({
  OPEN: 'open',
  REVIEWING: 'reviewing',
  RESOLVED: 'resolved',
  DISMISSED: 'dismissed',
});

const RISK_LEVEL = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
});

const DEFAULT_FINDING_WEIGHTS = Object.freeze({
  HIGH_TRANSACTION_VELOCITY: 20,
  LARGE_TRANSACTION: 20,
  GEO_LOCATION_ANOMALY: 20,
  HIGH_RISK_DEVICE: 25,
  HIGH_RISK_IP: 25,
  ACCOUNT_TAKEOVER_SUSPECTED: 40,
  AML_HIGH_RISK: 30,
  AML_ALERT: 20,
});

/**
 * ============================================================================
 * Utility Helpers
 * ============================================================================
 */

function now() {
  return new Date();
}

function isObject(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value)
  );
}

function normalizeNumber(value, fallback = 0) {
  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function normalizeString(value, fallback = null) {
  if (
    value === undefined ||
    value === null
  ) {
    return fallback;
  }

  const normalized = String(value).trim();

  return normalized || fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(
    Math.max(
      normalizeNumber(value, min),
      min
    ),
    max
  );
}

function createError(
  message,
  code = 'FRAUD_SERVICE_ERROR'
) {
  const error = new Error(message);

  error.code = code;

  return error;
}

/**
 * ============================================================================
 * Fraud Detection Service
 * ============================================================================
 */

class FraudDetectionService extends EventEmitter {
  constructor({
    db,
    logger,
    cache,
    queueService,
    auditService,
    notificationService,
    riskScoringService,
    amlService,
    metricsService,
    ipReputationService,
    deviceFingerprintService,
    geolocationService,
    config = {},
  } = {}) {
    super();

    if (!db) {
      throw createError(
        'FraudDetectionService requires a database service.',
        'FRAUD_DB_REQUIRED'
      );
    }

    this.db = db;
    this.logger = logger;
    this.cache = cache;
    this.queueService = queueService;
    this.auditService = auditService;
    this.notificationService =
      notificationService;
    this.riskScoringService =
      riskScoringService;
    this.amlService = amlService;
    this.metricsService = metricsService;
    this.ipReputationService =
      ipReputationService;
    this.deviceFingerprintService =
      deviceFingerprintService;
    this.geolocationService =
      geolocationService;

    this.config = {
      /**
       * Risk thresholds.
       */
      mediumRiskScore: 50,
      highRiskScore: 80,

      /**
       * Velocity controls.
       */
      velocityLimit: 10,
      velocityWindowMs:
        60 * 60 * 1000,

      /**
       * Transaction amount threshold.
       *
       * This should be tenant/currency/regulatory configurable
       * in a mature deployment.
       */
      transactionThreshold:
        10_000_000,

      /**
       * Optional velocity cache.
       */
      velocityCacheTtlSeconds: 60,

      /**
       * Assessment idempotency.
       */
      assessmentCacheTtlSeconds:
        24 * 60 * 60,

      /**
       * Alert deduplication.
       */
      alertDeduplicationTtlSeconds:
        24 * 60 * 60,

      /**
       * Maximum number of findings stored on one
       * assessment.
       */
      maxFindings: 25,

      /**
       * Fail-closed behavior.
       *
       * When critical fraud intelligence cannot be
       * obtained, the transaction may be moved to
       * review rather than automatically approved.
       */
      failClosedOnCriticalProviderError:
        false,

      /**
       * Optional AML correlation.
       */
      enableAMLCorrelation: true,

      /**
       * Whether high-risk transactions should be
       * considered blocked.
       */
      blockHighRiskTransactions: true,

      /**
       * Whether medium-risk transactions require
       * manual review.
       */
      reviewMediumRiskTransactions: true,

      /**
       * Risk weights.
       */
      findingWeights:
        DEFAULT_FINDING_WEIGHTS,

      /**
       * Alert severity thresholds.
       */
      highSeverityScore: 80,
      mediumSeverityScore: 50,

      /**
       * Maximum transaction amount accepted.
       * Set to null to disable sanity checking.
       */
      maxTransactionAmount: null,

      /**
       * Session lookback.
       */
      sessionLookbackMs:
        30 * 24 * 60 * 60 * 1000,

      /**
       * ATO detection.
       */
      accountTakeoverLookbackMs:
        24 * 60 * 60 * 1000,

      /**
       * Risk provider timeout is intentionally
       * implemented defensively through Promise.race.
       */
      providerTimeoutMs: 5_000,

      /**
       * Queue configuration.
       */
      fraudReviewQueue:
        'fraud-review',

      ...config,
    };

    this.config.findingWeights = {
      ...DEFAULT_FINDING_WEIGHTS,
      ...(config.findingWeights || {}),
    };
  }

  /**
   * =========================================================================
   * Public API
   * =========================================================================
   */

  async evaluateTransaction(
    transaction,
    context = {}
  ) {
    const startedAt = Date.now();

    this.validateTransaction(
      transaction
    );

    const tenantId =
      normalizeString(
        transaction.tenantId
      );

    const transactionId =
      normalizeString(
        transaction.id ||
          transaction.transactionId
      );

    const customerId =
      normalizeString(
        transaction.customerId
      );

    /**
     * -----------------------------------------------------------------------
     * Idempotency
     * -----------------------------------------------------------------------
     */

    const existing =
      await this.getExistingAssessment(
        tenantId,
        transactionId
      );

    if (existing) {
      this.incrementMetric(
        'fraud.assessment.idempotent_hit'
      );

      return existing;
    }

    try {
      const findings = [];
      const signals = [];

      /**
       * ---------------------------------------------------------------------
       * Velocity
       * ---------------------------------------------------------------------
       */

      const velocity =
        await this.safeProviderCall(
          'velocity',
          () =>
            this.checkVelocity(
              transaction
            ),
          {
            flagged: false,
          }
        );

      if (velocity.flagged) {
        this.addFinding(
          findings,
          velocity.reason
        );

        signals.push({
          type: velocity.reason,
          source: 'velocity',
          severity:
            velocity.severity ||
            'medium',
          metadata:
            velocity.metadata || {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * Amount
       * ---------------------------------------------------------------------
       */

      const amount =
        this.checkLargeAmount(
          transaction
        );

      if (amount.flagged) {
        this.addFinding(
          findings,
          amount.reason
        );

        signals.push({
          type: amount.reason,
          source: 'transaction',
          severity:
            amount.severity ||
            'medium',
          metadata:
            amount.metadata || {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * Geographic intelligence
       * ---------------------------------------------------------------------
       */

      const geo =
        await this.safeProviderCall(
          'geolocation',
          () =>
            this.checkGeoAnomaly(
              transaction,
              context
            ),
          {
            flagged: false,
          }
        );

      if (geo.flagged) {
        this.addFinding(
          findings,
          geo.reason
        );

        signals.push({
          type: geo.reason,
          source: 'geolocation',
          severity:
            geo.severity ||
            'medium',
          metadata:
            geo.metadata || {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * Device intelligence
       * ---------------------------------------------------------------------
       */

      const device =
        await this.safeProviderCall(
          'device',
          () =>
            this.checkDeviceRisk(
              transaction,
              context
            ),
          {
            flagged: false,
          }
        );

      if (device.flagged) {
        this.addFinding(
          findings,
          device.reason
        );

        signals.push({
          type: device.reason,
          source: 'device',
          severity:
            device.severity ||
            'high',
          metadata:
            device.metadata || {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * IP reputation
       * ---------------------------------------------------------------------
       */

      const ip =
        await this.safeProviderCall(
          'ip-reputation',
          () =>
            this.checkIpRisk(
              context
            ),
          {
            flagged: false,
          }
        );

      if (ip.flagged) {
        this.addFinding(
          findings,
          ip.reason
        );

        signals.push({
          type: ip.reason,
          source: 'ip-reputation',
          severity:
            ip.severity ||
            'high',
          metadata:
            ip.metadata || {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * Account takeover
       * ---------------------------------------------------------------------
       */

      const accountTakeover =
        await this.safeProviderCall(
          'account-takeover',
          () =>
            this.detectAccountTakeover(
              transaction,
              context
            ),
          {
            flagged: false,
          }
        );

      if (accountTakeover.flagged) {
        this.addFinding(
          findings,
          accountTakeover.reason
        );

        signals.push({
          type:
            accountTakeover.reason,
          source:
            'account-takeover',
          severity: 'critical',
          metadata:
            accountTakeover.metadata ||
            {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * AML correlation
       * ---------------------------------------------------------------------
       */

      const aml =
        await this.checkAMLRisk(
          transaction
        );

      if (aml.flagged) {
        this.addFinding(
          findings,
          aml.reason
        );

        signals.push({
          type: aml.reason,
          source: 'aml',
          severity:
            aml.severity ||
            'high',
          metadata:
            aml.metadata || {},
        });
      }

      /**
       * ---------------------------------------------------------------------
       * External risk scoring
       * ---------------------------------------------------------------------
       */

      const externalRisk =
        await this.getExternalRiskScore(
          transaction,
          context,
          {
            findings,
            signals,
          }
        );

      /**
       * ---------------------------------------------------------------------
       * Internal risk score
       * ---------------------------------------------------------------------
       */

      const score =
        this.calculateRiskScore(
          findings,
          {
            externalRisk,
            signals,
          }
        );

      const decision =
        this.determineDecision(
          score
        );

      const completedAt =
        now();

      const result = {
        id:
          crypto.randomUUID(),

        transactionId,
        customerId,
        tenantId,

        findings:
          findings.slice(
            0,
            this.config.maxFindings
          ),

        signals,

        score:
          score.score,

        level:
          score.level,

        status:
          decision.status,

        approved:
          decision.approved,

        requiresReview:
          decision.requiresReview,

        blocked:
          decision.blocked,

        decisionReason:
          decision.reason,

        externalRiskScore:
          externalRisk,

        evaluatedAt:
          completedAt,

        processingTimeMs:
          Date.now() -
          startedAt,

        createdAt:
          completedAt,
      };

      /**
       * ---------------------------------------------------------------------
       * Persist assessment
       * ---------------------------------------------------------------------
       */

      await this.saveAssessment(
        result
      );

      /**
       * ---------------------------------------------------------------------
       * Alerting
       * ---------------------------------------------------------------------
       */

      if (
        result.level ===
          RISK_LEVEL.HIGH ||
        result.requiresReview
      ) {
        await this.createAlert(
          result
        );
      }

      /**
       * ---------------------------------------------------------------------
       * Queue manual review
       * ---------------------------------------------------------------------
       */

      if (
        result.requiresReview &&
        this.queueService
      ) {
        await this.enqueueReview(
          result
        );
      }

      /**
       * ---------------------------------------------------------------------
       * Audit
       * ---------------------------------------------------------------------
       */

      await this.audit(
        tenantId,
        customerId,
        'FRAUD_TRANSACTION_EVALUATED',
        {
          transactionId,
          score:
            result.score,
          level:
            result.level,
          status:
            result.status,
          findings:
            result.findings,
        }
      );

      /**
       * ---------------------------------------------------------------------
       * Metrics
       * ---------------------------------------------------------------------
       */

      this.incrementMetric(
        'fraud.assessment.completed'
      );

      this.incrementMetric(
        `fraud.risk.${result.level}`
      );

      if (result.blocked) {
        this.incrementMetric(
          'fraud.transaction.blocked'
        );
      }

      if (result.requiresReview) {
        this.incrementMetric(
          'fraud.transaction.review'
        );
      }

      /**
       * ---------------------------------------------------------------------
       * Event
       * ---------------------------------------------------------------------
       */

      this.emit(
        'fraud.evaluated',
        result
      );

      return result;
    } catch (error) {
      this.incrementMetric(
        'fraud.assessment.failed'
      );

      this.logError(
        'Fraud evaluation failed',
        error,
        {
          tenantId,
          transactionId,
          customerId,
        }
      );

      throw error;
    }
  }

  /**
   * =========================================================================
   * Validation
   * =========================================================================
   */

  validateTransaction(
    transaction
  ) {
    if (
      !isObject(transaction)
    ) {
      throw createError(
        'Transaction is required.',
        'FRAUD_TRANSACTION_REQUIRED'
      );
    }

    if (
      !normalizeString(
        transaction.tenantId
      )
    ) {
      throw createError(
        'Transaction tenantId is required.',
        'FRAUD_TENANT_REQUIRED'
      );
    }

    if (
      !normalizeString(
        transaction.id ||
          transaction.transactionId
      )
    ) {
      throw createError(
        'Transaction id is required.',
        'FRAUD_TRANSACTION_ID_REQUIRED'
      );
    }

    if (
      !normalizeString(
        transaction.customerId
      )
    ) {
      throw createError(
        'Transaction customerId is required.',
        'FRAUD_CUSTOMER_REQUIRED'
      );
    }

    const amount =
      normalizeNumber(
        transaction.amount,
        NaN
      );

    if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      throw createError(
        'Transaction amount must be a valid non-negative number.',
        'FRAUD_INVALID_TRANSACTION_AMOUNT'
      );
    }

    if (
      this.config
        .maxTransactionAmount !==
        null &&
      amount >
        this.config
          .maxTransactionAmount
    ) {
      throw createError(
        'Transaction amount exceeds configured fraud-service maximum.',
        'FRAUD_TRANSACTION_AMOUNT_EXCEEDED'
      );
    }
  }

  /**
   * =========================================================================
   * Existing Assessment / Idempotency
   * =========================================================================
   */

  async getExistingAssessment(
    tenantId,
    transactionId
  ) {
    const cacheKey =
      this.getAssessmentCacheKey(
        tenantId,
        transactionId
      );

    if (this.cache) {
      try {
        const cached =
          await this.cache.get(
            cacheKey
          );

        if (cached) {
          return cached;
        }
      } catch (error) {
        this.logError(
          'Fraud assessment cache lookup failed',
          error
        );
      }
    }

    if (
      !this.db.fraudAssessments
    ) {
      return null;
    }

    try {
      const existing =
        await this.db.fraudAssessments.findOne(
          {
            tenantId,
            transactionId,
          }
        );

      if (
        existing &&
        this.cache
      ) {
        await this.safeCacheSet(
          cacheKey,
          existing,
          this.config
            .assessmentCacheTtlSeconds
        );
      }

      return existing || null;
    } catch (error) {
      this.logError(
        'Fraud assessment lookup failed',
        error,
        {
          tenantId,
          transactionId,
        }
      );

      return null;
    }
  }

  getAssessmentCacheKey(
    tenantId,
    transactionId
  ) {
    return `fraud:assessment:${tenantId}:${transactionId}`;
  }

  /**
   * =========================================================================
   * Velocity Detection
   * =========================================================================
   */

  async checkVelocity(
    transaction
  ) {
    const tenantId =
      transaction.tenantId;

    const customerId =
      transaction.customerId;

    const windowStart =
      new Date(
        Date.now() -
          this.config
            .velocityWindowMs
      );

    const cacheKey =
      `fraud:velocity:${tenantId}:${customerId}`;

    /**
     * Cache is an optimization only.
     * It must never become the source of truth
     * for fraud decisions.
     */

    if (this.cache) {
      try {
        const cached =
          await this.cache.get(
            cacheKey
          );

        if (
          cached &&
          Number(cached) >=
            this.config
              .velocityLimit
        ) {
          return {
            flagged: true,
            reason:
              'HIGH_TRANSACTION_VELOCITY',
            severity: 'high',
            metadata: {
              count:
                Number(cached),
              limit:
                this.config
                  .velocityLimit,
            },
          };
        }
      } catch (error) {
        this.logError(
          'Velocity cache lookup failed',
          error
        );
      }
    }

    if (
      !this.db.transactions
    ) {
      return {
        flagged: false,
      };
    }

    const query = {
      tenantId,
      customerId,
      createdAt: {
        $gte: windowStart,
      },
    };

    /**
     * Exclude the current transaction when
     * the transaction has already been persisted.
     */
    if (
      transaction.id ||
      transaction.transactionId
    ) {
      query.id = {
        $ne:
          transaction.id ||
          transaction.transactionId,
      };
    }

    const count =
      await this.db.transactions.count(
        query
      );

    if (this.cache) {
      await this.safeCacheSet(
        cacheKey,
        count,
        this.config
          .velocityCacheTtlSeconds
      );
    }

    return {
      flagged:
        count >=
        this.config
          .velocityLimit,

      reason:
        count >=
        this.config
          .velocityLimit
          ? 'HIGH_TRANSACTION_VELOCITY'
          : undefined,

      severity:
        count >=
        this.config
          .velocityLimit
          ? 'high'
          : undefined,

      metadata: {
        count,
        limit:
          this.config
            .velocityLimit,
        windowMs:
          this.config
            .velocityWindowMs,
      },
    };
  }

  /**
   * =========================================================================
   * Amount Detection
   * =========================================================================
   */

  checkLargeAmount(
    transaction
  ) {
    const amount =
      normalizeNumber(
        transaction.amount
      );

    if (
      amount >=
      this.config
        .transactionThreshold
    ) {
      return {
        flagged: true,
        reason:
          'LARGE_TRANSACTION',
        severity: 'medium',
        metadata: {
          amount,
          threshold:
            this.config
              .transactionThreshold,
          currency:
            transaction.currency ||
            null,
        },
      };
    }

    return {
      flagged: false,
    };
  }

  /**
   * =========================================================================
   * Geographic Anomaly Detection
   * =========================================================================
   */

  async checkGeoAnomaly(
    transaction,
    context = {}
  ) {
    if (
      !this.geolocationService ||
      !context.ip
    ) {
      return {
        flagged: false,
      };
    }

    const current =
      await this.geolocationService.lookup(
        context.ip
      );

    if (
      !current ||
      !current.country
    ) {
      return {
        flagged: false,
      };
    }

    if (
      !this.db.customerSessions
    ) {
      return {
        flagged: false,
      };
    }

    const last =
      await this.db.customerSessions.findOne(
        {
          tenantId:
            transaction.tenantId,
          customerId:
            transaction.customerId,
          createdAt: {
            $gte:
              new Date(
                Date.now() -
                  this.config
                    .sessionLookbackMs
              ),
          },
        },
        {
          sort: {
            createdAt: -1,
          },
        }
      );

    if (
      !last ||
      !last.country
    ) {
      return {
        flagged: false,
      };
    }

    if (
      current.country !==
      last.country
    ) {
      return {
        flagged: true,
        reason:
          'GEO_LOCATION_ANOMALY',
        severity: 'high',
        metadata: {
          previousCountry:
            last.country,
          currentCountry:
            current.country,
        },
      };
    }

    return {
      flagged: false,
    };
  }

  /**
   * =========================================================================
   * Device Risk
   * =========================================================================
   */

  async checkDeviceRisk(
    transaction,
    context = {}
  ) {
    if (
      !this
        .deviceFingerprintService ||
      !context.deviceFingerprint
    ) {
      return {
        flagged: false,
      };
    }

    const device =
      await this.deviceFingerprintService.assess(
        context.deviceFingerprint
      );

    if (!device) {
      return {
        flagged: false,
      };
    }

    const risk =
      normalizeString(
        device.risk,
        'low'
      ).toLowerCase();

    return {
      flagged:
        risk === 'high' ||
        risk === 'critical',

      reason:
        risk === 'high' ||
        risk === 'critical'
          ? 'HIGH_RISK_DEVICE'
          : undefined,

      severity:
        risk === 'critical'
          ? 'critical'
          : 'high',

      metadata: {
        risk,
        deviceId:
          device.deviceId ||
          context.deviceFingerprint ||
          null,
      },
    };
  }

  /**
   * =========================================================================
   * IP Risk
   * =========================================================================
   */

  async checkIpRisk(
    context = {}
  ) {
    if (
      !this.ipReputationService ||
      !context.ip
    ) {
      return {
        flagged: false,
      };
    }

    const reputation =
      await this.ipReputationService.lookup(
        context.ip
      );

    if (!reputation) {
      return {
        flagged: false,
      };
    }

    const risk =
      normalizeString(
        reputation.risk,
        'low'
      ).toLowerCase();

    return {
      flagged:
        risk === 'high' ||
        risk === 'critical',

      reason:
        risk === 'high' ||
        risk === 'critical'
          ? 'HIGH_RISK_IP'
          : undefined,

      severity:
        risk === 'critical'
          ? 'critical'
          : 'high',

      metadata: {
        risk,
        ip: this.maskIp(
          context.ip
        ),
      },
    };
  }

  /**
   * =========================================================================
   * Account Takeover Detection
   * =========================================================================
   */

  async detectAccountTakeover(
    transaction,
    context = {}
  ) {
    if (
      !this.db.customerSessions
    ) {
      return {
        flagged: false,
      };
    }

    const login =
      await this.db.customerSessions.findOne(
        {
          tenantId:
            transaction.tenantId,

          customerId:
            transaction.customerId,

          createdAt: {
            $gte:
              new Date(
                Date.now() -
                  this.config
                    .accountTakeoverLookbackMs
              ),
          },
        },
        {
          sort: {
            createdAt: -1,
          },
        }
      );

    if (!login) {
      return {
        flagged: false,
      };
    }

    const mismatchSignals = [];

    if (
      context.ip &&
      login.ip &&
      context.ip !== login.ip
    ) {
      mismatchSignals.push(
        'IP_MISMATCH'
      );
    }

    if (
      context.deviceFingerprint &&
      login.deviceFingerprint &&
      context.deviceFingerprint !==
        login.deviceFingerprint
    ) {
      mismatchSignals.push(
        'DEVICE_MISMATCH'
      );
    }

    if (
      context.country &&
      login.country &&
      context.country !==
        login.country
    ) {
      mismatchSignals.push(
        'COUNTRY_MISMATCH'
      );
    }

    if (
      mismatchSignals.length >= 2
    ) {
      return {
        flagged: true,
        reason:
          'ACCOUNT_TAKEOVER_SUSPECTED',
        severity: 'critical',
        metadata: {
          signals:
            mismatchSignals,
        },
      };
    }

    /**
     * Preserve compatibility with the original
     * single-IP mismatch behavior.
     */
    if (
      mismatchSignals.includes(
        'IP_MISMATCH'
      )
    ) {
      return {
        flagged: true,
        reason:
          'ACCOUNT_TAKEOVER_SUSPECTED',
        severity: 'high',
        metadata: {
          signals:
            mismatchSignals,
        },
      };
    }

    return {
      flagged: false,
    };
  }

  /**
   * =========================================================================
   * AML Correlation
   * =========================================================================
   */

  async checkAMLRisk(
    transaction
  ) {
    if (
      !this.config
        .enableAMLCorrelation ||
      !this.amlService
    ) {
      return {
        flagged: false,
      };
    }

    /**
     * We intentionally do not call a potentially
     * expensive full AML transaction pipeline here
     * unless the AML service explicitly exposes the
     * required API.
     */

    try {
      if (
        typeof this.amlService
          .monitorTransaction !==
        'function'
      ) {
        return {
          flagged: false,
        };
      }

      const result =
        await this.amlService.monitorTransaction(
          transaction
        );

      if (
        !result ||
        !result.suspicious
      ) {
        return {
          flagged: false,
        };
      }

      return {
        flagged: true,
        reason:
          'AML_ALERT',
        severity: 'high',
        metadata: {
          findings:
            result.findings ||
            [],
        },
      };
    } catch (error) {
      this.logError(
        'AML correlation failed',
        error
      );

      /**
       * Fraud detection should not silently
       * convert a dependency outage into approval
       * when configured for fail-closed behavior.
       */
      if (
        this.config
          .failClosedOnCriticalProviderError
      ) {
        return {
          flagged: true,
          reason:
            'AML_PROVIDER_UNAVAILABLE',
          severity: 'high',
          metadata: {
            providerUnavailable:
              true,
          },
        };
      }

      return {
        flagged: false,
      };
    }
  }

  /**
   * =========================================================================
   * External Risk Scoring
   * =========================================================================
   */

  async getExternalRiskScore(
    transaction,
    context,
    data
  ) {
    if (
      !this.riskScoringService
    ) {
      return null;
    }

    if (
      typeof this.riskScoringService
        .scoreFraud !==
      'function'
    ) {
      return null;
    }

    try {
      const result =
        await this.withTimeout(
          this.riskScoringService.scoreFraud(
            {
              transaction,
              context,
              findings:
                data.findings,
              signals:
                data.signals,
            }
          ),
          this.config
            .providerTimeoutMs
        );

      if (
        result === null ||
        result === undefined
      ) {
        return null;
      }

      if (
        typeof result ===
        'number'
      ) {
        return clamp(
          result
        );
      }

      return clamp(
        result.score ??
          result.riskScore ??
          0
      );
    } catch (error) {
      this.logError(
        'External fraud risk scoring failed',
        error
      );

      if (
        this.config
          .failClosedOnCriticalProviderError
      ) {
        return 100;
      }

      return null;
    }
  }

  /**
   * =========================================================================
   * Risk Calculation
   * =========================================================================
   */

  calculateRiskScore(
    findings = [],
    {
      externalRisk = null,
      signals = [],
    } = {}
  ) {
    const uniqueFindings =
      [
        ...new Set(
          findings.filter(Boolean)
        ),
      ];

    let score = 0;

    for (const finding of
      uniqueFindings) {
      score += normalizeNumber(
        this.config
          .findingWeights?.[
          finding
        ],
        0
      );
    }

    /**
     * Severity bonus.
     */
    const hasCritical =
      signals.some(
        (signal) =>
          signal.severity ===
          'critical'
      );

    if (hasCritical) {
      score += 15;
    }

    /**
     * External risk score is blended rather
     * than simply added, preventing double-counting.
     */
    if (
      externalRisk !== null &&
      Number.isFinite(
        Number(externalRisk)
      )
    ) {
      score =
        score * 0.7 +
        Number(externalRisk) *
          0.3;
    }

    score = clamp(
      Math.round(score)
    );

    let level =
      RISK_LEVEL.LOW;

    if (
      score >=
      this.config
        .highRiskScore
    ) {
      level =
        RISK_LEVEL.HIGH;
    } else if (
      score >=
      this.config
        .mediumRiskScore
    ) {
      level =
        RISK_LEVEL.MEDIUM;
    }

    return {
      score,
      level,
    };
  }

  /**
   * =========================================================================
   * Decision Engine
   * =========================================================================
   */

  determineDecision(
    risk
  ) {
    if (
      risk.level ===
      RISK_LEVEL.HIGH
    ) {
      return {
        status:
          this.config
            .blockHighRiskTransactions
            ? FRAUD_STATUS.BLOCKED
            : FRAUD_STATUS.REVIEW,

        approved:
          !this.config
            .blockHighRiskTransactions,

        requiresReview:
          true,

        blocked:
          this.config
            .blockHighRiskTransactions,

        reason:
          this.config
            .blockHighRiskTransactions
            ? 'HIGH_FRAUD_RISK'
            : 'HIGH_RISK_REQUIRES_REVIEW',
      };
    }

    if (
      risk.level ===
        RISK_LEVEL.MEDIUM &&
      this.config
        .reviewMediumRiskTransactions
    ) {
      return {
        status:
          FRAUD_STATUS.REVIEW,

        approved: true,

        requiresReview: true,

        blocked: false,

        reason:
          'MEDIUM_FRAUD_RISK_REQUIRES_REVIEW',
      };
    }

    return {
      status:
        FRAUD_STATUS.CLEAR,

      approved: true,

      requiresReview: false,

      blocked: false,

      reason:
        'LOW_FRAUD_RISK',
    };
  }

  /**
   * =========================================================================
   * Persist Assessment
   * =========================================================================
   */

  async saveAssessment(
    result
  ) {
    if (
      !this.db.fraudAssessments
    ) {
      throw createError(
        'Fraud assessment repository is unavailable.',
        'FRAUD_ASSESSMENT_REPOSITORY_UNAVAILABLE'
      );
    }

    try {
      const persisted =
        await this.db.fraudAssessments.create(
          result
        );

      await this.safeCacheSet(
        this.getAssessmentCacheKey(
          result.tenantId,
          result.transactionId
        ),
        persisted || result,
        this.config
          .assessmentCacheTtlSeconds
      );

      return (
        persisted ||
        result
      );
    } catch (error) {
      /**
       * If a unique database constraint catches
       * a concurrent duplicate assessment, retrieve
       * the already-created assessment.
       */
      if (
        this.isDuplicateError(
          error
        )
      ) {
        const existing =
          await this.getExistingAssessment(
            result.tenantId,
            result.transactionId
          );

        if (existing) {
          return existing;
        }
      }

      throw error;
    }
  }

  /**
   * =========================================================================
   * Fraud Alerts
   * =========================================================================
   */

  async createAlert(
    result
  ) {
    if (
      !this.db.fraudAlerts
    ) {
      throw createError(
        'Fraud alert repository is unavailable.',
        'FRAUD_ALERT_REPOSITORY_UNAVAILABLE'
      );
    }

    const dedupKey =
      this.getAlertDeduplicationKey(
        result
      );

    /**
     * Prevent duplicate alerts for the same
     * tenant/customer/transaction/risk condition.
     */
    if (this.cache) {
      try {
        const existing =
          await this.cache.get(
            dedupKey
          );

        if (existing) {
          return existing;
        }
      } catch (error) {
        this.logError(
          'Fraud alert deduplication lookup failed',
          error
        );
      }
    }

    /**
     * Prefer an existing open alert in the database
     * when supported.
     */
    try {
      const existing =
        await this.db.fraudAlerts.findOne?.(
          {
            tenantId:
              result.tenantId,
            transactionId:
              result.transactionId,
            status: {
              $in: [
                ALERT_STATUS.OPEN,
                ALERT_STATUS.REVIEWING,
              ],
            },
          }
        );

      if (existing) {
        return existing;
      }
    } catch (error) {
      this.logError(
        'Fraud alert duplicate lookup failed',
        error
      );
    }

    const alert = {
      id:
        crypto.randomUUID(),

      tenantId:
        result.tenantId,

      customerId:
        result.customerId,

      transactionId:
        result.transactionId,

      findings:
        result.findings,

      signals:
        result.signals,

      score:
        result.score,

      riskLevel:
        result.level,

      severity:
        this.calculateAlertSeverity(
          result
        ),

      status:
        ALERT_STATUS.OPEN,

      createdAt:
        now(),

      updatedAt:
        now(),
    };

    const created =
      await this.db.fraudAlerts.create(
        alert
      );

    const finalAlert =
      created || alert;

    /**
     * Deduplication marker is an optimization.
     */
    await this.safeCacheSet(
      dedupKey,
      finalAlert,
      this.config
        .alertDeduplicationTtlSeconds
    );

    /**
     * Notification must not destroy the
     * persisted fraud decision.
     */
    await this.safeNotify(
      finalAlert
    );

    await this.audit(
      result.tenantId,
      result.customerId,
      'FRAUD_ALERT_CREATED',
      {
        alertId:
          finalAlert.id,
        transactionId:
          result.transactionId,
        score:
          result.score,
        severity:
          finalAlert.severity,
        findings:
          result.findings,
      }
    );

    this.incrementMetric(
      'fraud.alert.created'
    );

    this.emit(
      'fraud.alert.created',
      finalAlert
    );

    return finalAlert;
  }

  calculateAlertSeverity(
    result
  ) {
    if (
      result.score >=
      this.config
        .highSeverityScore
    ) {
      return 'high';
    }

    if (
      result.score >=
      this.config
        .mediumSeverityScore
    ) {
      return 'medium';
    }

    return 'low';
  }

  getAlertDeduplicationKey(
    result
  ) {
    return [
      'fraud:alert',
      result.tenantId,
      result.transactionId,
      result.level,
    ].join(':');
  }

  /**
   * =========================================================================
   * Case Management
   * =========================================================================
   */

  async openCase(
    alertId,
    investigatorId
  ) {
    if (
      !normalizeString(
        alertId
      )
    ) {
      throw createError(
        'Alert ID is required.',
        'FRAUD_ALERT_ID_REQUIRED'
      );
    }

    const alert =
      await this.db.fraudAlerts.findById(
        alertId
      );

    if (!alert) {
      throw createError(
        'Fraud alert not found.',
        'FRAUD_ALERT_NOT_FOUND'
      );
    }

    if (
      !this.db.fraudCases
    ) {
      throw createError(
        'Fraud case repository is unavailable.',
        'FRAUD_CASE_REPOSITORY_UNAVAILABLE'
      );
    }

    /**
     * Avoid opening duplicate cases.
     */
    try {
      const existing =
        await this.db.fraudCases.findOne?.(
          {
            alertId,
            status: {
              $in: [
                CASE_STATUS.OPEN,
                CASE_STATUS.INVESTIGATING,
              ],
            },
          }
        );

      if (existing) {
        return existing;
      }
    } catch (error) {
      this.logError(
        'Fraud case duplicate lookup failed',
        error
      );
    }

    const timestamp =
      now();

    const fraudCase = {
      id:
        crypto.randomUUID(),

      alertId,

      tenantId:
        alert.tenantId,

      customerId:
        alert.customerId,

      investigatorId:
        investigatorId ||
        null,

      status:
        CASE_STATUS.OPEN,

      createdAt:
        timestamp,

      updatedAt:
        timestamp,
    };

    const created =
      await this.db.fraudCases.create(
        fraudCase
      );

    await this.audit(
      alert.tenantId,
      alert.customerId,
      'FRAUD_CASE_OPENED',
      {
        caseId:
          created?.id ||
          fraudCase.id,
        alertId,
        investigatorId:
          investigatorId ||
          null,
      }
    );

    this.emit(
      'fraud.case.opened',
      created ||
        fraudCase
    );

    return (
      created ||
      fraudCase
    );
  }

  /**
   * =========================================================================
   * Close Case
   * =========================================================================
   */

  async closeCase(
    caseId,
    resolution
  ) {
    if (
      !normalizeString(
        caseId
      )
    ) {
      throw createError(
        'Case ID is required.',
        'FRAUD_CASE_ID_REQUIRED'
      );
    }

    const normalizedResolution =
      normalizeString(
        resolution
      );

    if (
      !normalizedResolution
    ) {
      throw createError(
        'Case resolution is required.',
        'FRAUD_CASE_RESOLUTION_REQUIRED'
      );
    }

    const fraudCase =
      await this.db.fraudCases.findById(
        caseId
      );

    if (!fraudCase) {
      throw createError(
        'Fraud case not found.',
        'FRAUD_CASE_NOT_FOUND'
      );
    }

    if (
      fraudCase.status ===
      CASE_STATUS.CLOSED
    ) {
      return fraudCase;
    }

    const closedAt =
      now();

    const updatedCase = {
      ...fraudCase,

      status:
        CASE_STATUS.CLOSED,

      resolution:
        normalizedResolution,

      closedAt,

      updatedAt:
        closedAt,
    };

    await this.db.fraudCases.update(
      caseId,
      updatedCase
    );

    await this.audit(
      fraudCase.tenantId,
      fraudCase.customerId,
      'FRAUD_CASE_CLOSED',
      {
        caseId,
        resolution:
          normalizedResolution,
      }
    );

    this.emit(
      'fraud.case.closed',
      updatedCase
    );

    return updatedCase;
  }

  /**
   * =========================================================================
   * Metrics
   * =========================================================================
   */

  async getMetrics(
    tenantId = null
  ) {
    const scope =
      tenantId
        ? { tenantId }
        : {};

    const [
      assessments,
      alerts,
      openAlerts,
      openCases,
      closedCases,
      highRiskAssessments,
      blockedTransactions,
    ] =
      await Promise.all([
        this.safeCount(
          this.db.fraudAssessments,
          scope
        ),

        this.safeCount(
          this.db.fraudAlerts,
          scope
        ),

        this.safeCount(
          this.db.fraudAlerts,
          {
            ...scope,
            status:
              ALERT_STATUS.OPEN,
          }
        ),

        this.safeCount(
          this.db.fraudCases,
          {
            ...scope,
            status: {
              $in: [
                CASE_STATUS.OPEN,
                CASE_STATUS.INVESTIGATING,
              ],
            },
          }
        ),

        this.safeCount(
          this.db.fraudCases,
          {
            ...scope,
            status:
              CASE_STATUS.CLOSED,
          }
        ),

        this.safeCount(
          this.db.fraudAssessments,
          {
            ...scope,
            level:
              RISK_LEVEL.HIGH,
          }
        ),

        this.safeCount(
          this.db.fraudAssessments,
          {
            ...scope,
            blocked: true,
          }
        ),
      ]);

    return {
      assessments,
      alerts,
      openAlerts,
      openCases,
      closedCases,
      highRiskAssessments,
      blockedTransactions,
      generatedAt:
        now(),
    };
  }

  /**
   * =========================================================================
   * Queue Review
   * =========================================================================
   */

  async enqueueReview(
    result
  ) {
    if (
      !this.queueService ||
      typeof this.queueService
        .enqueue !== 'function'
    ) {
      return null;
    }

    try {
      return await this.queueService.enqueue(
        this.config
          .fraudReviewQueue,
        {
          assessmentId:
            result.id,

          transactionId:
            result.transactionId,

          customerId:
            result.customerId,

          tenantId:
            result.tenantId,

          score:
            result.score,

          level:
            result.level,

          findings:
            result.findings,
        },
        {
          jobId:
            `fraud-review:${result.tenantId}:${result.transactionId}`,
        }
      );
    } catch (error) {
      this.logError(
        'Fraud review queue enqueue failed',
        error,
        {
          tenantId:
            result.tenantId,
          transactionId:
            result.transactionId,
        }
      );

      /**
       * Queue failure should not invalidate the
       * already persisted fraud assessment.
       */
      return null;
    }
  }

  /**
   * =========================================================================
   * Notification
   * =========================================================================
   */

  async safeNotify(
    alert
  ) {
    if (
      !this.notificationService ||
      typeof this.notificationService
        .send !== 'function'
    ) {
      return;
    }

    try {
      await this.notificationService.send(
        {
          tenantId:
            alert.tenantId,

          customerId:
            alert.customerId,

          type:
            'fraud_alert',

          channel:
            'in_app',

          subject:
            'Fraud Alert',

          message:
            'Suspicious activity detected and requires review.',

          data: {
            alertId:
              alert.id,

            transactionId:
              alert.transactionId,

            score:
              alert.score,

            severity:
              alert.severity,
          },
        }
      );
    } catch (error) {
      this.logError(
        'Fraud alert notification failed',
        error,
        {
          alertId:
            alert.id,
        }
      );
    }
  }

  /**
   * =========================================================================
   * Finding Management
   * =========================================================================
   */

  addFinding(
    findings,
    finding
  ) {
    if (!finding) {
      return;
    }

    if (
      findings.includes(
        finding
      )
    ) {
      return;
    }

    if (
      findings.length >=
      this.config.maxFindings
    ) {
      return;
    }

    findings.push(
      finding
    );
  }

  /**
   * =========================================================================
   * Cache Helpers
   * =========================================================================
   */

  async safeCacheSet(
    key,
    value,
    ttl
  ) {
    if (!this.cache) {
      return;
    }

    try {
      await this.cache.set(
        key,
        value,
        ttl
      );
    } catch (error) {
      this.logError(
        'Fraud cache write failed',
        error,
        {
          key,
        }
      );
    }
  }

  /**
   * =========================================================================
   * Safe Provider Execution
   * =========================================================================
   */

  async safeProviderCall(
    providerName,
    operation,
    fallback
  ) {
    try {
      return await this.withTimeout(
        operation(),
        this.config
          .providerTimeoutMs
      );
    } catch (error) {
      this.logError(
        `Fraud provider failed: ${providerName}`,
        error
      );

      if (
        this.config
          .failClosedOnCriticalProviderError
      ) {
        return {
          flagged: true,

          reason:
            `FRAUD_PROVIDER_UNAVAILABLE_${providerName
              .toUpperCase()
              .replace(/[^A-Z0-9]+/g, '_')}`,

          severity: 'high',

          metadata: {
            providerUnavailable:
              true,
            provider:
              providerName,
          },
        };
      }

      return fallback;
    }
  }

  async withTimeout(
    promise,
    timeoutMs
  ) {
    if (
      !timeoutMs ||
      timeoutMs <= 0
    ) {
      return promise;
    }

    let timer;

    try {
      return await Promise.race([
        promise,

        new Promise(
          (_, reject) => {
            timer =
              setTimeout(
                () =>
                  reject(
                    createError(
                      'Fraud intelligence provider timeout.',
                      'FRAUD_PROVIDER_TIMEOUT'
                    )
                  ),
                timeoutMs
              );

            if (
              typeof timer
                .unref ===
              'function'
            ) {
              timer.unref();
            }
          }
        ),
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer
        );
      }
    }
  }

  /**
   * =========================================================================
   * Safe Count
   * =========================================================================
   */

  async safeCount(
    repository,
    query
  ) {
    if (
      !repository ||
      typeof repository.count !==
        'function'
    ) {
      return 0;
    }

    try {
      return await repository.count(
        query
      );
    } catch (error) {
      this.logError(
        'Fraud metrics count failed',
        error
      );

      return 0;
    }
  }

  /**
   * =========================================================================
   * Audit
   * =========================================================================
   */

  async audit(
    tenantId,
    customerId,
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
      await this.auditService.log(
        {
          tenantId,
          customerId,
          action,
          payload,
          timestamp:
            now(),
        }
      );
    } catch (error) {
      /**
       * Audit failure must be observable but
       * must not corrupt the primary fraud decision.
       */
      this.logError(
        'Fraud audit failed',
        error,
        {
          tenantId,
          customerId,
          action,
        }
      );
    }
  }

  /**
   * =========================================================================
   * Metrics Integration
   * =========================================================================
   */

  incrementMetric(
    name,
    value = 1
  ) {
    if (
      !this.metricsService
    ) {
      return;
    }

    try {
      if (
        typeof this.metricsService
          .increment ===
        'function'
      ) {
        this.metricsService.increment(
          name,
          value
        );

        return;
      }

      if (
        typeof this.metricsService
          .inc ===
        'function'
      ) {
        this.metricsService.inc(
          name,
          value
        );
      }
    } catch (error) {
      this.logError(
        'Fraud metric update failed',
        error
      );
    }
  }

  /**
   * =========================================================================
   * Logging
   * =========================================================================
   */

  logError(
    message,
    error,
    context = {}
  ) {
    if (
      !this.logger ||
      typeof this.logger.error !==
        'function'
    ) {
      return;
    }

    try {
      this.logger.error(
        message,
        {
          error:
            error?.message ||
            error,

          code:
            error?.code ||
            null,

          stack:
            error?.stack ||
            null,

          ...context,
        }
      );
    } catch (_) {
      /**
       * Logging must never crash fraud detection.
       */
    }
  }

  /**
   * =========================================================================
   * Duplicate Error Detection
   * =========================================================================
   */

  isDuplicateError(
    error
  ) {
    if (!error) {
      return false;
    }

    return (
      error.code ===
        11000 ||
      error.code ===
        'DUPLICATE_KEY' ||
      /duplicate/i.test(
        error.message || ''
      )
    );
  }

  /**
   * =========================================================================
   * Privacy Helpers
   * =========================================================================
   */

  maskIp(ip) {
    if (!ip) {
      return null;
    }

    const value =
      String(ip);

    if (
      value.includes(':')
    ) {
      /**
       * IPv6: retain only the first segment.
       */
      return (
        value
          .split(':')
          .slice(0, 2)
          .join(':') +
        ':*'
      );
    }

    const parts =
      value.split('.');

    if (
      parts.length === 4
    ) {
      return `${parts[0]}.${parts[1]}.*.*`;
    }

    return 'masked';
  }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

module.exports =
  FraudDetectionService;