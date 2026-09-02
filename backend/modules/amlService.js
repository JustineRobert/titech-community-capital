// backend/modules/amlService.js
'use strict';

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise AML Service
 * ============================================================================
 *
 * File:
 *   backend/modules/amlService.js
 *
 * Responsibilities:
 *   - Customer AML screening
 *   - Sanctions / PEP / adverse-media orchestration
 *   - Transaction monitoring
 *   - Structuring detection
 *   - Velocity detection
 *   - AML alert management
 *   - AML case lifecycle management
 *   - Enhanced Due Diligence (EDD)
 *   - Periodic rescreening orchestration
 *   - SAR / STR generation
 *   - AML risk scoring
 *   - Audit integration
 *   - Metrics / observability
 *   - Event emission
 *
 * Design principles:
 *   - Multi-tenant isolation
 *   - Fail-safe AML processing
 *   - Idempotent alert creation
 *   - Immutable evidence snapshots
 *   - Configurable monitoring rules
 *   - Provider failure visibility
 *   - No direct financial balance mutation
 *   - Backward-compatible service API
 *   - Dependency injection
 *
 * NOTE:
 * This service intentionally does NOT implement provider-specific screening
 * logic. Sanctions, PEP and adverse-media providers remain behind their
 * respective injected services.
 * ============================================================================
 */

const crypto = require('crypto');
const EventEmitter = require('events');

/**
 * ============================================================================
 * Constants
 * ============================================================================
 */

const AML_ALERT_STATUS = Object.freeze({
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

const AML_CASE_STATUS = Object.freeze({
  OPEN: 'open',
  INVESTIGATING: 'investigating',
  ESCALATED: 'escalated',
  RESOLVED: 'resolved',
  CLOSED: 'closed',
});

const RISK_LEVEL = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

const FINDING = Object.freeze({
  LARGE_TRANSACTION: 'LARGE_TRANSACTION',
  STRUCTURING: 'STRUCTURING',
  HIGH_VELOCITY: 'HIGH_VELOCITY',
  SANCTIONS_MATCH: 'SANCTIONS_MATCH',
  PEP_MATCH: 'PEP_MATCH',
  ADVERSE_MEDIA_MATCH: 'ADVERSE_MEDIA_MATCH',
  SCREENING_PROVIDER_FAILURE: 'SCREENING_PROVIDER_FAILURE',
});

const DEFAULTS = Object.freeze({
  cacheTtl: 300,

  transactionThreshold: 10_000_000,

  highRiskScore: 80,
  mediumRiskScore: 50,

  rescreenDays: 90,

  velocityWindowMinutes: 60,
  velocityTransactionCount: 20,

  structuringWindowHours: 24,
  structuringThreshold: 10_000_000,

  /*
   * Amounts below this threshold are considered possible structuring
   * candidates when the aggregate crosses the configured threshold.
   */
  structuringIndividualPercentage: 0.25,

  /*
   * Maximum number of historical transactions loaded by monitoring rules.
   */
  monitoringTransactionLimit: 500,

  /*
   * Rescreening queue batch size.
   */
  rescreenBatchSize: 100,

  /*
   * Cache prefix.
   */
  cachePrefix: 'aml',

  /*
   * Whether screening should fail if one or more screening providers fail.
   *
   * Default is false for operational resilience, but provider failure is
   * explicitly surfaced in the result and risk calculation.
   */
  failClosedOnScreeningProviderError: false,

  /*
   * Whether audit failures should fail high-risk AML operations.
   */
  failClosedOnCriticalAuditError: false,

  /*
   * Alert deduplication window.
   */
  alertDeduplicationMinutes: 60,

  /*
   * Screening risk weights.
   */
  riskWeights: {
    sanctions: 100,
    pep: 50,
    adverseMedia: 25,
    providerFailure: 20,
  },

  /*
   * Finding weights.
   */
  findingWeights: {
    LARGE_TRANSACTION: 40,
    STRUCTURING: 60,
    HIGH_VELOCITY: 40,
    SANCTIONS_MATCH: 100,
    PEP_MATCH: 50,
    ADVERSE_MEDIA_MATCH: 25,
    SCREENING_PROVIDER_FAILURE: 20,
  },
});

/**
 * ============================================================================
 * Domain Error
 * ============================================================================
 */

class AMLServiceError extends Error {
  constructor(message, code = 'AML_SERVICE_ERROR', details = {}) {
    super(message);

    this.name = 'AMLServiceError';
    this.code = code;
    this.details = details;

    Error.captureStackTrace?.(
      this,
      AMLServiceError
    );
  }
}

/**
 * ============================================================================
 * AML Service
 * ============================================================================
 */

class AMLService extends EventEmitter {
  constructor({
    db,
    logger,
    cache,
    queueService,
    auditService,
    notificationService,
    riskScoringService,
    sanctionsService,
    pepService,
    adverseMediaService,
    reportExportService,
    metricsService,
    config = {},
  } = {}) {
    super();

    if (!db) {
      throw new AMLServiceError(
        'AMLService requires a database dependency.',
        'AML_DB_REQUIRED'
      );
    }

    this.db = db;
    this.logger = logger;
    this.cache = cache;
    this.queueService = queueService;
    this.auditService = auditService;
    this.notificationService = notificationService;
    this.riskScoringService = riskScoringService;
    this.sanctionsService = sanctionsService;
    this.pepService = pepService;
    this.adverseMediaService = adverseMediaService;
    this.reportExportService = reportExportService;
    this.metricsService = metricsService;

    this.config = {
      ...DEFAULTS,
      ...config,

      riskWeights: {
        ...DEFAULTS.riskWeights,
        ...(config.riskWeights || {}),
      },

      findingWeights: {
        ...DEFAULTS.findingWeights,
        ...(config.findingWeights || {}),
      },
    };
  }

  /**
   * ==========================================================================
   * Customer Screening
   * ==========================================================================
   */

  async screen(identity, options = {}) {
    const startedAt = Date.now();

    this._assertIdentity(identity);

    const tenantId =
      options.tenantId ||
      identity.tenantId ||
      null;

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const cacheKey =
      this._buildScreeningCacheKey(
        tenantId,
        identity
      );

    try {
      if (!options.forceRefresh && this.cache) {
        const cached =
          await this._cacheGet(cacheKey);

        if (cached) {
          await this._incrementMetric(
            'aml.screening.cache_hit'
          );

          return {
            ...cached,
            cached: true,
            correlationId,
          };
        }
      }

      await this._incrementMetric(
        'aml.screening.started'
      );

      const providerResults =
        await this._runScreeningProviders(
          identity,
          correlationId
        );

      const risk =
        this.calculateScreeningRisk(
          providerResults
        );

      const screenedAt =
        new Date();

      const result = {
        tenantId,

        identityReference:
          this._buildIdentityReference(
            identity
          ),

        sanctions:
          providerResults.sanctions.result,

        pep:
          providerResults.pep.result,

        adverseMedia:
          providerResults.adverseMedia.result,

        providerStatus: {
          sanctions:
            providerResults.sanctions.status,

          pep:
            providerResults.pep.status,

          adverseMedia:
            providerResults.adverseMedia.status,
        },

        providerErrors:
          providerResults.errors,

        risk,

        screenedAt,

        correlationId,

        cached: false,
      };

      /*
       * A screening containing provider failures should not normally be cached
       * for the same duration as a successful screening.
       */
      const cacheTtl =
        providerResults.hasProviderFailure
          ? Math.min(
              this.config.cacheTtl,
              60
            )
          : this.config.cacheTtl;

      if (this.cache && cacheTtl > 0) {
        await this._cacheSet(
          cacheKey,
          result,
          cacheTtl
        );
      }

      await this._incrementMetric(
        'aml.screening.completed'
      );

      if (risk.level === RISK_LEVEL.HIGH ||
          risk.level === RISK_LEVEL.CRITICAL) {
        await this._incrementMetric(
          'aml.screening.high_risk'
        );
      }

      await this.audit(
        tenantId,
        identity.customerId || identity.id,
        'AML_SCREENING_COMPLETED',
        {
          correlationId,
          risk,
          providerStatus:
            result.providerStatus,
          screenedAt,
        }
      );

      this.emit(
        'aml.screening.completed',
        result
      );

      if (
        providerResults.hasProviderFailure &&
        this.config
          .failClosedOnScreeningProviderError
      ) {
        throw new AMLServiceError(
          'AML screening could not be completed because one or more screening providers failed.',
          'AML_SCREENING_PROVIDER_FAILURE',
          {
            correlationId,
            providerErrors:
              providerResults.errors,
          }
        );
      }

      return result;
    } catch (error) {
      await this._incrementMetric(
        'aml.screening.failed'
      );

      this._logError(
        'AML customer screening failed',
        error,
        {
          tenantId,
          correlationId,
          durationMs:
            Date.now() - startedAt,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Screening Provider Orchestration
   * ==========================================================================
   */

  async _runScreeningProviders(
    identity,
    correlationId
  ) {
    const providers = {
      sanctions:
        this.sanctionsService,

      pep:
        this.pepService,

      adverseMedia:
        this.adverseMediaService,
    };

    const entries =
      Object.entries(providers);

    const settled =
      await Promise.all(
        entries.map(
          async ([name, service]) => {
            if (
              !service ||
              typeof service.screen !==
                'function'
            ) {
              return {
                name,
                status: 'unavailable',
                result: null,
                error: {
                  code:
                    'PROVIDER_UNAVAILABLE',
                  message:
                    `${name} screening service is unavailable.`,
                },
              };
            }

            try {
              const result =
                await service.screen(
                  identity,
                  {
                    correlationId,
                  }
                );

              return {
                name,
                status: 'success',
                result,
                error: null,
              };
            } catch (error) {
              await this._incrementMetric(
                `aml.screening.provider.${name}.failed`
              );

              this._logError(
                `${name} AML screening provider failed`,
                error,
                {
                  correlationId,
                }
              );

              return {
                name,
                status: 'failed',
                result: null,
                error: {
                  code:
                    error.code ||
                    'PROVIDER_ERROR',
                  message:
                    error.message ||
                    `${name} screening failed.`,
                },
              };
            }
          }
        )
      );

    const normalized = {
      sanctions: {
        status: 'unavailable',
        result: null,
        error: null,
      },

      pep: {
        status: 'unavailable',
        result: null,
        error: null,
      },

      adverseMedia: {
        status: 'unavailable',
        result: null,
        error: null,
      },

      errors: [],
      hasProviderFailure: false,
    };

    for (const item of settled) {
      normalized[item.name] = {
        status: item.status,
        result: item.result,
        error: item.error,
      };

      if (item.error) {
        normalized.errors.push({
          provider: item.name,
          ...item.error,
        });
      }

      if (
        item.status === 'failed' ||
        item.status === 'unavailable'
      ) {
        normalized.hasProviderFailure = true;
      }
    }

    return normalized;
  }

  /**
   * ==========================================================================
   * Transaction Monitoring
   * ==========================================================================
   */

  async monitorTransaction(
    transaction,
    options = {}
  ) {
    const startedAt = Date.now();

    this._assertTransaction(
      transaction
    );

    const correlationId =
      options.correlationId ||
      transaction.correlationId ||
      this._createCorrelationId();

    const findings = [];
    const evidence = [];

    try {
      const amount =
        this._getTransactionAmount(
          transaction
        );

      /*
       * Large transaction rule.
       */
      if (
        amount >=
        this.config.transactionThreshold
      ) {
        findings.push(
          FINDING.LARGE_TRANSACTION
        );

        evidence.push({
          rule:
            FINDING.LARGE_TRANSACTION,
          amount,
          threshold:
            this.config.transactionThreshold,
        });
      }

      /*
       * Structuring rule.
       */
      const structuringResult =
        await this.detectStructuring(
          transaction,
          {
            correlationId,
            returnEvidence: true,
          }
        );

      if (structuringResult.suspicious) {
        findings.push(
          FINDING.STRUCTURING
        );

        evidence.push(
          structuringResult.evidence
        );
      }

      /*
       * Velocity rule.
       */
      const velocityResult =
        await this.detectVelocity(
          transaction,
          {
            correlationId,
            returnEvidence: true,
          }
        );

      if (velocityResult.suspicious) {
        findings.push(
          FINDING.HIGH_VELOCITY
        );

        evidence.push(
          velocityResult.evidence
        );
      }

      const risk =
        this.calculateTransactionRisk(
          findings
        );

      const suspicious =
        findings.length > 0;

      const reviewedAt =
        new Date();

      const result = {
        suspicious,
        findings,
        risk,
        evidence,
        reviewedAt,
        correlationId,
      };

      await this._incrementMetric(
        'aml.transaction_monitoring.completed'
      );

      if (suspicious) {
        await this._incrementMetric(
          'aml.transaction_monitoring.suspicious'
        );

        const alert =
          await this.createAlert({
            tenantId:
              transaction.tenantId,

            customerId:
              transaction.customerId,

            transactionId:
              transaction.id ||
              transaction._id,

            findings,

            severity:
              risk.level,

            riskScore:
              risk.score,

            evidence,

            transactionSnapshot:
              this._buildTransactionSnapshot(
                transaction
              ),

            correlationId,
          });

        result.alert = alert;
      }

      this.emit(
        'aml.transaction.monitored',
        result
      );

      return result;
    } catch (error) {
      await this._incrementMetric(
        'aml.transaction_monitoring.failed'
      );

      this._logError(
        'AML transaction monitoring failed',
        error,
        {
          tenantId:
            transaction.tenantId,

          transactionId:
            transaction.id ||
            transaction._id,

          correlationId,

          durationMs:
            Date.now() - startedAt,
        }
      );

      throw error;
    }
  }

  /**
   * ==========================================================================
   * Structuring Detection
   * ==========================================================================
   */

  async detectStructuring(
    transaction,
    options = {}
  ) {
    this._assertTransaction(
      transaction
    );

    if (!transaction.customerId) {
      return options.returnEvidence
        ? {
            suspicious: false,
            evidence: null,
          }
        : false;
    }

    const now =
      new Date();

    const windowStart =
      new Date(
        now.getTime() -
          this.config
            .structuringWindowHours *
            60 *
            60 *
            1000
      );

    const tenantId =
      transaction.tenantId;

    const query =
      this._tenantQuery(
        tenantId,
        {
          customerId:
            transaction.customerId,

          createdAt: {
            $gte: windowStart,
            $lte: now,
          },

          /*
           * Exclude cancelled/reversed transactions when those fields exist.
           */
          status: {
            $nin: [
              'cancelled',
              'reversed',
              'failed',
              'voided',
            ],
          },
        }
      );

    let transactions =
      await this._findTransactions(
        query,
        this.config
          .monitoringTransactionLimit
      );

    /*
     * Include the transaction currently being evaluated if the database
     * does not yet contain it.
     */
    const transactionId =
      transaction.id ||
      transaction._id;

    if (
      transactionId &&
      !transactions.some(
        (item) =>
          String(
            item.id ||
            item._id
          ) === String(transactionId)
      )
    ) {
      transactions = [
        ...transactions,
        transaction,
      ];
    }

    let total = 0;

    let candidateCount = 0;

    const candidateTransactions = [];

    for (const tx of transactions) {
      const amount =
        this._getTransactionAmount(
          tx
        );

      total += amount;

      /*
       * Potential structuring candidates are materially smaller than the
       * configured aggregate threshold.
       */
      if (
        amount <
        this.config.structuringThreshold *
          this.config
            .structuringIndividualPercentage
      ) {
        candidateCount += 1;

        candidateTransactions.push({
          id:
            tx.id ||
            tx._id,

          amount,

          createdAt:
            tx.createdAt,
        });
      }
    }

    const suspicious =
      total >=
        this.config.structuringThreshold &&
      candidateCount >= 2;

    const evidence = suspicious
      ? {
          rule:
            FINDING.STRUCTURING,

          windowStart,

          windowEnd: now,

          aggregateAmount: total,

          threshold:
            this.config
              .structuringThreshold,

          candidateCount,

          candidateTransactions:
            candidateTransactions.slice(
              0,
              50
            ),
        }
      : null;

    if (options.returnEvidence) {
      return {
        suspicious,
        evidence,
      };
    }

    return suspicious;
  }

  /**
   * ==========================================================================
   * Velocity Detection
   * ==========================================================================
   */

  async detectVelocity(
    transaction,
    options = {}
  ) {
    this._assertTransaction(
      transaction
    );

    if (!transaction.customerId) {
      return options.returnEvidence
        ? {
            suspicious: false,
            evidence: null,
          }
        : false;
    }

    const now =
      new Date();

    const windowStart =
      new Date(
        now.getTime() -
          this.config
            .velocityWindowMinutes *
            60 *
            1000
      );

    const query =
      this._tenantQuery(
        transaction.tenantId,
        {
          customerId:
            transaction.customerId,

          createdAt: {
            $gte: windowStart,
            $lte: now,
          },

          status: {
            $nin: [
              'cancelled',
              'reversed',
              'failed',
              'voided',
            ],
          },
        }
      );

    const count =
      await this._countTransactions(
        query
      );

    const suspicious =
      count >=
      this.config.velocityTransactionCount;

    const evidence = suspicious
      ? {
          rule:
            FINDING.HIGH_VELOCITY,

          windowStart,

          windowEnd: now,

          transactionCount: count,

          threshold:
            this.config
              .velocityTransactionCount,

          windowMinutes:
            this.config
              .velocityWindowMinutes,
        }
      : null;

    if (options.returnEvidence) {
      return {
        suspicious,
        evidence,
      };
    }

    return suspicious;
  }

  /**
   * ==========================================================================
   * Alert Management
   * ==========================================================================
   */

  async createAlert({
    tenantId,
    customerId,
    transactionId,
    findings = [],
    severity,
    riskScore = 0,
    evidence = [],
    transactionSnapshot = null,
    correlationId,
  }) {
    if (!tenantId) {
      throw new AMLServiceError(
        'AML alert requires tenantId.',
        'AML_TENANT_REQUIRED'
      );
    }

    if (!transactionId) {
      throw new AMLServiceError(
        'AML alert requires transactionId.',
        'AML_TRANSACTION_REQUIRED'
      );
    }

    if (!Array.isArray(findings) ||
        findings.length === 0) {
      throw new AMLServiceError(
        'AML alert requires at least one finding.',
        'AML_FINDING_REQUIRED'
      );
    }

    const now =
      new Date();

    const effectiveCorrelationId =
      correlationId ||
      this._createCorrelationId();

    const fingerprint =
      this._buildAlertFingerprint({
        tenantId,
        customerId,
        transactionId,
        findings,
      });

    /*
     * Deterministic deduplication.
     */
    const existing =
      await this._findExistingAlert(
        tenantId,
        fingerprint
      );

    if (existing) {
      await this._incrementMetric(
        'aml.alert.deduplicated'
      );

      return existing;
    }

    const alert = {
      id: crypto.randomUUID(),

      tenantId,
      customerId,
      transactionId,

      fingerprint,

      findings: [
        ...new Set(findings),
      ],

      severity:
        severity ||
        this._severityFromRisk(
          riskScore
        ),

      riskScore,

      status:
        AML_ALERT_STATUS.OPEN,

      priority:
        this._calculateAlertPriority({
          severity,
          riskScore,
          findings,
        }),

      evidence:
        this._sanitizeEvidence(
          evidence
        ),

      transactionSnapshot,

      correlationId:
        effectiveCorrelationId,

      detectionVersion:
        this.config
          .detectionVersion ||
        '1.0.0',

      createdAt: now,
      updatedAt: now,

      metadata: {
        source:
          'AMLService',

        detectionEngine:
          'transaction-monitoring',
      },
    };

    await this.db.amlAlerts.create(
      alert
    );

    await this._incrementMetric(
      'aml.alert.created'
    );

    /*
     * Notification failure should normally not erase a persisted AML alert.
     */
    try {
      if (
        this.notificationService &&
        typeof this.notificationService.send ===
          'function'
      ) {
        await this.notificationService.send({
          tenantId,
          type:
            'aml_alert_created',
          data: alert,
        });
      }
    } catch (error) {
      await this._incrementMetric(
        'aml.alert.notification_failed'
      );

      this._logError(
        'AML alert notification failed',
        error,
        {
          tenantId,
          alertId: alert.id,
          correlationId:
            effectiveCorrelationId,
        }
      );
    }

    await this.audit(
      tenantId,
      customerId,
      'AML_ALERT_CREATED',
      {
        alertId: alert.id,
        transactionId,
        findings: alert.findings,
        severity: alert.severity,
        riskScore,
        fingerprint,
        correlationId:
          effectiveCorrelationId,
      }
    );

    this.emit(
      'aml.alert.created',
      alert
    );

    return alert;
  }

  /**
   * ==========================================================================
   * Case Management
   * ==========================================================================
   */

  async openCase(
    alertId,
    investigatorId,
    options = {}
  ) {
    if (!alertId) {
      throw new AMLServiceError(
        'Alert ID is required.',
        'AML_ALERT_ID_REQUIRED'
      );
    }

    if (!investigatorId) {
      throw new AMLServiceError(
        'Investigator ID is required.',
        'AML_INVESTIGATOR_REQUIRED'
      );
    }

    const alert =
      await this.db.amlAlerts.findById(
        alertId
      );

    if (!alert) {
      throw new AMLServiceError(
        'AML alert not found.',
        'AML_ALERT_NOT_FOUND',
        {
          alertId,
        }
      );
    }

    if (
      options.tenantId &&
      String(alert.tenantId) !==
        String(options.tenantId)
    ) {
      throw new AMLServiceError(
        'AML alert does not belong to the requested tenant.',
        'AML_TENANT_ACCESS_DENIED'
      );
    }

    /*
     * Idempotent case creation.
     */
    const existingCase =
      await this._findCaseByAlertId(
        alert.tenantId,
        alert.id ||
          alert._id
      );

    if (existingCase) {
      return existingCase;
    }

    const now =
      new Date();

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const amlCase = {
      id: crypto.randomUUID(),

      tenantId:
        alert.tenantId,

      alertId:
        alert.id ||
        alert._id,

      customerId:
        alert.customerId,

      investigatorId,

      status:
        AML_CASE_STATUS.OPEN,

      priority:
        alert.priority,

      riskScore:
        alert.riskScore || 0,

      findings:
        Array.isArray(alert.findings)
          ? [...alert.findings]
          : [],

      evidence:
        this._sanitizeEvidence(
          alert.evidence || []
        ),

      correlationId,

      openedAt: now,
      createdAt: now,
      updatedAt: now,

      metadata: {
        source:
          'AMLService',
      },
    };

    await this.db.amlCases.create(
      amlCase
    );

    /*
     * Move alert into investigation state.
     */
    await this._updateAlertStatus(
      alert,
      AML_ALERT_STATUS.INVESTIGATING
    );

    await this.audit(
      alert.tenantId,
      alert.customerId,
      'AML_CASE_OPENED',
      {
        caseId: amlCase.id,
        alertId:
          amlCase.alertId,
        investigatorId,
        correlationId,
      }
    );

    await this._incrementMetric(
      'aml.case.opened'
    );

    this.emit(
      'aml.case.opened',
      amlCase
    );

    return amlCase;
  }

  /**
   * ==========================================================================
   * Case Closure
   * ==========================================================================
   */

  async closeCase(
    caseId,
    resolution,
    options = {}
  ) {
    if (!caseId) {
      throw new AMLServiceError(
        'Case ID is required.',
        'AML_CASE_ID_REQUIRED'
      );
    }

    if (
      !resolution ||
      typeof resolution !==
        'object'
    ) {
      throw new AMLServiceError(
        'A structured case resolution is required.',
        'AML_CASE_RESOLUTION_REQUIRED'
      );
    }

    const amlCase =
      await this.db.amlCases.findById(
        caseId
      );

    if (!amlCase) {
      throw new AMLServiceError(
        'Case not found.',
        'AML_CASE_NOT_FOUND',
        {
          caseId,
        }
      );
    }

    if (
      options.tenantId &&
      String(amlCase.tenantId) !==
        String(options.tenantId)
    ) {
      throw new AMLServiceError(
        'AML case does not belong to the requested tenant.',
        'AML_TENANT_ACCESS_DENIED'
      );
    }

    if (
      amlCase.status ===
      AML_CASE_STATUS.CLOSED
    ) {
      return amlCase;
    }

    const allowedStatuses = [
      AML_CASE_STATUS.OPEN,
      AML_CASE_STATUS.INVESTIGATING,
      AML_CASE_STATUS.ESCALATED,
      AML_CASE_STATUS.RESOLVED,
    ];

    if (
      !allowedStatuses.includes(
        amlCase.status
      )
    ) {
      throw new AMLServiceError(
        `AML case cannot be closed from status "${amlCase.status}".`,
        'AML_INVALID_CASE_TRANSITION'
      );
    }

    const now =
      new Date();

    const previousStatus =
      amlCase.status;

    const updatedCase = {
      ...amlCase,

      status:
        AML_CASE_STATUS.CLOSED,

      resolution:
        this._sanitizeResolution(
          resolution
        ),

      previousStatus,

      closedAt: now,
      updatedAt: now,

      closureCorrelationId:
        options.correlationId ||
        this._createCorrelationId(),
    };

    await this.db.amlCases.update(
      caseId,
      updatedCase
    );

    /*
     * Close associated alert when case is closed.
     */
    if (amlCase.alertId) {
      const alert =
        await this.db.amlAlerts.findById(
          amlCase.alertId
        );

      if (alert) {
        await this._updateAlertStatus(
          alert,
          AML_ALERT_STATUS.CLOSED
        );
      }
    }

    await this.audit(
      amlCase.tenantId,
      amlCase.customerId,
      'AML_CASE_CLOSED',
      {
        caseId,
        previousStatus,
        resolution:
          updatedCase.resolution,
        closedAt: now,
        correlationId:
          updatedCase.closureCorrelationId,
      },
      {
        critical: true,
      }
    );

    await this._incrementMetric(
      'aml.case.closed'
    );

    this.emit(
      'aml.case.closed',
      updatedCase
    );

    return updatedCase;
  }

  /**
   * ==========================================================================
   * Enhanced Due Diligence
   * ==========================================================================
   */

  async performEDD(
    tenantId,
    customerId,
    options = {}
  ) {
    if (!tenantId) {
      throw new AMLServiceError(
        'EDD requires tenantId.',
        'AML_TENANT_REQUIRED'
      );
    }

    if (!customerId) {
      throw new AMLServiceError(
        'EDD requires customerId.',
        'AML_CUSTOMER_REQUIRED'
      );
    }

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const customer =
      await this._findCustomer(
        tenantId,
        customerId
      );

    if (!customer) {
      throw new AMLServiceError(
        'Customer not found.',
        'AML_CUSTOMER_NOT_FOUND',
        {
          tenantId,
          customerId,
        }
      );
    }

    const screening =
      await this.screen(
        {
          ...customer,
          tenantId,
          customerId,
        },
        {
          tenantId,
          correlationId,
          forceRefresh:
            options.forceRefresh !== false,
        }
      );

    let risk = null;

    if (
      this.riskScoringService &&
      typeof this.riskScoringService
        .scoreAML === 'function'
    ) {
      risk =
        await this.riskScoringService.scoreAML(
          {
            customer,
            screening,
            tenantId,
            customerId,
            correlationId,
          }
        );
    } else {
      risk =
        screening.risk;
    }

    const result = {
      tenantId,
      customer,
      screening,
      risk,

      performedAt:
        new Date(),

      correlationId,
    };

    await this.audit(
      tenantId,
      customerId,
      'AML_EDD_PERFORMED',
      {
        correlationId,
        risk,
      }
    );

    await this._incrementMetric(
      'aml.edd.completed'
    );

    this.emit(
      'aml.edd.completed',
      result
    );

    return result;
  }

  /**
   * ==========================================================================
   * Periodic Rescreening
   * ==========================================================================
   */

  async processRescreening(
    options = {}
  ) {
    if (
      !this.queueService ||
      typeof this.queueService.enqueue !==
        'function'
    ) {
      throw new AMLServiceError(
        'Queue service is unavailable.',
        'AML_QUEUE_UNAVAILABLE'
      );
    }

    const now =
      new Date();

    const cutoff =
      new Date(
        now.getTime() -
          this.config.rescreenDays *
          24 *
          60 *
          60 *
          1000
      );

    const query = {
      $or: [
        {
          amlLastScreenedAt: {
            $lte: cutoff,
          },
        },
        {
          amlLastScreenedAt: null,
        },
        {
          amlLastScreenedAt: {
            $exists: false,
          },
        },
      ],
    };

    if (options.tenantId) {
      query.tenantId =
        options.tenantId;
    }

    const customers =
      await this.db.customers.find(
        query
      );

    const batchSize =
      Math.max(
        1,
        Number(
          options.batchSize ||
            this.config.rescreenBatchSize
        )
      );

    const result = {
      scanned:
        customers.length,

      queued: 0,

      failed: 0,

      failures: [],

      processedAt: now,
    };

    for (
      let offset = 0;
      offset < customers.length;
      offset += batchSize
    ) {
      const batch =
        customers.slice(
          offset,
          offset + batchSize
        );

      for (const customer of batch) {
        const customerId =
          customer.id ||
          customer._id;

        try {
          const jobPayload = {
            customerId,
            tenantId:
              customer.tenantId,
            requestedAt: now,
            reason:
              'PERIODIC_RESCREENING',
          };

          /*
           * Prefer deterministic job IDs when supported by the queue adapter.
           * Extra properties are harmless for adapters that ignore them.
           */
          const jobOptions = {
            jobId:
              `aml-rescreen:${customer.tenantId}:${customerId}`,
          };

          await this.queueService.enqueue(
            'aml-rescreen',
            jobPayload,
            jobOptions
          );

          result.queued += 1;

          await this._incrementMetric(
            'aml.rescreen.queued'
          );
        } catch (error) {
          result.failed += 1;

          result.failures.push({
            tenantId:
              customer.tenantId,

            customerId,

            error:
              error.message,
          });

          await this._incrementMetric(
            'aml.rescreen.queue_failed'
          );

          this._logError(
            'AML rescreening job enqueue failed',
            error,
            {
              tenantId:
                customer.tenantId,
              customerId,
            }
          );
        }
      }
    }

    this.emit(
      'aml.rescreening.processed',
      result
    );

    return result;
  }

  /**
   * ==========================================================================
   * SAR
   * ==========================================================================
   */

  async generateSAR(
    caseId,
    options = {}
  ) {
    return this._generateRegulatoryReport(
      'SAR',
      caseId,
      options
    );
  }

  /**
   * ==========================================================================
   * STR
   * ==========================================================================
   */

  async generateSTR(
    caseId,
    options = {}
  ) {
    return this._generateRegulatoryReport(
      'STR',
      caseId,
      options
    );
  }

  /**
   * ==========================================================================
   * Regulatory Report Generation
   * ==========================================================================
   */

  async _generateRegulatoryReport(
    reportType,
    caseId,
    options = {}
  ) {
    if (!caseId) {
      throw new AMLServiceError(
        'Case ID is required.',
        'AML_CASE_ID_REQUIRED'
      );
    }

    if (
      !this.reportExportService
    ) {
      throw new AMLServiceError(
        'AML report export service is unavailable.',
        'AML_REPORT_EXPORT_UNAVAILABLE'
      );
    }

    const amlCase =
      await this.db.amlCases.findById(
        caseId
      );

    if (!amlCase) {
      throw new AMLServiceError(
        'Case not found.',
        'AML_CASE_NOT_FOUND',
        {
          caseId,
        }
      );
    }

    if (
      options.tenantId &&
      String(amlCase.tenantId) !==
        String(options.tenantId)
    ) {
      throw new AMLServiceError(
        'AML case does not belong to the requested tenant.',
        'AML_TENANT_ACCESS_DENIED'
      );
    }

    if (
      amlCase.status ===
      AML_CASE_STATUS.OPEN
    ) {
      throw new AMLServiceError(
        `Cannot generate ${reportType} from an unopened investigation.`,
        'AML_REPORT_CASE_NOT_READY'
      );
    }

    const correlationId =
      options.correlationId ||
      this._createCorrelationId();

    const reportKey =
      this._buildReportIdempotencyKey(
        reportType,
        amlCase
      );

    /*
     * Reuse an already generated report if the model supports it.
     */
    if (
      amlCase.regulatoryReports &&
      amlCase.regulatoryReports[
        reportType
      ]
    ) {
      return amlCase
        .regulatoryReports[
        reportType
      ];
    }

    const exporter =
      reportType === 'SAR'
        ? this.reportExportService
            .exportSAR
        : this.reportExportService
            .exportSTR;

    if (
      typeof exporter !==
      'function'
    ) {
      throw new AMLServiceError(
        `${reportType} export operation is unavailable.`,
        'AML_REPORT_EXPORT_OPERATION_UNAVAILABLE'
      );
    }

    const report =
      await exporter.call(
        this.reportExportService,
        {
          ...amlCase,

          reportType,

          reportIdempotencyKey:
            reportKey,

          correlationId,
        }
      );

    /*
     * Persist report metadata where the adapter supports updates.
     */
    const reportMetadata = {
      reportId:
        report?.id ||
        report?.reportId ||
        crypto.randomUUID(),

      reportType,

      idempotencyKey:
        reportKey,

      generatedAt:
        new Date(),

      correlationId,

      result: report,
    };

    try {
      const existingReports =
        amlCase.regulatoryReports ||
        {};

      await this.db.amlCases.update(
        caseId,
        {
          regulatoryReports: {
            ...existingReports,

            [reportType]:
              reportMetadata,
          },

          updatedAt:
            new Date(),
        }
      );
    } catch (error) {
      /*
       * Do not discard an otherwise successfully generated regulatory report.
       * The failure is explicitly audited.
       */
      this._logError(
        `Failed to persist ${reportType} metadata`,
        error,
        {
          caseId,
          correlationId,
        }
      );
    }

    await this.audit(
      amlCase.tenantId,
      amlCase.customerId,
      `AML_${reportType}_GENERATED`,
      {
        caseId,
        reportId:
          reportMetadata.reportId,
        idempotencyKey:
          reportKey,
        correlationId,
      },
      {
        critical: true,
      }
    );

    await this._incrementMetric(
      `aml.regulatory.${reportType.toLowerCase()}.generated`
    );

    this.emit(
      `aml.${reportType.toLowerCase()}.generated`,
      reportMetadata
    );

    return report;
  }

  /**
   * ==========================================================================
   * Screening Risk Calculation
   * ==========================================================================
   */

  calculateScreeningRisk(
    screening = {}
  ) {
    let score = 0;

    const sanctionsMatches =
      screening.sanctions?.matches
        ?.length || 0;

    const pepMatches =
      screening.pep?.matches
        ?.length || 0;

    const adverseMediaMatches =
      screening.adverseMedia?.matches
        ?.length || 0;

    if (sanctionsMatches > 0) {
      score +=
        this.config.riskWeights
          .sanctions;
    }

    if (pepMatches > 0) {
      score +=
        this.config.riskWeights
          .pep;
    }

    if (
      adverseMediaMatches > 0
    ) {
      score +=
        this.config.riskWeights
          .adverseMedia;
    }

    const providerFailures =
      Array.isArray(
        screening.errors
      )
        ? screening.errors.length
        : 0;

    if (providerFailures > 0) {
      score +=
        this.config.riskWeights
          .providerFailure;
    }

    score =
      this._clampScore(score);

    let level =
      RISK_LEVEL.LOW;

    if (
      sanctionsMatches > 0 ||
      score >=
        this.config.highRiskScore
    ) {
      level =
        RISK_LEVEL.CRITICAL;
    } else if (
      score >=
      this.config.highRiskScore
    ) {
      level =
        RISK_LEVEL.HIGH;
    } else if (
      score >=
      this.config.mediumRiskScore
    ) {
      level =
        RISK_LEVEL.MEDIUM;
    }

    return {
      score,
      level,

      factors: {
        sanctionsMatches,
        pepMatches,
        adverseMediaMatches,
        providerFailures,
      },

      requiresEDD:
        level === RISK_LEVEL.HIGH ||
        level === RISK_LEVEL.CRITICAL,

      requiresReview:
        level !== RISK_LEVEL.LOW,
    };
  }

  /**
   * ==========================================================================
   * Transaction Risk Calculation
   * ==========================================================================
   */

  calculateTransactionRisk(
    findings = []
  ) {
    let score = 0;

    const factors = {};

    for (const finding of findings) {
      const weight =
        Number(
          this.config
            .findingWeights[
            finding
          ] || 0
        );

      score += weight;

      factors[finding] =
        weight;
    }

    score =
      this._clampScore(score);

    let level =
      RISK_LEVEL.LOW;

    if (
      score >= 100
    ) {
      level =
        RISK_LEVEL.CRITICAL;
    } else if (
      score >=
      this.config.highRiskScore
    ) {
      level =
        RISK_LEVEL.HIGH;
    } else if (
      score >=
      this.config.mediumRiskScore
    ) {
      level =
        RISK_LEVEL.MEDIUM;
    }

    return {
      score,
      level,
      factors,

      requiresReview:
        level !== RISK_LEVEL.LOW,
    };
  }

  /**
   * ==========================================================================
   * Metrics
   * ==========================================================================
   */

  async getMetrics(
    options = {}
  ) {
    const baseQuery =
      options.tenantId
        ? {
            tenantId:
              options.tenantId,
          }
        : {};

    const [
      alerts,
      openAlerts,
      closedAlerts,
      cases,
      openCases,
      closedCases,
    ] = await Promise.all([
      this.db.amlAlerts.count(
        baseQuery
      ),

      this.db.amlAlerts.count({
        ...baseQuery,
        status: {
          $in: [
            AML_ALERT_STATUS.OPEN,
            AML_ALERT_STATUS.INVESTIGATING,
            AML_ALERT_STATUS.ESCALATED,
          ],
        },
      }),

      this.db.amlAlerts.count({
        ...baseQuery,
        status:
          AML_ALERT_STATUS.CLOSED,
      }),

      this.db.amlCases.count(
        baseQuery
      ),

      this.db.amlCases.count({
        ...baseQuery,
        status: {
          $in: [
            AML_CASE_STATUS.OPEN,
            AML_CASE_STATUS.INVESTIGATING,
            AML_CASE_STATUS.ESCALATED,
          ],
        },
      }),

      this.db.amlCases.count({
        ...baseQuery,
        status:
          AML_CASE_STATUS.CLOSED,
      }),
    ]);

    return {
      alerts,
      openAlerts,
      closedAlerts,

      cases,
      openCases,
      closedCases,

      generatedAt:
        new Date(),

      tenantId:
        options.tenantId || null,
    };
  }

  /**
   * ==========================================================================
   * Audit
   * ==========================================================================
   */

  async audit(
    tenantId,
    customerId,
    action,
    payload = {},
    options = {}
  ) {
    if (!this.auditService) {
      if (
        options.critical &&
        this.config
          .failClosedOnCriticalAuditError
      ) {
        throw new AMLServiceError(
          'Critical AML audit service is unavailable.',
          'AML_AUDIT_UNAVAILABLE'
        );
      }

      return;
    }

    const auditPayload = {
      tenantId,
      customerId,

      action,

      payload,

      timestamp:
        new Date(),

      source:
        'AMLService',

      category:
        'AML',

      correlationId:
        payload.correlationId ||
        this._createCorrelationId(),
    };

    try {
      await this.auditService.log(
        auditPayload
      );

      await this._incrementMetric(
        'aml.audit.success'
      );
    } catch (error) {
      await this._incrementMetric(
        'aml.audit.failed'
      );

      this._logError(
        'AML audit failed',
        error,
        {
          tenantId,
          customerId,
          action,
          critical:
            Boolean(options.critical),
        }
      );

      if (
        options.critical &&
        this.config
          .failClosedOnCriticalAuditError
      ) {
        throw new AMLServiceError(
          'Critical AML audit operation failed.',
          'AML_AUDIT_FAILURE',
          {
            action,
            cause:
              error.message,
          }
        );
      }
    }
  }

  /**
   * ==========================================================================
   * Database Helpers
   * ==========================================================================
   */

  async _findCustomer(
    tenantId,
    customerId
  ) {
    const query =
      this._tenantQuery(
        tenantId,
        {
          $or: [
            {
              id: customerId,
            },
            {
              _id: customerId,
            },
          ],
        }
      );

    if (
      typeof this.db.customers.findOne ===
      'function'
    ) {
      return this.db.customers.findOne(
        query
      );
    }

    /*
     * Backward-compatible fallback.
     */
    const customer =
      await this.db.customers.findById(
        customerId
      );

    if (
      customer &&
      String(customer.tenantId) ===
        String(tenantId)
    ) {
      return customer;
    }

    return null;
  }

  async _findTransactions(
    query,
    limit
  ) {
    if (
      !this.db.transactions ||
      typeof this.db.transactions.find !==
        'function'
    ) {
      throw new AMLServiceError(
        'Transaction repository is unavailable.',
        'AML_TRANSACTION_REPOSITORY_UNAVAILABLE'
      );
    }

    const result =
      await this.db.transactions.find(
        query
      );

    if (
      Array.isArray(result) &&
      Number.isFinite(limit)
    ) {
      return result.slice(
        0,
        limit
      );
    }

    return result || [];
  }

  async _countTransactions(
    query
  ) {
    if (
      !this.db.transactions ||
      typeof this.db.transactions.count !==
        'function'
    ) {
      throw new AMLServiceError(
        'Transaction repository is unavailable.',
        'AML_TRANSACTION_REPOSITORY_UNAVAILABLE'
      );
    }

    return this.db.transactions.count(
      query
    );
  }

  async _findExistingAlert(
    tenantId,
    fingerprint
  ) {
    if (
      !this.db.amlAlerts
    ) {
      throw new AMLServiceError(
        'AML alert repository is unavailable.',
        'AML_ALERT_REPOSITORY_UNAVAILABLE'
      );
    }

    if (
      typeof this.db.amlAlerts.findOne ===
      'function'
    ) {
      return this.db.amlAlerts.findOne({
        tenantId,
        fingerprint,

        status: {
          $nin: [
            AML_ALERT_STATUS.CLOSED,
            AML_ALERT_STATUS.RESOLVED,
          ],
        },
      });
    }

    return null;
  }

  async _findCaseByAlertId(
    tenantId,
    alertId
  ) {
    if (
      !this.db.amlCases ||
      typeof this.db.amlCases.findOne !==
        'function'
    ) {
      return null;
    }

    return this.db.amlCases.findOne({
      tenantId,
      alertId,
    });
  }

  async _updateAlertStatus(
    alert,
    status
  ) {
    const alertId =
      alert.id ||
      alert._id;

    const update = {
      status,
      updatedAt:
        new Date(),
    };

    if (
      typeof this.db.amlAlerts.update ===
      'function'
    ) {
      await this.db.amlAlerts.update(
        alertId,
        {
          ...alert,
          ...update,
        }
      );

      return;
    }

    if (
      typeof this.db.amlAlerts.updateOne ===
      'function'
    ) {
      await this.db.amlAlerts.updateOne(
        {
          tenantId:
            alert.tenantId,

          $or: [
            {
              id: alertId,
            },
            {
              _id: alertId,
            },
          ],
        },
        {
          $set: update,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Cache Helpers
   * ==========================================================================
   */

  async _cacheGet(
    key
  ) {
    try {
      const value =
        await this.cache.get(
          key
        );

      if (
        typeof value === 'string'
      ) {
        try {
          return JSON.parse(
            value
          );
        } catch {
          return value;
        }
      }

      return value;
    } catch (error) {
      await this._incrementMetric(
        'aml.cache.get_failed'
      );

      this._logError(
        'AML cache read failed',
        error,
        {
          key,
        }
      );

      return null;
    }
  }

  async _cacheSet(
    key,
    value,
    ttl
  ) {
    try {
      /*
       * Supports the existing cache API:
       * cache.set(key, value, ttl)
       */
      await this.cache.set(
        key,
        value,
        ttl
      );
    } catch (error) {
      await this._incrementMetric(
        'aml.cache.set_failed'
      );

      this._logError(
        'AML cache write failed',
        error,
        {
          key,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Query / Tenant Isolation
   * ==========================================================================
   */

  _tenantQuery(
    tenantId,
    query = {}
  ) {
    if (!tenantId) {
      throw new AMLServiceError(
        'Tenant context is required for AML database operations.',
        'AML_TENANT_REQUIRED'
      );
    }

    return {
      tenantId,
      ...query,
    };
  }

  /**
   * ==========================================================================
   * Cache Key
   * ==========================================================================
   */

  _buildScreeningCacheKey(
    tenantId,
    identity
  ) {
    const normalized =
      this._normalizeIdentity(
        identity
      );

    const digest =
      crypto
        .createHash('sha256')
        .update(
          JSON.stringify({
            tenantId:
              tenantId || 'global',
            identity:
              normalized,
          })
        )
        .digest('hex');

    return [
      this.config.cachePrefix,
      'screening',
      digest,
    ].join(':');
  }

  /**
   * ==========================================================================
   * Alert Fingerprint
   * ==========================================================================
   */

  _buildAlertFingerprint({
    tenantId,
    customerId,
    transactionId,
    findings,
  }) {
    const normalizedFindings =
      [...new Set(findings)]
        .sort();

    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          tenantId,
          customerId,
          transactionId,
          findings:
            normalizedFindings,
        })
      )
      .digest('hex');
  }

  /**
   * ==========================================================================
   * Regulatory Report Idempotency
   * ==========================================================================
   */

  _buildReportIdempotencyKey(
    reportType,
    amlCase
  ) {
    return crypto
      .createHash('sha256')
      .update(
        JSON.stringify({
          reportType,

          tenantId:
            amlCase.tenantId,

          caseId:
            amlCase.id ||
            amlCase._id,

          alertId:
            amlCase.alertId,

          findings:
            amlCase.findings || [],
        })
      )
      .digest('hex');
  }

  /**
   * ==========================================================================
   * Identity Normalization
   * ==========================================================================
   */

  _normalizeIdentity(
    identity
  ) {
    return {
      idNumber:
        this._normalizeString(
          identity.idNumber
        ),

      documentNumber:
        this._normalizeString(
          identity.documentNumber
        ),

      idType:
        this._normalizeString(
          identity.idType
        ),

      country:
        this._normalizeString(
          identity.country
        ),

      nationality:
        this._normalizeString(
          identity.nationality
        ),

      dateOfBirth:
        identity.dateOfBirth
          ? String(
              identity.dateOfBirth
            )
          : null,
    };
  }

  _buildIdentityReference(
    identity
  ) {
    /*
     * Do not return raw identity documents from screening results.
     */
    const normalized =
      this._normalizeIdentity(
        identity
      );

    const reference =
      normalized.idNumber ||
      normalized.documentNumber;

    return reference
      ? crypto
          .createHash('sha256')
          .update(reference)
          .digest('hex')
      : null;
  }

  /**
   * ==========================================================================
   * Transaction Snapshot
   * ==========================================================================
   */

  _buildTransactionSnapshot(
    transaction
  ) {
    return {
      id:
        transaction.id ||
        transaction._id,

      tenantId:
        transaction.tenantId,

      customerId:
        transaction.customerId,

      amount:
        this._getTransactionAmount(
          transaction
        ),

      currency:
        transaction.currency ||
        null,

      type:
        transaction.type ||
        null,

      status:
        transaction.status ||
        null,

      channel:
        transaction.channel ||
        null,

      createdAt:
        transaction.createdAt ||
        null,
    };
  }

  /**
   * ==========================================================================
   * Evidence Sanitization
   * ==========================================================================
   */

  _sanitizeEvidence(
    evidence
  ) {
    if (!Array.isArray(evidence)) {
      return [];
    }

    return evidence
      .slice(0, 100)
      .map((item) => {
        if (
          item === null ||
          item === undefined
        ) {
          return null;
        }

        if (
          typeof item === 'object'
        ) {
          try {
            return JSON.parse(
              JSON.stringify(item)
            );
          } catch {
            return {
              value:
                String(item),
            };
          }
        }

        return {
          value:
            String(item),
        };
      })
      .filter(Boolean);
  }

  /**
   * ==========================================================================
   * Resolution Sanitization
   * ==========================================================================
   */

  _sanitizeResolution(
    resolution
  ) {
    if (
      typeof resolution !==
      'object' ||
      resolution === null
    ) {
      throw new AMLServiceError(
        'Resolution must be an object.',
        'AML_INVALID_RESOLUTION'
      );
    }

    const allowedFields = [
      'code',
      'reason',
      'summary',
      'action',
      'notes',
      'confirmedSuspicion',
      'regulatoryReportRequired',
    ];

    const sanitized = {};

    for (
      const field of allowedFields
    ) {
      if (
        Object.prototype.hasOwnProperty.call(
          resolution,
          field
        )
      ) {
        sanitized[field] =
          resolution[field];
      }
    }

    if (
      !sanitized.code &&
      !sanitized.reason
    ) {
      throw new AMLServiceError(
        'AML case resolution requires a code or reason.',
        'AML_INVALID_RESOLUTION'
      );
    }

    return sanitized;
  }

  /**
   * ==========================================================================
   * Alert Priority
   * ==========================================================================
   */

  _calculateAlertPriority({
    severity,
    riskScore,
    findings,
  }) {
    if (
      severity ===
        RISK_LEVEL.CRITICAL ||
      findings.includes(
        FINDING.SANCTIONS_MATCH
      )
    ) {
      return 'critical';
    }

    if (
      severity ===
        RISK_LEVEL.HIGH ||
      riskScore >= 80
    ) {
      return 'high';
    }

    if (
      severity ===
        RISK_LEVEL.MEDIUM ||
      riskScore >= 50
    ) {
      return 'medium';
    }

    return 'low';
  }

  /**
   * ==========================================================================
   * Severity
   * ==========================================================================
   */

  _severityFromRisk(
    score
  ) {
    if (score >= 100) {
      return RISK_LEVEL.CRITICAL;
    }

    if (
      score >=
      this.config.highRiskScore
    ) {
      return RISK_LEVEL.HIGH;
    }

    if (
      score >=
      this.config.mediumRiskScore
    ) {
      return RISK_LEVEL.MEDIUM;
    }

    return RISK_LEVEL.LOW;
  }

  /**
   * ==========================================================================
   * Amount Handling
   * ==========================================================================
   *
   * Existing system compatibility:
   *   transaction.amount
   *
   * Preferred future representation:
   *   transaction.amountMinorUnits
   *
   * The service does not mutate financial records.
   */

  _getTransactionAmount(
    transaction
  ) {
    const raw =
      transaction.amountMinorUnits !==
      undefined
        ? transaction.amountMinorUnits
        : transaction.amount;

    const amount =
      Number(raw);

    if (
      !Number.isFinite(amount) ||
      amount < 0
    ) {
      throw new AMLServiceError(
        'Transaction amount must be a valid non-negative number.',
        'AML_INVALID_TRANSACTION_AMOUNT'
      );
    }

    return amount;
  }

  /**
   * ==========================================================================
   * Validation
   * ==========================================================================
   */

  _assertIdentity(
    identity
  ) {
    if (
      !identity ||
      typeof identity !==
        'object'
    ) {
      throw new AMLServiceError(
        'Customer identity is required.',
        'AML_IDENTITY_REQUIRED'
      );
    }

    if (
      !identity.idNumber &&
      !identity.documentNumber &&
      !identity.customerId &&
      !identity.id
    ) {
      throw new AMLServiceError(
        'Customer identity requires an identifying reference.',
        'AML_IDENTITY_REFERENCE_REQUIRED'
      );
    }
  }

  _assertTransaction(
    transaction
  ) {
    if (
      !transaction ||
      typeof transaction !==
        'object'
    ) {
      throw new AMLServiceError(
        'Transaction is required.',
        'AML_TRANSACTION_REQUIRED'
      );
    }

    if (
      !transaction.tenantId
    ) {
      throw new AMLServiceError(
        'Transaction tenantId is required.',
        'AML_TENANT_REQUIRED'
      );
    }

    this._getTransactionAmount(
      transaction
    );
  }

  /**
   * ==========================================================================
   * Score Utilities
   * ==========================================================================
   */

  _clampScore(
    score
  ) {
    return Math.max(
      0,
      Math.min(
        100,
        Number(score) || 0
      )
    );
  }

  /**
   * ==========================================================================
   * Correlation IDs
   * ==========================================================================
   */

  _createCorrelationId() {
    return crypto.randomUUID();
  }

  /**
   * ==========================================================================
   * String Normalization
   * ==========================================================================
   */

  _normalizeString(
    value
  ) {
    if (
      value === null ||
      value === undefined
    ) {
      return null;
    }

    return String(value)
      .trim()
      .toUpperCase();
  }

  /**
   * ==========================================================================
   * Metrics Adapter
   * ==========================================================================
   */

  async _incrementMetric(
    name,
    value = 1,
    labels = {}
  ) {
    if (!this.metricsService) {
      return;
    }

    try {
      if (
        typeof this.metricsService
          .increment ===
        'function'
      ) {
        await this.metricsService.increment(
          name,
          value,
          labels
        );

        return;
      }

      if (
        typeof this.metricsService
          .inc ===
        'function'
      ) {
        await this.metricsService.inc(
          name,
          value,
          labels
        );

        return;
      }

      if (
        typeof this.metricsService
          .counter ===
        'function'
      ) {
        await this.metricsService.counter(
          name,
          value,
          labels
        );
      }
    } catch (error) {
      /*
       * Observability must never break AML processing.
       */
      this._logError(
        'AML metrics operation failed',
        error,
        {
          metric: name,
        }
      );
    }
  }

  /**
   * ==========================================================================
   * Logging Adapter
   * ==========================================================================
   */

  _logError(
    message,
    error,
    context = {}
  ) {
    if (!this.logger) {
      return;
    }

    try {
      const payload = {
        ...context,

        error: {
          name:
            error?.name,
          code:
            error?.code,
          message:
            error?.message,
          stack:
            error?.stack,
        },
      };

      if (
        typeof this.logger.error ===
        'function'
      ) {
        this.logger.error(
          message,
          payload
        );
      }
    } catch {
      /*
       * Logging must never become an AML failure source.
       */
    }
  }
}

/**
 * ============================================================================
 * Exports
 * ============================================================================
 */

AMLService.AMLServiceError =
  AMLServiceError;

AMLService.AML_ALERT_STATUS =
  AML_ALERT_STATUS;

AMLService.AML_CASE_STATUS =
  AML_CASE_STATUS;

AMLService.RISK_LEVEL =
  RISK_LEVEL;

AMLService.FINDING =
  FINDING;

module.exports = AMLService;