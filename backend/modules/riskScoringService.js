// backend/modules/riskScoringService.js
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Risk Scoring Service
 * ============================================================================
 *
 * Responsibilities
 * ----------------------------------------------------------------------------
 * - Customer risk scoring
 * - KYC risk assessment
 * - AML risk assessment
 * - Fraud risk assessment
 * - Credit risk assessment
 * - Transaction behavioural risk assessment
 * - Composite risk calculation
 * - Risk classification
 * - Risk action determination
 * - Risk score persistence
 * - Risk score retrieval
 * - Risk score history
 * - Cache management
 * - High-risk workflow triggering
 * - Audit integration
 * - Metrics integration
 * - Explainable risk factors
 * - Deterministic scoring fingerprints
 *
 * Design Principles
 * ----------------------------------------------------------------------------
 * - Tenant isolation
 * - Fail-safe dependency handling
 * - Deterministic scoring
 * - Explainability
 * - Immutable score records
 * - Configuration validation
 * - Operational resilience
 * - No direct financial mutation
 * - No silent security failures
 *
 * Compatible With
 * ----------------------------------------------------------------------------
 * - MongoDB / Mongoose-like repositories
 * - Redis-compatible caches
 * - BullMQ-compatible queue services
 * - Existing AuditService
 * - Existing MetricsService
 * - Existing EventEmitter consumers
 *
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

const SERVICE_NAME = 'RiskScoringService';
const SCORING_MODEL_VERSION = '2026.1';

const DEFAULT_CONFIG = Object.freeze({
  cacheTtl: 300,

  scoringModelVersion: SCORING_MODEL_VERSION,

  transactionWindowDays: 30,

  transactionQueryLimit: 5000,

  transactionThresholds: {
    count: 500,
    volume: 50000000,
  },

  thresholds: {
    low: 30,
    medium: 60,
    high: 80,
  },

  weights: {
    kyc: 0.20,
    aml: 0.20,
    fraud: 0.25,
    credit: 0.25,
    transaction: 0.10,
  },

  riskActions: {
    low: 'standard-monitoring',
    medium: 'enhanced-monitoring',
    high: 'enhanced-due-diligence',
    critical: 'manual-review',
  },

  highRiskQueue: {
    enabled: true,
    queueName: 'high-risk-customer',
  },

  cache: {
    enabled: true,
    failOpen: true,
  },

  persistence: {
    enabled: true,
  },

  transactionRisk: {
    enabled: true,
  },

  factorDefaults: {
    missingDataScore: 0,
  },

  logging: {
    includeFactors: true,
  },
});

class RiskScoringService extends EventEmitter {
  constructor({
    db,
    logger,
    cache,
    queueService,
    auditService,
    metricsService,
    config = {},
  } = {}) {
    super();

    this.db = db;
    this.logger = logger;
    this.cache = cache;
    this.queueService = queueService;
    this.auditService = auditService;
    this.metricsService = metricsService;

    this.config = this.buildConfig(config);

    this.serviceName = SERVICE_NAME;
    this.scoringModelVersion =
      this.config.scoringModelVersion;
  }

  // ==========================================================================
  // Configuration
  // ==========================================================================

  buildConfig(overrides = {}) {
    const merged = {
      ...DEFAULT_CONFIG,
      ...overrides,

      thresholds: {
        ...DEFAULT_CONFIG.thresholds,
        ...(overrides.thresholds || {}),
      },

      weights: {
        ...DEFAULT_CONFIG.weights,
        ...(overrides.weights || {}),
      },

      transactionThresholds: {
        ...DEFAULT_CONFIG.transactionThresholds,
        ...(overrides.transactionThresholds || {}),
      },

      riskActions: {
        ...DEFAULT_CONFIG.riskActions,
        ...(overrides.riskActions || {}),
      },

      highRiskQueue: {
        ...DEFAULT_CONFIG.highRiskQueue,
        ...(overrides.highRiskQueue || {}),
      },

      cache: {
        ...DEFAULT_CONFIG.cache,
        ...(overrides.cache || {}),
      },

      persistence: {
        ...DEFAULT_CONFIG.persistence,
        ...(overrides.persistence || {}),
      },

      transactionRisk: {
        ...DEFAULT_CONFIG.transactionRisk,
        ...(overrides.transactionRisk || {}),
      },

      factorDefaults: {
        ...DEFAULT_CONFIG.factorDefaults,
        ...(overrides.factorDefaults || {}),
      },

      logging: {
        ...DEFAULT_CONFIG.logging,
        ...(overrides.logging || {}),
      },
    };

    this.validateConfig(merged);

    return merged;
  }

  validateConfig(config) {
    const thresholds = config.thresholds;

    if (
      !Number.isFinite(thresholds.low) ||
      !Number.isFinite(thresholds.medium) ||
      !Number.isFinite(thresholds.high)
    ) {
      throw new Error(
        'Risk scoring thresholds must be numeric.'
      );
    }

    if (
      thresholds.low < 0 ||
      thresholds.medium <= thresholds.low ||
      thresholds.high <= thresholds.medium ||
      thresholds.high > 100
    ) {
      throw new Error(
        'Risk scoring thresholds must satisfy 0 <= low < medium < high <= 100.'
      );
    }

    const weights = config.weights;

    const weightValues = Object.values(weights);

    if (
      weightValues.some(
        (weight) =>
          !Number.isFinite(weight) ||
          weight < 0
      )
    ) {
      throw new Error(
        'Risk scoring weights must be finite non-negative numbers.'
      );
    }

    const weightTotal = weightValues.reduce(
      (sum, weight) =>
        sum + weight,
      0
    );

    if (
      Math.abs(weightTotal - 1) >
      0.000001
    ) {
      throw new Error(
        `Risk scoring weights must sum to 1. Current total: ${weightTotal}.`
      );
    }

    if (
      !Number.isInteger(
        config.transactionWindowDays
      ) ||
      config.transactionWindowDays <= 0
    ) {
      throw new Error(
        'transactionWindowDays must be a positive integer.'
      );
    }

    if (
      !Number.isInteger(
        config.transactionQueryLimit
      ) ||
      config.transactionQueryLimit <= 0
    ) {
      throw new Error(
        'transactionQueryLimit must be a positive integer.'
      );
    }

    if (
      !Number.isFinite(
        config.cacheTtl
      ) ||
      config.cacheTtl < 0
    ) {
      throw new Error(
        'cacheTtl must be a non-negative number.'
      );
    }
  }

  // ==========================================================================
  // Public Customer Scoring API
  // ==========================================================================

  async scoreCustomer(
    customer,
    options = {}
  ) {
    const context = this.createContext(
      options
    );

    this.assertCustomer(customer);

    const tenantId =
      customer.tenantId ||
      context.tenantId;

    this.assertTenantId(
      tenantId
    );

    const customerId =
      this.getCustomerId(customer);

    const cacheKey =
      this.buildCacheKey(
        tenantId,
        customerId
      );

    if (
      !options.forceRefresh &&
      this.config.cache.enabled
    ) {
      const cached =
        await this.getCache(
          cacheKey,
          context
        );

      if (cached) {
        this.incrementMetric(
          'risk_score_cache_hit',
          1,
          context
        );

        return cached;
      }

      this.incrementMetric(
        'risk_score_cache_miss',
        1,
        context
      );
    }

    const startedAt =
      Date.now();

    try {
      const [
        kyc,
        aml,
        fraud,
        credit,
        transaction,
      ] = await Promise.all([
        this.scoreKYC(
          customer,
          context
        ),

        this.scoreAML(
          customer,
          context
        ),

        this.scoreFraud(
          customer,
          context
        ),

        this.scoreCredit(
          customer,
          context
        ),

        this.scoreTransactions(
          customer,
          context
        ),
      ]);

      const factors = {
        kyc,
        aml,
        fraud,
        credit,
        transaction,
      };

      const composite =
        this.calculateCompositeScore(
          factors
        );

      const fingerprint =
        this.generateScoreFingerprint({
          tenantId,
          customerId,
          factors,
          composite,
        });

      const profile = {
        id:
          crypto.randomUUID(),

        tenantId,
        customerId,

        score:
          composite.score,

        rawScore:
          composite.rawScore,

        level:
          composite.level,

        riskBand:
          composite.riskBand,

        action:
          composite.action,

        scoringModelVersion:
          this.scoringModelVersion,

        factors,

        fingerprint,

        calculatedAt:
          new Date(),

        metadata: {
          service:
            this.serviceName,

          durationMs:
            Date.now() - startedAt,

          correlationId:
            context.correlationId || null,

          source:
            options.source ||
            'risk-scoring-service',
        },
      };

      if (
        this.config.persistence.enabled
      ) {
        await this.persistScore(
          profile,
          context
        );
      }

      if (
        this.config.cache.enabled
      ) {
        await this.setCache(
          cacheKey,
          profile,
          context
        );
      }

      this.incrementMetric(
        'risk_scores_created',
        1,
        context
      );

      this.incrementMetric(
        `risk_scores_${profile.level}`,
        1,
        context
      );

      this.emitSafe(
        'risk.score.created',
        profile
      );

      if (
        profile.level === 'high' ||
        profile.level === 'critical'
      ) {
        await this.handleHighRiskProfile(
          profile,
          context
        );
      }

      return profile;
    } catch (error) {
      this.incrementMetric(
        'risk_score_failures',
        1,
        context
      );

      this.logError(
        'Customer risk scoring failed',
        error,
        {
          tenantId,
          customerId,
          correlationId:
            context.correlationId,
        }
      );

      throw error;
    }
  }

  // ==========================================================================
  // KYC Risk
  // ==========================================================================

  async scoreKYC(
    profile = {},
    context = {}
  ) {
    let score = 0;

    const reasons = [];

    const status =
      this.normalizeString(
        profile.status
      );

    const riskLevel =
      this.normalizeString(
        profile.riskLevel
      );

    if (
      status === 'rejected'
    ) {
      score += 80;

      reasons.push(
        this.reason(
          'KYC_REJECTED',
          80,
          'KYC verification was rejected.'
        )
      );
    }

    if (
      status === 'pending'
    ) {
      score += 40;

      reasons.push(
        this.reason(
          'KYC_PENDING',
          40,
          'KYC verification is still pending.'
        )
      );
    }

    if (
      riskLevel === 'high'
    ) {
      score += 40;

      reasons.push(
        this.reason(
          'HIGH_RISK_KYC',
          40,
          'Customer KYC risk level is high.'
        )
      );
    }

    return this.finalizeFactor(
      score,
      reasons,
      {
        factor: 'kyc',
      }
    );
  }

  // ==========================================================================
  // AML Risk
  // ==========================================================================

  async scoreAML(
    data = {},
    context = {}
  ) {
    let score = 0;

    const reasons = [];

    const screening =
      data.screening ||
      {};

    const sanctionsMatches =
      this.getMatchCount(
        screening.sanctions
      );

    const pepMatches =
      this.getMatchCount(
        screening.pep
      );

    const adverseMediaMatches =
      this.getMatchCount(
        screening.adverseMedia
      );

    if (
      sanctionsMatches > 0
    ) {
      score += 100;

      reasons.push(
        this.reason(
          'SANCTIONS_MATCH',
          100,
          'Customer has one or more sanctions screening matches.',
          {
            matches:
              sanctionsMatches,
          }
        )
      );
    }

    if (
      pepMatches > 0
    ) {
      score += 50;

      reasons.push(
        this.reason(
          'PEP_MATCH',
          50,
          'Customer has one or more PEP screening matches.',
          {
            matches:
              pepMatches,
          }
        )
      );
    }

    if (
      adverseMediaMatches > 0
    ) {
      score += 25;

      reasons.push(
        this.reason(
          'ADVERSE_MEDIA',
          25,
          'Customer has adverse media screening matches.',
          {
            matches:
              adverseMediaMatches,
          }
        )
      );
    }

    return this.finalizeFactor(
      score,
      reasons,
      {
        factor: 'aml',
      }
    );
  }

  // ==========================================================================
  // Fraud Risk
  // ==========================================================================

  async scoreFraud(
    data = {},
    context = {}
  ) {
    let score = 0;

    const reasons = [];

    const fraudAlerts =
      this.toNonNegativeNumber(
        data.fraudAlerts
      );

    if (
      fraudAlerts > 0
    ) {
      score += 50;

      reasons.push(
        this.reason(
          'FRAUD_ALERTS',
          50,
          'Customer has active fraud alerts.',
          {
            count:
              fraudAlerts,
          }
        )
      );
    }

    if (
      data.accountLocked === true
    ) {
      score += 20;

      reasons.push(
        this.reason(
          'ACCOUNT_LOCKED',
          20,
          'Customer account is locked.'
        )
      );
    }

    return this.finalizeFactor(
      score,
      reasons,
      {
        factor: 'fraud',
      }
    );
  }

  // ==========================================================================
  // Credit Risk
  // ==========================================================================

  async scoreCredit(
    data = {},
    context = {}
  ) {
    let score = 0;

    const reasons = [];

    const defaultedLoans =
      this.toNonNegativeNumber(
        data.defaultedLoans
      );

    const overdueLoans =
      this.toNonNegativeNumber(
        data.overdueLoans
      );

    const creditScore =
      this.toNullableNumber(
        data.creditScore
      );

    if (
      defaultedLoans > 0
    ) {
      score += 70;

      reasons.push(
        this.reason(
          'DEFAULTED_LOANS',
          70,
          'Customer has one or more defaulted loans.',
          {
            count:
              defaultedLoans,
          }
        )
      );
    }

    if (
      overdueLoans > 0
    ) {
      score += 40;

      reasons.push(
        this.reason(
          'OVERDUE_LOANS',
          40,
          'Customer has one or more overdue loans.',
          {
            count:
              overdueLoans,
          }
        )
      );
    }

    if (
      creditScore !== null &&
      creditScore < 500
    ) {
      score += 40;

      reasons.push(
        this.reason(
          'LOW_CREDIT_SCORE',
          40,
          'Customer credit score is below the configured low-risk threshold.',
          {
            creditScore,
          }
        )
      );
    }

    return this.finalizeFactor(
      score,
      reasons,
      {
        factor: 'credit',
      }
    );
  }

  // ==========================================================================
  // Transaction Risk
  // ==========================================================================

  async scoreTransactions(
    customer,
    context = {}
  ) {
    if (
      !this.config.transactionRisk.enabled
    ) {
      return this.finalizeFactor(
        this.config.factorDefaults
          .missingDataScore,
        [],
        {
          factor: 'transaction',
          count: 0,
          volume: 0,
          disabled: true,
        }
      );
    }

    const customerId =
      this.getCustomerId(
        customer
      );

    const tenantId =
      customer.tenantId ||
      context.tenantId;

    this.assertTenantId(
      tenantId
    );

    if (
      !this.db ||
      !this.db.transactions ||
      typeof this.db.transactions.find !==
        'function'
    ) {
      return this.finalizeFactor(
        this.config.factorDefaults
          .missingDataScore,
        [
          this.reason(
            'TRANSACTION_DATA_UNAVAILABLE',
            0,
            'Transaction repository is unavailable; transaction risk was not increased.'
          ),
        ],
        {
          factor: 'transaction',
          count: 0,
          volume: 0,
          unavailable: true,
        }
      );
    }

    const startDate =
      new Date(
        Date.now() -
          this.config
            .transactionWindowDays *
            24 *
            60 *
            60 *
            1000
      );

    const query = {
      customerId,
      tenantId,

      createdAt: {
        $gte: startDate,
      },
    };

    let transactions = [];

    try {
      const queryBuilder =
        this.db.transactions.find(
          query
        );

      if (
        queryBuilder &&
        typeof queryBuilder.limit ===
          'function'
      ) {
        queryBuilder.limit(
          this.config
            .transactionQueryLimit
        );
      }

      if (
        queryBuilder &&
        typeof queryBuilder.lean ===
          'function'
      ) {
        queryBuilder.lean();
      }

      transactions =
        queryBuilder &&
        typeof queryBuilder.exec ===
          'function'
          ? await queryBuilder.exec()
          : await queryBuilder;
    } catch (error) {
      this.logError(
        'Transaction risk query failed',
        error,
        {
          tenantId,
          customerId,
        }
      );

      throw error;
    }

    if (!Array.isArray(transactions)) {
      transactions = [];
    }

    let score = 0;

    const reasons = [];

    const count =
      transactions.length;

    const volume =
      transactions.reduce(
        (sum, transaction) => {
          const amount =
            this.toNonNegativeNumber(
              transaction.amount
            );

          return sum + amount;
        },
        0
      );

    const thresholds =
      this.config
        .transactionThresholds;

    if (
      count >
      thresholds.count
    ) {
      score += 25;

      reasons.push(
        this.reason(
          'HIGH_VOLUME',
          25,
          'Transaction count exceeded the configured observation threshold.',
          {
            count,
            threshold:
              thresholds.count,
          }
        )
      );
    }

    if (
      volume >
      thresholds.volume
    ) {
      score += 25;

      reasons.push(
        this.reason(
          'HIGH_VALUE',
          25,
          'Transaction volume exceeded the configured observation threshold.',
          {
            volume,
            threshold:
              thresholds.volume,
          }
        )
      );
    }

    return this.finalizeFactor(
      score,
      reasons,
      {
        factor: 'transaction',
        count,
        volume,
        observationWindowDays:
          this.config
            .transactionWindowDays,
      }
    );
  }

  // ==========================================================================
  // Composite Score
  // ==========================================================================

  calculateCompositeScore(
    factors
  ) {
    const weights =
      this.config.weights;

    const rawScore =
      this.normalizeScore(
        this.safeFactorScore(
          factors.kyc
        ) *
          weights.kyc +
          this.safeFactorScore(
            factors.aml
          ) *
            weights.aml +
          this.safeFactorScore(
            factors.fraud
          ) *
            weights.fraud +
          this.safeFactorScore(
            factors.credit
          ) *
            weights.credit +
          this.safeFactorScore(
            factors.transaction
          ) *
            weights.transaction
      );

    const score =
      Math.round(
        rawScore
      );

    const level =
      this.determineRiskLevel(
        rawScore
      );

    return {
      score,
      rawScore,
      level,
      riskBand:
        this.getRiskBand(
          level
        ),
      action:
        this.getRiskAction(
          level
        ),
    };
  }

  // ==========================================================================
  // Risk Classification
  // ==========================================================================

  determineRiskLevel(
    score
  ) {
    const normalized =
      this.normalizeScore(
        score
      );

    if (
      normalized >=
      this.config
        .thresholds.high
    ) {
      return 'critical';
    }

    if (
      normalized >=
      this.config
        .thresholds.medium
    ) {
      return 'high';
    }

    if (
      normalized >=
      this.config
        .thresholds.low
    ) {
      return 'medium';
    }

    return 'low';
  }

  getRiskBand(
    level
  ) {
    switch (level) {
      case 'critical':
        return 'CRITICAL';

      case 'high':
        return 'HIGH';

      case 'medium':
        return 'MEDIUM';

      default:
        return 'LOW';
    }
  }

  getRiskAction(
    level
  ) {
    return (
      this.config
        .riskActions[level] ||
      this.config
        .riskActions.low
    );
  }

  // ==========================================================================
  // Monitoring
  // ==========================================================================

  async monitorCustomer(
    customerId,
    options = {}
  ) {
    this.assertCustomerId(
      customerId
    );

    const tenantId =
      options.tenantId;

    this.assertTenantId(
      tenantId
    );

    if (
      !this.db ||
      !this.db.customers ||
      typeof this.db.customers.findOne !==
        'function'
    ) {
      throw new Error(
        'Customer repository is unavailable.'
      );
    }

    const query = {
      _id: customerId,
      tenantId,
    };

    let customer;

    if (
      typeof this.db.customers.findOne ===
      'function'
    ) {
      customer =
        await this.db.customers.findOne(
          query
        );
    }

    if (!customer) {
      throw new Error(
        'Customer not found.'
      );
    }

    const score =
      await this.scoreCustomer(
        customer,
        {
          ...options,
          tenantId,
          source:
            options.source ||
            'risk-monitoring',
        }
      );

    return score;
  }

  // ==========================================================================
  // High Risk Workflow
  // ==========================================================================

  async handleHighRiskProfile(
    profile,
    context = {}
  ) {
    this.emitSafe(
      'risk.high.detected',
      profile
    );

    this.incrementMetric(
      'high_risk_customers_detected',
      1,
      context
    );

    if (
      !this.config.highRiskQueue.enabled
    ) {
      return;
    }

    if (
      !this.queueService ||
      typeof this.queueService.enqueue !==
        'function'
    ) {
      this.logWarn(
        'High-risk queue unavailable; workflow notification skipped.',
        {
          tenantId:
            profile.tenantId,
          customerId:
            profile.customerId,
        }
      );

      return;
    }

    try {
      await this.queueService.enqueue(
        this.config.highRiskQueue
          .queueName,
        {
          eventId:
            crypto.randomUUID(),

          eventType:
            'risk.high.detected',

          tenantId:
            profile.tenantId,

          customerId:
            profile.customerId,

          riskScore:
            profile.score,

          riskLevel:
            profile.level,

          riskBand:
            profile.riskBand,

          action:
            profile.action,

          fingerprint:
            profile.fingerprint,

          scoringModelVersion:
            profile.scoringModelVersion,

          occurredAt:
            new Date(),
        }
      );

      this.incrementMetric(
        'high_risk_workflow_enqueued',
        1,
        context
      );
    } catch (error) {
      this.incrementMetric(
        'high_risk_workflow_enqueue_failures',
        1,
        context
      );

      this.logError(
        'Failed to enqueue high-risk customer workflow',
        error,
        {
          tenantId:
            profile.tenantId,
          customerId:
            profile.customerId,
        }
      );

      /*
       * Risk scoring itself remains successful.
       * Workflow delivery failure must be handled by
       * the queue/outbox/retry infrastructure.
       */
    }
  }

  // ==========================================================================
  // Score Persistence
  // ==========================================================================

  async persistScore(
    profile,
    context = {}
  ) {
    if (
      !this.db ||
      !this.db.riskScores ||
      typeof this.db.riskScores.create !==
        'function'
    ) {
      throw new Error(
        'Risk score repository is unavailable.'
      );
    }

    const record = {
      ...profile,
      id:
        profile.id ||
        crypto.randomUUID(),

      createdAt:
        profile.createdAt ||
        new Date(),

      scoringModelVersion:
        profile.scoringModelVersion ||
        this.scoringModelVersion,
    };

    /*
     * Fingerprint provides a deterministic identity for the
     * same scoring calculation and allows future unique indexes.
     */
    try {
      const existing =
        await this.findScoreByFingerprint(
          record.tenantId,
          record.customerId,
          record.fingerprint
        );

      if (existing) {
        return existing;
      }
    } catch (error) {
      this.logWarn(
        'Risk score fingerprint lookup failed; continuing with persistence.',
        {
          error:
            error.message,
          tenantId:
            record.tenantId,
          customerId:
            record.customerId,
        }
      );
    }

    let persisted;

    try {
      persisted =
        await this.db.riskScores.create(
          record
        );
    } catch (error) {
      /*
       * A unique fingerprint index may reject concurrent
       * duplicate calculations. Attempt to recover gracefully.
       */
      if (
        this.isDuplicateKeyError(
          error
        )
      ) {
        const existing =
          await this.findScoreByFingerprint(
            record.tenantId,
            record.customerId,
            record.fingerprint
          );

        if (existing) {
          return existing;
        }
      }

      throw error;
    }

    await this.audit(
      record.tenantId,
      record.customerId,
      'RISK_SCORE_CREATED',
      {
        scoreId:
          record.id,

        score:
          record.score,

        level:
          record.level,

        riskBand:
          record.riskBand,

        action:
          record.action,

        fingerprint:
          record.fingerprint,

        scoringModelVersion:
          record.scoringModelVersion,
      },
      context
    );

    return persisted;
  }

  async findScoreByFingerprint(
    tenantId,
    customerId,
    fingerprint
  ) {
    if (
      !fingerprint ||
      !this.db ||
      !this.db.riskScores ||
      typeof this.db.riskScores.findOne !==
        'function'
    ) {
      return null;
    }

    return this.db.riskScores.findOne({
      tenantId,
      customerId,
      fingerprint,
    });
  }

  // ==========================================================================
  // Retrieval
  // ==========================================================================

  async getLatestScore(
    customerId,
    options = {}
  ) {
    this.assertCustomerId(
      customerId
    );

    this.assertTenantId(
      options.tenantId
    );

    if (
      !this.db ||
      !this.db.riskScores ||
      typeof this.db.riskScores.findOne !==
        'function'
    ) {
      return null;
    }

    const query = {
      customerId,
      tenantId:
        options.tenantId,
    };

    return this.db.riskScores.findOne(
      query,
      {
        sort: {
          calculatedAt: -1,
        },
      }
    );
  }

  async getScoreHistory(
    customerId,
    options = {}
  ) {
    this.assertCustomerId(
      customerId
    );

    this.assertTenantId(
      options.tenantId
    );

    const limit =
      Math.min(
        Math.max(
          Number(
            options.limit || 50
          ),
          1
        ),
        500
      );

    if (
      !this.db ||
      !this.db.riskScores ||
      typeof this.db.riskScores.find !==
        'function'
    ) {
      return [];
    }

    const query = {
      customerId,
      tenantId:
        options.tenantId,
    };

    const result =
      this.db.riskScores.find(
        query
      );

    if (
      result &&
      typeof result.sort ===
        'function'
    ) {
      result.sort({
        calculatedAt: -1,
      });
    }

    if (
      result &&
      typeof result.limit ===
        'function'
    ) {
      result.limit(limit);
    }

    if (
      result &&
      typeof result.lean ===
        'function'
    ) {
      result.lean();
    }

    return result &&
      typeof result.exec ===
        'function'
      ? result.exec()
      : result;
  }

  // ==========================================================================
  // Cache
  // ==========================================================================

  buildCacheKey(
    tenantId,
    customerId
  ) {
    return [
      'risk',
      'customer',
      String(tenantId),
      String(customerId),
      this.scoringModelVersion,
    ].join(':');
  }

  async getCache(
    key,
    context = {}
  ) {
    if (
      !this.cache ||
      typeof this.cache.get !==
        'function'
    ) {
      return null;
    }

    try {
      const value =
        await this.cache.get(
          key
        );

      return this.deserializeCacheValue(
        value
      );
    } catch (error) {
      this.incrementMetric(
        'risk_cache_read_failures',
        1,
        context
      );

      this.logWarn(
        'Risk scoring cache read failed.',
        {
          error:
            error.message,
          key,
        }
      );

      if (
        this.config.cache.failOpen
      ) {
        return null;
      }

      throw error;
    }
  }

  async setCache(
    key,
    value,
    context = {}
  ) {
    if (
      !this.cache ||
      typeof this.cache.set !==
        'function'
    ) {
      return;
    }

    try {
      const serialized =
        JSON.stringify(
          value
        );

      /*
       * Support both common Redis-style:
       *   set(key, value, ttl)
       *
       * and:
       *   set(key, value, { EX: ttl })
       */
      await this.cache.set(
        key,
        serialized,
        this.config.cacheTtl
      );
    } catch (error) {
      this.incrementMetric(
        'risk_cache_write_failures',
        1,
        context
      );

      this.logWarn(
        'Risk scoring cache write failed.',
        {
          error:
            error.message,
          key,
        }
      );

      if (
        !this.config.cache.failOpen
      ) {
        throw error;
      }
    }
  }

  deserializeCacheValue(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    if (
      typeof value === 'object'
    ) {
      return value;
    }

    try {
      return JSON.parse(
        value
      );
    } catch (
      error
    ) {
      return null;
    }
  }

  async invalidateCustomer(
    customerId,
    options = {}
  ) {
    this.assertCustomerId(
      customerId
    );

    this.assertTenantId(
      options.tenantId
    );

    if (
      !this.cache ||
      typeof this.cache.del !==
        'function'
    ) {
      return;
    }

    const key =
      this.buildCacheKey(
        options.tenantId,
        customerId
      );

    try {
      await this.cache.del(
        key
      );

      this.incrementMetric(
        'risk_cache_invalidations',
        1,
        options
      );
    } catch (error) {
      this.logWarn(
        'Risk scoring cache invalidation failed.',
        {
          error:
            error.message,
          tenantId:
            options.tenantId,
          customerId,
        }
      );
    }
  }

  // ==========================================================================
  // Metrics
  // ==========================================================================

  async getMetrics(
    options = {}
  ) {
    this.assertTenantId(
      options.tenantId
    );

    if (
      !this.db ||
      !this.db.riskScores
    ) {
      return {
        total: 0,
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      };
    }

    const tenantFilter = {
      tenantId:
        options.tenantId,
    };

    const [
      total,
      low,
      medium,
      high,
      critical,
    ] = await Promise.all([
      this.db.riskScores.count(
        tenantFilter
      ),

      this.db.riskScores.count({
        ...tenantFilter,
        level: 'low',
      }),

      this.db.riskScores.count({
        ...tenantFilter,
        level: 'medium',
      }),

      this.db.riskScores.count({
        ...tenantFilter,
        level: 'high',
      }),

      this.db.riskScores.count({
        ...tenantFilter,
        level: 'critical',
      }),
    ]);

    return {
      total,
      low,
      medium,
      high,
      critical,

      percentages:
        this.calculatePercentages({
          total,
          low,
          medium,
          high,
          critical,
        }),

      scoringModelVersion:
        this.scoringModelVersion,
    };
  }

  calculatePercentages(
    values
  ) {
    const total =
      values.total || 0;

    if (total === 0) {
      return {
        low: 0,
        medium: 0,
        high: 0,
        critical: 0,
      };
    }

    return {
      low:
        this.roundPercentage(
          values.low,
          total
        ),

      medium:
        this.roundPercentage(
          values.medium,
          total
        ),

      high:
        this.roundPercentage(
          values.high,
          total
        ),

      critical:
        this.roundPercentage(
          values.critical,
          total
        ),
    };
  }

  roundPercentage(
    numerator,
    denominator
  ) {
    return Number(
      (
        (numerator /
          denominator) *
        100
      ).toFixed(2)
    );
  }

  // ==========================================================================
  // Manual Rescoring
  // ==========================================================================

  async rescoreCustomer(
    customer,
    options = {}
  ) {
    this.assertCustomer(
      customer
    );

    const tenantId =
      customer.tenantId ||
      options.tenantId;

    this.assertTenantId(
      tenantId
    );

    await this.invalidateCustomer(
      this.getCustomerId(
        customer
      ),
      {
        tenantId,
      }
    );

    return this.scoreCustomer(
      customer,
      {
        ...options,
        tenantId,
        forceRefresh: true,
        source:
          options.source ||
          'manual-rescore',
      }
    );
  }

  // ==========================================================================
  // Fingerprinting
  // ==========================================================================

  generateScoreFingerprint(
    payload
  ) {
    const canonicalPayload =
      this.canonicalize(
        payload
      );

    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify(
          canonicalPayload
        )
      )
      .digest('hex');
  }

  canonicalize(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return value;
    }

    if (
      Array.isArray(value)
    ) {
      return value.map(
        (item) =>
          this.canonicalize(
            item
          )
      );
    }

    if (
      typeof value ===
      'object'
    ) {
      return Object.keys(
        value
      )
        .sort()
        .reduce(
          (
            result,
            key
          ) => {
            result[key] =
              this.canonicalize(
                value[key]
              );

            return result;
          },
          {}
        );
    }

    return value;
  }

  // ==========================================================================
  // Factor Helpers
  // ==========================================================================

  finalizeFactor(
    score,
    reasons = [],
    metadata = {}
  ) {
    return {
      score:
        this.normalizeScore(
          score
        ),

      reasons:
        Array.isArray(
          reasons
        )
          ? reasons
          : [],

      metadata,
    };
  }

  reason(
    code,
    contribution,
    description,
    metadata = {}
  ) {
    return {
      code,
      contribution:
        this.normalizeScore(
          contribution
        ),
      description,
      metadata,
    };
  }

  safeFactorScore(
    factor
  ) {
    if (
      !factor ||
      !Number.isFinite(
        factor.score
      )
    ) {
      return 0;
    }

    return this.normalizeScore(
      factor.score
    );
  }

  getMatchCount(
    value
  ) {
    if (
      !value
    ) {
      return 0;
    }

    if (
      Array.isArray(
        value.matches
      )
    ) {
      return value.matches.length;
    }

    if (
      Number.isFinite(
        value.count
      )
    ) {
      return Math.max(
        0,
        value.count
      );
    }

    return 0;
  }

  // ==========================================================================
  // Validation
  // ==========================================================================

  assertCustomer(
    customer
  ) {
    if (
      !customer ||
      typeof customer !==
        'object'
    ) {
      throw new TypeError(
        'A valid customer object is required.'
      );
    }

    this.assertCustomerId(
      this.getCustomerId(
        customer
      )
    );
  }

  assertCustomerId(
    customerId
  ) {
    if (
      customerId === null ||
      customerId === undefined ||
      String(customerId).trim() === ''
    ) {
      throw new TypeError(
        'customerId is required.'
      );
    }
  }

  assertTenantId(
    tenantId
  ) {
    if (
      tenantId === null ||
      tenantId === undefined ||
      String(tenantId).trim() === ''
    ) {
      throw new TypeError(
        'tenantId is required for tenant-isolated risk scoring.'
      );
    }
  }

  getCustomerId(
    customer
  ) {
    return (
      customer.id ||
      customer._id ||
      customer.customerId
    );
  }

  // ==========================================================================
  // Numeric / String Normalization
  // ==========================================================================

  normalizeScore(
    value
  ) {
    const numeric =
      Number(value);

    if (
      !Number.isFinite(
        numeric
      )
    ) {
      return 0;
    }

    return Math.min(
      100,
      Math.max(
        0,
        numeric
      )
    );
  }

  toNonNegativeNumber(
    value
  ) {
    const numeric =
      Number(value);

    if (
      !Number.isFinite(
        numeric
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      numeric
    );
  }

  toNullableNumber(
    value
  ) {
    if (
      value === null ||
      value === undefined ||
      value === ''
    ) {
      return null;
    }

    const numeric =
      Number(value);

    return Number.isFinite(
      numeric
    )
      ? numeric
      : null;
  }

  normalizeString(
    value
  ) {
    if (
      typeof value !==
      'string'
    ) {
      return '';
    }

    return value
      .trim()
      .toLowerCase();
  }

  // ==========================================================================
  // Context
  // ==========================================================================

  createContext(
    options = {}
  ) {
    return {
      tenantId:
        options.tenantId ||
        null,

      correlationId:
        options.correlationId ||
        options.requestId ||
        null,

      actorId:
        options.actorId ||
        options.userId ||
        null,

      source:
        options.source ||
        'risk-scoring-service',
    };
  }

  // ==========================================================================
  // Audit
  // ==========================================================================

  async audit(
    tenantId,
    customerId,
    action,
    payload,
    context = {}
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
        customerId,
        action,
        payload,
        timestamp:
          new Date(),

        correlationId:
          context.correlationId ||
          null,

        actorId:
          context.actorId ||
          null,

        service:
          this.serviceName,

        scoringModelVersion:
          this.scoringModelVersion,
      });
    } catch (error) {
      this.incrementMetric(
        'risk_audit_failures',
        1,
        context
      );

      this.logError(
        'Risk score audit failed',
        error,
        {
          tenantId,
          customerId,
          action,
        }
      );

      /*
       * Audit failure must never silently modify
       * the calculated risk score. In a regulated
       * deployment, the audit infrastructure should
       * independently provide durable retry/outbox
       * semantics.
       */
    }
  }

  // ==========================================================================
  // Event Safety
  // ==========================================================================

  emitSafe(
    eventName,
    payload
  ) {
    try {
      this.emit(
        eventName,
        payload
      );
    } catch (error) {
      this.logError(
        'Risk event listener failed',
        error,
        {
          eventName,
        }
      );
    }
  }

  // ==========================================================================
  // Metrics Integration
  // ==========================================================================

  incrementMetric(
    name,
    value = 1,
    context = {}
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
          {
            service:
              this.serviceName,

            tenantId:
              context.tenantId ||
              undefined,

            scoringModelVersion:
              this.scoringModelVersion,
          }
        );

        return;
      }

      if (
        typeof this.metricsService.inc ===
        'function'
      ) {
        this.metricsService.inc(
          name,
          value
        );
      }
    } catch (error) {
      this.logWarn(
        'Risk metrics update failed.',
        {
          metric:
            name,
          error:
            error.message,
        }
      );
    }
  }

  // ==========================================================================
  // Error Classification
  // ==========================================================================

  isDuplicateKeyError(
    error
  ) {
    return Boolean(
      error &&
        (
          error.code === 11000 ||
          error.codeName ===
            'DuplicateKey'
        )
    );
  }

  // ==========================================================================
  // Logging
  // ==========================================================================

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
            this.serviceName,

          error:
            error
              ? {
                  name:
                    error.name,
                  message:
                    error.message,
                  code:
                    error.code,
                  stack:
                    error.stack,
                }
              : undefined,

          ...metadata,
        }
      );

      return;
    }

    /*
     * Do not use console.error by default in production.
     * Structured application logging should own this path.
     */
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
            this.serviceName,
          ...metadata,
        }
      );
    }
  }
}

module.exports =
  RiskScoringService;