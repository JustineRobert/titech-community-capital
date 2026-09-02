'use strict';

/**
 * ============================================================================
 * TITech Community Capital
 * Stage 01d SaaS Billing Telemetry Service
 * ============================================================================
 *
 * File:
 * backend/services/commercial/stage01dTelemetryService.js
 *
 * Stage:
 * Commercial Consolidation — Stage 01d
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Canonical telemetry boundary for controlled SaaS billing shadow execution.
 *
 * This service measures the behavior of the shadow billing path against the
 * authoritative legacy billing path without becoming an authoritative billing
 * component itself.
 *
 * RESPONSIBILITY
 * ----------------------------------------------------------------------------
 *
 * This service provides:
 *
 *   - execution counts
 *   - success/failure counts
 *   - exact-match rate
 *   - tolerance-match rate
 *   - divergence rate
 *   - execution-failure rate
 *   - monetary divergence exposure
 *   - high/critical divergence counts
 *   - tenant-level parity
 *   - plan-level parity
 *   - operation-level parity
 *   - observation-window statistics
 *   - cut-over readiness inputs
 *
 * NON-RESPONSIBILITIES
 * ----------------------------------------------------------------------------
 *
 * This service NEVER:
 *
 *   - calculates authoritative customer billing
 *   - posts invoices
 *   - posts ledger entries
 *   - captures payments
 *   - changes subscriptions
 *   - changes tenant billing configuration
 *   - switches billing engines
 *   - authorizes a cut-over
 *   - modifies the legacy billing path
 *
 * The legacy billing path remains authoritative until a separate,
 * explicitly-controlled cut-over mechanism determines otherwise.
 *
 * ARCHITECTURE
 * ----------------------------------------------------------------------------
 *
 *   Shadow Read Service
 *           │
 *           │ execution observations
 *           ▼
 *   Reconciliation Service
 *           │
 *           │ classified reconciliation
 *           ▼
 *   Stage 01d Telemetry Service
 *           │
 *           ▼
 *   Reconciliation Repository
 *           │
 *           ▼
 *        MongoDB
 *
 * ============================================================================
 */

const {
  DIVERGENCE_STATUSES,
  MATCH_STATUSES,
} = require(
  '../../repositories/commercial/saasBillingReconciliation.repository',
);

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SERVICE_NAME =
  'titech-stage01d-telemetry-service';

const SERVICE_VERSION =
  '1.0.0';

const STAGE =
  '01d';

const MODE =
  'shadow';

const DEFAULT_WINDOW_HOURS = 24;

const DEFAULT_MIN_OBSERVATIONS = 100;

const DEFAULT_DIVERGENCE_THRESHOLD_BPS = 100;

const DEFAULT_FAILURE_THRESHOLD_BPS = 50;

const DEFAULT_TOLERANCE_MATCH_THRESHOLD_BPS = 9900;

const DEFAULT_EXACT_MATCH_THRESHOLD_BPS = 9900;

const DEFAULT_HIGH_SEVERITY_THRESHOLD = 0;

const DEFAULT_PAGE = 1;

const DEFAULT_LIMIT = 100;

const MAX_LIMIT = 500;

const ZERO_BPS = 0;

const BPS_DENOMINATOR = 10000;

/**
 * ============================================================================
 * ENUMERATIONS
 * ============================================================================
 */

const EXECUTION_OUTCOMES = Object.freeze({
  SUCCESS: 'success',
  FAILURE: 'failure',
});

const PARITY_LEVELS = Object.freeze({
  EXACT: 'exact',
  TOLERANCE: 'tolerance',
  DIVERGENCE: 'divergence',
  FAILURE: 'failure',
  INCONCLUSIVE: 'inconclusive',
});

const READINESS_STATUSES = Object.freeze({
  INSUFFICIENT_DATA: 'insufficient_data',
  NOT_READY: 'not_ready',
  READY_FOR_REVIEW: 'ready_for_review',
  BLOCKED: 'blocked',
});

const SEVERITIES = Object.freeze({
  LOW: 'low',
  MEDIUM: 'medium',
  HIGH: 'high',
  CRITICAL: 'critical',
});

/**
 * ============================================================================
 * ERROR
 * ============================================================================
 */

class Stage01dTelemetryError extends Error {
  constructor(
    message,
    code = 'STAGE01D_TELEMETRY_ERROR',
    details = undefined,
  ) {
    super(message);

    this.name =
      'Stage01dTelemetryError';

    this.code = code;
    this.details = details;

    Error.captureStackTrace?.(
      this,
      Stage01dTelemetryError,
    );
  }
}

/**
 * ============================================================================
 * NUMERIC HELPERS
 * ============================================================================
 *
 * Financial values may arrive as:
 *
 *   - Number
 *   - String
 *   - Decimal128
 *   - objects exposing toString()
 *
 * Telemetry must never throw merely because a Decimal128 value is returned
 * from MongoDB.
 */

function toFiniteNumber(
  value,
  fallback = 0,
) {
  if (
    value === undefined ||
    value === null ||
    value === ''
  ) {
    return fallback;
  }

  const number =
    typeof value === 'number'
      ? value
      : Number(
          typeof value.toString === 'function'
            ? value.toString()
            : value,
        );

  return Number.isFinite(number)
    ? number
    : fallback;
}

function absoluteNumber(value) {
  return Math.abs(
    toFiniteNumber(value),
  );
}

function round(value, decimals = 6) {
  const multiplier =
    10 ** decimals;

  return (
    Math.round(
      toFiniteNumber(value) *
        multiplier,
    ) / multiplier
  );
}

function ratioToBps(
  numerator,
  denominator,
) {
  const n =
    toFiniteNumber(numerator);

  const d =
    toFiniteNumber(denominator);

  if (d <= 0) {
    return 0;
  }

  return round(
    (n / d) *
      BPS_DENOMINATOR,
    4,
  );
}

function ratioToPercentage(
  numerator,
  denominator,
) {
  const n =
    toFiniteNumber(numerator);

  const d =
    toFiniteNumber(denominator);

  if (d <= 0) {
    return 0;
  }

  return round(
    (n / d) * 100,
    6,
  );
}

function clampBps(value) {
  return Math.min(
    BPS_DENOMINATOR,
    Math.max(
      ZERO_BPS,
      toFiniteNumber(value),
    ),
  );
}

/**
 * ============================================================================
 * DATE HELPERS
 * ============================================================================
 */

function normalizeDate(
  value,
  fieldName,
) {
  if (
    value === undefined ||
    value === null
  ) {
    return null;
  }

  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

  if (
    Number.isNaN(
      date.getTime(),
    )
  ) {
    throw new Stage01dTelemetryError(
      `${fieldName} must be a valid date.`,
      'INVALID_DATE',
      {
        fieldName,
        value,
      },
    );
  }

  return date;
}

function createObservationWindow(
  options = {},
) {
  const endDate =
    normalizeDate(
      options.endDate,
      'endDate',
    ) ||
    new Date();

  const startDate =
    normalizeDate(
      options.startDate,
      'startDate',
    ) ||
    new Date(
      endDate.getTime() -
        DEFAULT_WINDOW_HOURS *
          60 *
          60 *
          1000,
    );

  if (
    startDate >= endDate
  ) {
    throw new Stage01dTelemetryError(
      'Observation window startDate must be before endDate.',
      'INVALID_OBSERVATION_WINDOW',
      {
        startDate,
        endDate,
      },
    );
  }

  return {
    startDate,
    endDate,
  };
}

/**
 * ============================================================================
 * COLLECTION HELPERS
 * ============================================================================
 */

function incrementMap(
  map,
  key,
  value = 1,
) {
  const normalizedKey =
    key === undefined ||
    key === null ||
    key === ''
      ? 'unknown'
      : String(key);

  map[normalizedKey] =
    (map[normalizedKey] || 0) +
    value;
}

function mapToArray(
  map,
  keyName = 'key',
) {
  return Object.entries(map)
    .map(
      ([key, count]) => ({
        [keyName]: key,
        count,
      }),
    )
    .sort(
      (a, b) =>
        b.count - a.count,
    );
}

function getPath(
  object,
  path,
  fallback = undefined,
) {
  if (
    !object ||
    !path
  ) {
    return fallback;
  }

  const parts =
    String(path).split('.');

  let current = object;

  for (const part of parts) {
    if (
      current === null ||
      current === undefined
    ) {
      return fallback;
    }

    current =
      current[part];
  }

  return current === undefined
    ? fallback
    : current;
}

/**
 * ============================================================================
 * TELEMETRY SERVICE
 * ============================================================================
 */

class Stage01dTelemetryService {
  /**
   * --------------------------------------------------------------------------
   * Constructor
   * --------------------------------------------------------------------------
   */

  constructor({
    reconciliationRepository,
    logger = null,
    clock = () => new Date(),
    policy = {},
  } = {}) {
    if (
      !reconciliationRepository
    ) {
      throw new Stage01dTelemetryError(
        'reconciliationRepository is required.',
        'REPOSITORY_REQUIRED',
      );
    }

    this.reconciliationRepository =
      reconciliationRepository;

    this.logger = logger;

    this.clock = clock;

    this.policy = {
      minObservations:
        toFiniteNumber(
          policy.minObservations,
          DEFAULT_MIN_OBSERVATIONS,
        ),

      maxDivergenceBps:
        toFiniteNumber(
          policy.maxDivergenceBps,
          DEFAULT_DIVERGENCE_THRESHOLD_BPS,
        ),

      maxFailureBps:
        toFiniteNumber(
          policy.maxFailureBps,
          DEFAULT_FAILURE_THRESHOLD_BPS,
        ),

      minToleranceMatchBps:
        clampBps(
          toFiniteNumber(
            policy.minToleranceMatchBps,
            DEFAULT_TOLERANCE_MATCH_THRESHOLD_BPS,
          ),
        ),

      minExactMatchBps:
        clampBps(
          toFiniteNumber(
            policy.minExactMatchBps,
            DEFAULT_EXACT_MATCH_THRESHOLD_BPS,
          ),
        ),

      maxHighSeverityDivergences:
        toFiniteNumber(
          policy.maxHighSeverityDivergences,
          DEFAULT_HIGH_SEVERITY_THRESHOLD,
        ),
    };
  }

  /**
   * --------------------------------------------------------------------------
   * Logging
   * --------------------------------------------------------------------------
   */

  log(
    level,
    message,
    metadata = {},
  ) {
    try {
      if (
        this.logger &&
        typeof this.logger[level] ===
          'function'
      ) {
        this.logger[level](
          message,
          {
            service:
              SERVICE_NAME,

            version:
              SERVICE_VERSION,

            stage: STAGE,

            mode: MODE,

            ...metadata,
          },
        );
      }
    } catch {
      /**
       * Telemetry logging must never become a source of financial execution
       * failure.
       */
    }
  }

  /**
   * ==========================================================================
   * RECORD EXECUTION OBSERVATION
   * ==========================================================================
   *
   * The reconciliation service normally creates the durable reconciliation
   * record. This method provides the canonical telemetry interpretation of an
   * individual completed observation.
   */

  recordExecutionObservation(
    reconciliation,
  ) {
    if (
      !reconciliation ||
      typeof reconciliation !==
        'object'
    ) {
      throw new Stage01dTelemetryError(
        'A reconciliation observation is required.',
        'RECONCILIATION_REQUIRED',
      );
    }

    const outcome =
      this.resolveExecutionOutcome(
        reconciliation,
      );

    const parity =
      this.resolveParityLevel(
        reconciliation,
      );

    const absoluteDelta =
      this.resolveAbsoluteDelta(
        reconciliation,
      );

    const basisPointDelta =
      this.resolveBasisPointDelta(
        reconciliation,
      );

    const severity =
      this.resolveSeverity(
        reconciliation,
      );

    const metadata = {
      executionId:
        reconciliation.executionId,

      reconciliationKey:
        reconciliation.reconciliationKey,

      tenantId:
        reconciliation.tenantId,

      operation:
        reconciliation.operation,

      planCode:
        getPath(
          reconciliation,
          'context.planCode',
        ),

      currency:
        getPath(
          reconciliation,
          'context.currency',
        ),

      outcome,

      parity,

      severity,

      absoluteDelta,

      basisPointDelta,
    };

    this.log(
      'debug',
      'Recorded Stage 01d execution observation.',
      metadata,
    );

    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      stage: STAGE,

      mode: MODE,

      observedAt:
        this.clock(),

      executionId:
        reconciliation.executionId,

      reconciliationKey:
        reconciliation.reconciliationKey,

      tenantId:
        reconciliation.tenantId,

      operation:
        reconciliation.operation,

      planCode:
        getPath(
          reconciliation,
          'context.planCode',
        ),

      currency:
        getPath(
          reconciliation,
          'context.currency',
        ),

      outcome,

      parity,

      severity,

      exactMatch:
        Boolean(
          reconciliation.exactMatch,
        ),

      withinTolerance:
        Boolean(
          reconciliation.withinTolerance,
        ),

      absoluteDelta,

      basisPointDelta,

      monetaryDivergence:
        absoluteDelta > 0,
    };
  }

  /**
   * ==========================================================================
   * EXECUTION OUTCOME
   * ==========================================================================
   */

  resolveExecutionOutcome(
    reconciliation,
  ) {
    if (
      reconciliation.status ===
        'failed' ||
      reconciliation.status ===
        'inconclusive'
    ) {
      return EXECUTION_OUTCOMES.FAILURE;
    }

    if (
      reconciliation.failure ||
      reconciliation.error ||
      reconciliation.executionFailed ===
        true
    ) {
      return EXECUTION_OUTCOMES.FAILURE;
    }

    return EXECUTION_OUTCOMES.SUCCESS;
  }

  /**
   * ==========================================================================
   * PARITY LEVEL
   * ==========================================================================
   */

  resolveParityLevel(
    reconciliation,
  ) {
    const outcome =
      this.resolveExecutionOutcome(
        reconciliation,
      );

    if (
      outcome ===
      EXECUTION_OUTCOMES.FAILURE
    ) {
      return PARITY_LEVELS.FAILURE;
    }

    if (
      reconciliation.exactMatch ===
      true
    ) {
      return PARITY_LEVELS.EXACT;
    }

    if (
      reconciliation.withinTolerance ===
      true
    ) {
      return PARITY_LEVELS.TOLERANCE;
    }

    if (
      DIVERGENCE_STATUSES.includes(
        reconciliation.status,
      )
    ) {
      return PARITY_LEVELS.DIVERGENCE;
    }

    if (
      reconciliation.status ===
      'inconclusive'
    ) {
      return PARITY_LEVELS.INCONCLUSIVE;
    }

    return PARITY_LEVELS.INCONCLUSIVE;
  }

  /**
   * ==========================================================================
   * DELTA RESOLUTION
   * ==========================================================================
   */

  resolveAbsoluteDelta(
    reconciliation,
  ) {
    const direct =
      getPath(
        reconciliation,
        'absoluteDelta.amount',
      );

    if (
      direct !== undefined &&
      direct !== null
    ) {
      return absoluteNumber(direct);
    }

    if (
      reconciliation.absoluteDelta !==
        undefined &&
      reconciliation.absoluteDelta !==
        null &&
      typeof reconciliation.absoluteDelta !==
        'object'
    ) {
      return absoluteNumber(
        reconciliation.absoluteDelta,
      );
    }

    return Math.abs(
      toFiniteNumber(
        reconciliation.shadowTotal,
      ) -
        toFiniteNumber(
          reconciliation.legacyTotal,
        ),
    );
  }

  resolveBasisPointDelta(
    reconciliation,
  ) {
    if (
      reconciliation.basisPointDelta !==
        undefined
    ) {
      return absoluteNumber(
        reconciliation.basisPointDelta,
      );
    }

    const legacyTotal =
      absoluteNumber(
        reconciliation.legacyTotal,
      );

    const delta =
      this.resolveAbsoluteDelta(
        reconciliation,
      );

    return ratioToBps(
      delta,
      legacyTotal,
    );
  }

  /**
   * ==========================================================================
   * SEVERITY
   * ==========================================================================
   */

  resolveSeverity(
    reconciliation,
  ) {
    if (
      reconciliation.severity
    ) {
      return String(
        reconciliation.severity,
      ).toLowerCase();
    }

    if (
      reconciliation.status ===
        'failed' ||
      reconciliation.status ===
        'inconclusive'
    ) {
      return SEVERITIES.HIGH;
    }

    const bps =
      this.resolveBasisPointDelta(
        reconciliation,
      );

    if (
      bps >=
      this.policy.maxDivergenceBps *
        10
    ) {
      return SEVERITIES.CRITICAL;
    }

    if (
      bps >=
      this.policy.maxDivergenceBps
    ) {
      return SEVERITIES.HIGH;
    }

    if (
      bps > 0
    ) {
      return SEVERITIES.MEDIUM;
    }

    return SEVERITIES.LOW;
  }

  /**
   * ==========================================================================
   * WINDOW TELEMETRY
   * ==========================================================================
   *
   * Retrieves the observation window from the repository and transforms it
   * into the canonical Stage 01d telemetry contract.
   */

  async getObservationWindow(
    tenantId,
    options = {},
  ) {
    const window =
      createObservationWindow(
        options,
      );

    const observations =
      await this.reconciliationRepository
        .findObservationWindow({
          tenantId,

          startDate:
            window.startDate,

          endDate:
            window.endDate,

          operation:
            options.operation,

          planCode:
            options.planCode,

          currency:
            options.currency,

          session:
            options.session,

          limit:
            options.limit ||
            MAX_LIMIT,
        });

    return this.buildWindowMetrics(
      observations,
      {
        tenantId,

        ...window,

        operation:
          options.operation,

        planCode:
          options.planCode,

        currency:
          options.currency,
      },
    );
  }

  /**
   * ==========================================================================
   * BUILD WINDOW METRICS
   * ==========================================================================
   */

  buildWindowMetrics(
    observations = [],
    context = {},
  ) {
    const totals = {
      executions: 0,
      successes: 0,
      failures: 0,

      exactMatches: 0,
      toleranceMatches: 0,
      divergences: 0,
      inconclusive: 0,

      highSeverity: 0,
      criticalSeverity: 0,

      monetaryDivergences: 0,

      absoluteMonetaryExposure: 0,
    };

    const byTenant = {};
    const byPlan = {};
    const byOperation = {};
    const byCurrency = {};
    const byClassification = {};
    const bySeverity = {};

    for (
      const observation of
        observations
    ) {
      totals.executions += 1;

      const outcome =
        this.resolveExecutionOutcome(
          observation,
        );

      const parity =
        this.resolveParityLevel(
          observation,
        );

      const severity =
        this.resolveSeverity(
          observation,
        );

      const absoluteDelta =
        this.resolveAbsoluteDelta(
          observation,
        );

      if (
        outcome ===
        EXECUTION_OUTCOMES.SUCCESS
      ) {
        totals.successes += 1;
      } else {
        totals.failures += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.EXACT
      ) {
        totals.exactMatches += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.TOLERANCE
      ) {
        totals.toleranceMatches += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.DIVERGENCE
      ) {
        totals.divergences += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.INCONCLUSIVE
      ) {
        totals.inconclusive += 1;
      }

      if (
        severity ===
        SEVERITIES.HIGH
      ) {
        totals.highSeverity += 1;
      }

      if (
        severity ===
        SEVERITIES.CRITICAL
      ) {
        totals.criticalSeverity += 1;
      }

      if (
        absoluteDelta > 0
      ) {
        totals.monetaryDivergences += 1;

        totals.absoluteMonetaryExposure +=
          absoluteDelta;
      }

      incrementMap(
        byTenant,
        observation.tenantId,
      );

      incrementMap(
        byPlan,
        getPath(
          observation,
          'context.planCode',
        ),
      );

      incrementMap(
        byOperation,
        observation.operation,
      );

      incrementMap(
        byCurrency,
        getPath(
          observation,
          'context.currency',
        ),
      );

      incrementMap(
        byClassification,
        observation.classification,
      );

      incrementMap(
        bySeverity,
        severity,
      );
    }

    const executionCount =
      totals.executions;

    const successRateBps =
      ratioToBps(
        totals.successes,
        executionCount,
      );

    const failureRateBps =
      ratioToBps(
        totals.failures,
        executionCount,
      );

    const exactMatchRateBps =
      ratioToBps(
        totals.exactMatches,
        executionCount,
      );

    const toleranceMatchRateBps =
      ratioToBps(
        totals.toleranceMatches,
        executionCount,
      );

    const parityMatchRateBps =
      ratioToBps(
        totals.exactMatches +
          totals.toleranceMatches,
        executionCount,
      );

    const divergenceRateBps =
      ratioToBps(
        totals.divergences,
        executionCount,
      );

    const inconclusiveRateBps =
      ratioToBps(
        totals.inconclusive,
        executionCount,
      );

    const readiness =
      this.evaluateCutoverReadiness(
        {
          executions:
            executionCount,

          successRateBps,

          failureRateBps,

          exactMatchRateBps,

          toleranceMatchRateBps,

          parityMatchRateBps,

          divergenceRateBps,

          highSeverity:
            totals.highSeverity,

          criticalSeverity:
            totals.criticalSeverity,
        },
      );

    return {
      schemaVersion:
        'stage01d.telemetry.v1',

      service:
        SERVICE_NAME,

      serviceVersion:
        SERVICE_VERSION,

      stage: STAGE,

      mode: MODE,

      generatedAt:
        this.clock(),

      tenantId:
        context.tenantId,

      window: {
        startDate:
          context.startDate,

        endDate:
          context.endDate,
      },

      filters: {
        operation:
          context.operation ||
          null,

        planCode:
          context.planCode ||
          null,

        currency:
          context.currency ||
          null,
      },

      totals,

      rates: {
        successRateBps,

        successRatePercentage:
          ratioToPercentage(
            totals.successes,
            executionCount,
          ),

        failureRateBps,

        failureRatePercentage:
          ratioToPercentage(
            totals.failures,
            executionCount,
          ),

        exactMatchRateBps,

        exactMatchRatePercentage:
          ratioToPercentage(
            totals.exactMatches,
            executionCount,
          ),

        toleranceMatchRateBps,

        toleranceMatchRatePercentage:
          ratioToPercentage(
            totals.toleranceMatches,
            executionCount,
          ),

        parityMatchRateBps,

        parityMatchRatePercentage:
          ratioToPercentage(
            totals.exactMatches +
              totals.toleranceMatches,
            executionCount,
          ),

        divergenceRateBps,

        divergenceRatePercentage:
          ratioToPercentage(
            totals.divergences,
            executionCount,
          ),

        inconclusiveRateBps,

        inconclusiveRatePercentage:
          ratioToPercentage(
            totals.inconclusive,
            executionCount,
          ),
      },

      monetary: {
        divergentObservations:
          totals.monetaryDivergences,

        absoluteExposure:
          round(
            totals.absoluteMonetaryExposure,
            6,
          ),
      },

      distributions: {
        tenants:
          mapToArray(
            byTenant,
            'tenantId',
          ),

        plans:
          mapToArray(
            byPlan,
            'planCode',
          ),

        operations:
          mapToArray(
            byOperation,
            'operation',
          ),

        currencies:
          mapToArray(
            byCurrency,
            'currency',
          ),

        classifications:
          mapToArray(
            byClassification,
            'classification',
          ),

        severities:
          mapToArray(
            bySeverity,
            'severity',
          ),
      },

      readiness,
    };
  }

  /**
   * ==========================================================================
   * REPOSITORY AGGREGATE TELEMETRY
   * ==========================================================================
   *
   * Uses MongoDB aggregation primitives when a caller needs the complete
   * observation population rather than a capped result set.
   */

  async getAggregatedObservationMetrics(
    tenantId,
    options = {},
  ) {
    const window =
      createObservationWindow(
        options,
      );

    const raw =
      await this.reconciliationRepository
        .aggregateObservationMetrics({
          tenantId,

          startDate:
            window.startDate,

          endDate:
            window.endDate,

          operation:
            options.operation,

          planCode:
            options.planCode,

          currency:
            options.currency,

          session:
            options.session,
        });

    return this.normalizeRepositoryAggregate(
      raw,
      {
        tenantId,

        ...window,

        operation:
          options.operation,

        planCode:
          options.planCode,

        currency:
          options.currency,
      },
    );
  }

  /**
   * ==========================================================================
   * NORMALIZE REPOSITORY AGGREGATE
   * ==========================================================================
   */

  normalizeRepositoryAggregate(
    raw = {},
    context = {},
  ) {
    const totalExecutions =
      toFiniteNumber(
        raw?.totals?.[0]?.count,
      );

    const statusCounts =
      this.arrayToCountMap(
        raw.byStatus,
      );

    const classificationCounts =
      this.arrayToCountMap(
        raw.byClassification,
      );

    const severityCounts =
      this.arrayToCountMap(
        raw.bySeverity,
      );

    const operationCounts =
      this.arrayToCountMap(
        raw.byOperation,
      );

    const tolerance =
      raw?.tolerance?.[0] || {};

    const exactMatches =
      toFiniteNumber(
        tolerance.exactMatches,
      );

    const withinTolerance =
      toFiniteNumber(
        tolerance.withinTolerance,
      );

    const outsideTolerance =
      toFiniteNumber(
        tolerance.outsideTolerance,
      );

    const failures =
      this.sumStatuses(
        statusCounts,
        ['failed', 'inconclusive'],
      );

    const divergences =
      this.sumStatuses(
        statusCounts,
        ['diverged'],
      );

    const successes =
      Math.max(
        0,
        totalExecutions -
          failures,
      );

    const highSeverity =
      toFiniteNumber(
        severityCounts.high,
      );

    const criticalSeverity =
      toFiniteNumber(
        severityCounts.critical,
      );

    const monetaryExposure =
      (raw?.monetaryExposure || [])
        .map(
          item => ({
            currency:
              item._id || null,

            absoluteExposure:
              toFiniteNumber(
                item.totalAbsoluteDelta,
              ),
          }),
        );

    const metrics = {
      schemaVersion:
        'stage01d.telemetry.v1',

      service:
        SERVICE_NAME,

      serviceVersion:
        SERVICE_VERSION,

      stage: STAGE,

      mode: MODE,

      generatedAt:
        this.clock(),

      tenantId:
        context.tenantId,

      window: {
        startDate:
          context.startDate,

        endDate:
          context.endDate,
      },

      filters: {
        operation:
          context.operation ||
          null,

        planCode:
          context.planCode ||
          null,

        currency:
          context.currency ||
          null,
      },

      totals: {
        executions:
          totalExecutions,

        successes,

        failures,

        exactMatches,

        toleranceMatches:
          Math.max(
            0,
            withinTolerance -
              exactMatches,
          ),

        divergences,

        inconclusive:
          toFiniteNumber(
            statusCounts.inconclusive,
          ),

        highSeverity,

        criticalSeverity,

        monetaryDivergences:
          monetaryExposure.length,

        absoluteMonetaryExposure:
          monetaryExposure.reduce(
            (
              total,
              item,
            ) =>
              total +
              item.absoluteExposure,
            0,
          ),
      },

      rates: {
        successRateBps:
          ratioToBps(
            successes,
            totalExecutions,
          ),

        failureRateBps:
          ratioToBps(
            failures,
            totalExecutions,
          ),

        exactMatchRateBps:
          ratioToBps(
            exactMatches,
            totalExecutions,
          ),

        toleranceMatchRateBps:
          ratioToBps(
            Math.max(
              0,
              withinTolerance -
                exactMatches,
            ),
            totalExecutions,
          ),

        parityMatchRateBps:
          ratioToBps(
            withinTolerance,
            totalExecutions,
          ),

        divergenceRateBps:
          ratioToBps(
            divergences,
            totalExecutions,
          ),

        inconclusiveRateBps:
          ratioToBps(
            statusCounts.inconclusive,
            totalExecutions,
          ),
      },

      byStatus:
        statusCounts,

      byClassification:
        classificationCounts,

      bySeverity:
        severityCounts,

      byOperation:
        operationCounts,

      monetary:
        monetaryExposure,

      readiness:
        this.evaluateCutoverReadiness({
          executions:
            totalExecutions,

          successRateBps:
            ratioToBps(
              successes,
              totalExecutions,
            ),

          failureRateBps:
            ratioToBps(
              failures,
              totalExecutions,
            ),

          exactMatchRateBps:
            ratioToBps(
              exactMatches,
              totalExecutions,
            ),

          toleranceMatchRateBps:
            ratioToBps(
              withinTolerance,
              totalExecutions,
            ),

          parityMatchRateBps:
            ratioToBps(
              withinTolerance,
              totalExecutions,
            ),

          divergenceRateBps:
            ratioToBps(
              divergences,
              totalExecutions,
            ),

          highSeverity,

          criticalSeverity,
        }),
    };

    return metrics;
  }

  /**
   * ==========================================================================
   * COUNT MAP
   * ==========================================================================
   */

  arrayToCountMap(
    array = [],
  ) {
    const map = {};

    for (
      const item of array || []
    ) {
      const key =
        item?._id === undefined ||
        item?._id === null
          ? 'unknown'
          : String(item._id);

      map[key] =
        toFiniteNumber(
          item.count,
        );
    }

    return map;
  }

  /**
   * ==========================================================================
   * SUM STATUSES
   * ==========================================================================
   */

  sumStatuses(
    counts,
    statuses,
  ) {
    return statuses.reduce(
      (
        total,
        status,
      ) =>
        total +
        toFiniteNumber(
          counts?.[status],
        ),
      0,
    );
  }

  /**
   * ==========================================================================
   * TENANT PARITY
   * ==========================================================================
   *
   * Returns one telemetry object per tenant represented in the observation
   * window.
   */

  async getTenantParity(
    tenantId,
    options = {},
  ) {
    const window =
      createObservationWindow(
        options,
      );

    const observations =
      await this.reconciliationRepository
        .findObservationWindow({
          tenantId,

          startDate:
            window.startDate,

          endDate:
            window.endDate,

          operation:
            options.operation,

          planCode:
            options.planCode,

          currency:
            options.currency,

          session:
            options.session,

          limit:
            options.limit ||
            MAX_LIMIT,
        });

    return this.buildDimensionParity(
      observations,
      'tenantId',
    );
  }

  /**
   * ==========================================================================
   * PLAN PARITY
   * ==========================================================================
   */

  async getPlanParity(
    tenantId,
    options = {},
  ) {
    const window =
      createObservationWindow(
        options,
      );

    const observations =
      await this.reconciliationRepository
        .findObservationWindow({
          tenantId,

          startDate:
            window.startDate,

          endDate:
            window.endDate,

          operation:
            options.operation,

          planCode:
            options.planCode,

          currency:
            options.currency,

          session:
            options.session,

          limit:
            options.limit ||
            MAX_LIMIT,
        });

    return this.buildDimensionParity(
      observations,
      'planCode',
    );
  }

  /**
   * ==========================================================================
   * OPERATION PARITY
   * ==========================================================================
   */

  async getOperationParity(
    tenantId,
    options = {},
  ) {
    const window =
      createObservationWindow(
        options,
      );

    const observations =
      await this.reconciliationRepository
        .findObservationWindow({
          tenantId,

          startDate:
            window.startDate,

          endDate:
            window.endDate,

          operation:
            options.operation,

          planCode:
            options.planCode,

          currency:
            options.currency,

          session:
            options.session,

          limit:
            options.limit ||
            MAX_LIMIT,
        });

    return this.buildDimensionParity(
      observations,
      'operation',
    );
  }

  /**
   * ==========================================================================
   * GENERIC DIMENSION PARITY
   * ==========================================================================
   */

  buildDimensionParity(
    observations = [],
    dimension,
  ) {
    const buckets = {};

    for (
      const observation of
        observations
    ) {
      let key;

      switch (dimension) {
        case 'tenantId':
          key =
            observation.tenantId;
          break;

        case 'planCode':
          key =
            getPath(
              observation,
              'context.planCode',
            );
          break;

        case 'operation':
          key =
            observation.operation;
          break;

        default:
          throw new Stage01dTelemetryError(
            `Unsupported parity dimension: ${dimension}.`,
            'UNSUPPORTED_PARITY_DIMENSION',
            {
              dimension,
            },
          );
      }

      key =
        key === undefined ||
        key === null ||
        key === ''
          ? 'unknown'
          : String(key);

      if (!buckets[key]) {
        buckets[key] = {
          key,

          executions: 0,

          successes: 0,

          failures: 0,

          exactMatches: 0,

          toleranceMatches: 0,

          divergences: 0,

          inconclusive: 0,

          highSeverity: 0,

          criticalSeverity: 0,

          absoluteMonetaryExposure: 0,
        };
      }

      const bucket =
        buckets[key];

      const outcome =
        this.resolveExecutionOutcome(
          observation,
        );

      const parity =
        this.resolveParityLevel(
          observation,
        );

      const severity =
        this.resolveSeverity(
          observation,
        );

      bucket.executions += 1;

      if (
        outcome ===
        EXECUTION_OUTCOMES.SUCCESS
      ) {
        bucket.successes += 1;
      } else {
        bucket.failures += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.EXACT
      ) {
        bucket.exactMatches += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.TOLERANCE
      ) {
        bucket.toleranceMatches += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.DIVERGENCE
      ) {
        bucket.divergences += 1;
      }

      if (
        parity ===
        PARITY_LEVELS.INCONCLUSIVE
      ) {
        bucket.inconclusive += 1;
      }

      if (
        severity ===
        SEVERITIES.HIGH
      ) {
        bucket.highSeverity += 1;
      }

      if (
        severity ===
        SEVERITIES.CRITICAL
      ) {
        bucket.criticalSeverity += 1;
      }

      bucket.absoluteMonetaryExposure +=
        this.resolveAbsoluteDelta(
          observation,
        );
    }

    return Object.values(
      buckets,
    )
      .map(bucket => ({
        ...bucket,

        successRateBps:
          ratioToBps(
            bucket.successes,
            bucket.executions,
          ),

        failureRateBps:
          ratioToBps(
            bucket.failures,
            bucket.executions,
          ),

        exactMatchRateBps:
          ratioToBps(
            bucket.exactMatches,
            bucket.executions,
          ),

        toleranceMatchRateBps:
          ratioToBps(
            bucket.toleranceMatches,
            bucket.executions,
          ),

        parityMatchRateBps:
          ratioToBps(
            bucket.exactMatches +
              bucket.toleranceMatches,
            bucket.executions,
          ),

        divergenceRateBps:
          ratioToBps(
            bucket.divergences,
            bucket.executions,
          ),

        readiness:
          this.evaluateCutoverReadiness(
            {
              executions:
                bucket.executions,

              successRateBps:
                ratioToBps(
                  bucket.successes,
                  bucket.executions,
                ),

              failureRateBps:
                ratioToBps(
                  bucket.failures,
                  bucket.executions,
                ),

              exactMatchRateBps:
                ratioToBps(
                  bucket.exactMatches,
                  bucket.executions,
                ),

              toleranceMatchRateBps:
                ratioToBps(
                  bucket.toleranceMatches,
                  bucket.executions,
                ),

              parityMatchRateBps:
                ratioToBps(
                  bucket.exactMatches +
                    bucket.toleranceMatches,
                  bucket.executions,
                ),

              divergenceRateBps:
                ratioToBps(
                  bucket.divergences,
                  bucket.executions,
                ),

              highSeverity:
                bucket.highSeverity,

              criticalSeverity:
                bucket.criticalSeverity,
            },
          ),
      }))
      .sort(
        (a, b) =>
          b.executions -
          a.executions,
      );
  }

  /**
   * ==========================================================================
   * DIVERGENCE TELEMETRY
   * ==========================================================================
   */

  async getDivergenceTelemetry(
    tenantId,
    options = {},
  ) {
    const result =
      await this.reconciliationRepository
        .findDivergences(
          tenantId,
          {
            ...options,

            limit:
              options.limit ||
              MAX_LIMIT,
          },
        );

    const observations =
      result?.documents ||
      [];

    const classificationCounts = {};
    const severityCounts = {};
    const operationCounts = {};
    const planCounts = {};

    let totalExposure = 0;

    for (
      const observation of
        observations
    ) {
      incrementMap(
        classificationCounts,
        observation.classification,
      );

      incrementMap(
        severityCounts,
        this.resolveSeverity(
          observation,
        ),
      );

      incrementMap(
        operationCounts,
        observation.operation,
      );

      incrementMap(
        planCounts,
        getPath(
          observation,
          'context.planCode',
        ),
      );

      totalExposure +=
        this.resolveAbsoluteDelta(
          observation,
        );
    }

    return {
      schemaVersion:
        'stage01d.divergence.v1',

      generatedAt:
        this.clock(),

      tenantId,

      count:
        observations.length,

      absoluteMonetaryExposure:
        round(
          totalExposure,
          6,
        ),

      byClassification:
        mapToArray(
          classificationCounts,
          'classification',
        ),

      bySeverity:
        mapToArray(
          severityCounts,
          'severity',
        ),

      byOperation:
        mapToArray(
          operationCounts,
          'operation',
        ),

      byPlan:
        mapToArray(
          planCounts,
          'planCode',
        ),
    };
  }

  /**
   * ==========================================================================
   * CUT-OVER READINESS
   * ==========================================================================
   *
   * IMPORTANT:
   *
   * This method produces READINESS INPUTS / telemetry status.
   *
   * It does NOT switch the billing engine.
   */

  evaluateCutoverReadiness(
    metrics = {},
  ) {
    const executions =
      toFiniteNumber(
        metrics.executions,
      );

    if (
      executions <
      this.policy.minObservations
    ) {
      return {
        status:
          READINESS_STATUSES.INSUFFICIENT_DATA,

        eligible:
          false,

        reason:
          'Minimum observation volume has not been reached.',

        evidence: {
          executions,

          minimumRequired:
            this.policy.minObservations,
        },

        thresholds:
          this.getReadinessThresholds(),
      };
    }

    const failureRateBps =
      toFiniteNumber(
        metrics.failureRateBps,
      );

    const divergenceRateBps =
      toFiniteNumber(
        metrics.divergenceRateBps,
      );

    const toleranceMatchRateBps =
      toFiniteNumber(
        metrics.toleranceMatchRateBps,
      );

    const exactMatchRateBps =
      toFiniteNumber(
        metrics.exactMatchRateBps,
      );

    const highSeverity =
      toFiniteNumber(
        metrics.highSeverity,
      );

    const criticalSeverity =
      toFiniteNumber(
        metrics.criticalSeverity,
      );

    const failuresWithinThreshold =
      failureRateBps <=
      this.policy.maxFailureBps;

    const divergenceWithinThreshold =
      divergenceRateBps <=
      this.policy.maxDivergenceBps;

    const toleranceWithinThreshold =
      toleranceMatchRateBps >=
      this.policy.minToleranceMatchBps;

    const exactWithinThreshold =
      exactMatchRateBps >=
      this.policy.minExactMatchBps;

    const highSeverityWithinThreshold =
      highSeverity <=
      this.policy.maxHighSeverityDivergences;

    const noCriticalDivergence =
      criticalSeverity === 0;

    const blockers = [];

    if (
      !failuresWithinThreshold
    ) {
      blockers.push(
        'execution_failure_rate_exceeded',
      );
    }

    if (
      !divergenceWithinThreshold
    ) {
      blockers.push(
        'divergence_rate_exceeded',
      );
    }

    if (
      !toleranceWithinThreshold
    ) {
      blockers.push(
        'tolerance_match_rate_below_threshold',
      );
    }

    if (
      !exactWithinThreshold
    ) {
      blockers.push(
        'exact_match_rate_below_threshold',
      );
    }

    if (
      !highSeverityWithinThreshold
    ) {
      blockers.push(
        'high_severity_divergence_present',
      );
    }

    if (
      !noCriticalDivergence
    ) {
      blockers.push(
        'critical_divergence_present',
      );
    }

    const eligible =
      blockers.length === 0;

    return {
      status:
        eligible
          ? READINESS_STATUSES.READY_FOR_REVIEW
          : READINESS_STATUSES.NOT_READY,

      eligible,

      reason:
        eligible
          ? 'Telemetry thresholds are satisfied; separate cut-over governance review is required.'
          : 'One or more telemetry thresholds are not satisfied.',

      blockers,

      evidence: {
        executions,

        failureRateBps,

        divergenceRateBps,

        toleranceMatchRateBps,

        exactMatchRateBps,

        highSeverity,

        criticalSeverity,
      },

      thresholds:
        this.getReadinessThresholds(),

      governance: {
        automaticCutover:
          false,

        legacyBillingRemainsAuthoritative:
          true,

        humanOrExplicitPolicyReviewRequired:
          true,
      },
    };
  }

  /**
   * ==========================================================================
   * READINESS THRESHOLDS
   * ==========================================================================
   */

  getReadinessThresholds() {
    return {
      minimumObservations:
        this.policy.minObservations,

      maximumDivergenceBps:
        this.policy.maxDivergenceBps,

      maximumFailureBps:
        this.policy.maxFailureBps,

      minimumToleranceMatchBps:
        this.policy.minToleranceMatchBps,

      minimumExactMatchBps:
        this.policy.minExactMatchBps,

      maximumHighSeverityDivergences:
        this.policy.maxHighSeverityDivergences,

      maximumCriticalDivergences:
        0,
    };
  }

  /**
   * ==========================================================================
   * READINESS SNAPSHOT
   * ==========================================================================
   */

  async getReadinessSnapshot(
    tenantId,
    options = {},
  ) {
    const telemetry =
      await this.getAggregatedObservationMetrics(
        tenantId,
        options,
      );

    return {
      schemaVersion:
        'stage01d.readiness.v1',

      generatedAt:
        this.clock(),

      tenantId,

      stage: STAGE,

      mode: MODE,

      readiness:
        telemetry.readiness,

      observationWindow:
        telemetry.window,

      metrics: {
        executions:
          telemetry.totals.executions,

        successRateBps:
          telemetry.rates.successRateBps,

        failureRateBps:
          telemetry.rates.failureRateBps,

        exactMatchRateBps:
          telemetry.rates.exactMatchRateBps,

        toleranceMatchRateBps:
          telemetry.rates.toleranceMatchRateBps,

        parityMatchRateBps:
          telemetry.rates.parityMatchRateBps,

        divergenceRateBps:
          telemetry.rates.divergenceRateBps,

        highSeverity:
          telemetry.totals.highSeverity,

        criticalSeverity:
          telemetry.totals.criticalSeverity,

        absoluteMonetaryExposure:
          telemetry.totals
            .absoluteMonetaryExposure,
      },

      governance: {
        shadowOnly:
          true,

        authoritativeBillingPath:
          'legacy',

        automaticCutover:
          false,
      },
    };
  }

  /**
   * ==========================================================================
   * TELEMETRY HEALTH
   * ==========================================================================
   */

  async healthCheck() {
    const startedAt =
      this.clock();

    try {
      const repository =
        this.reconciliationRepository;

      if (
        !repository ||
        typeof repository.count !==
          'function'
      ) {
        return {
          healthy: false,

          service:
            SERVICE_NAME,

          stage: STAGE,

          mode: MODE,

          reason:
            'Reconciliation repository does not expose the required persistence contract.',
        };
      }

      return {
        healthy: true,

        service:
          SERVICE_NAME,

        version:
          SERVICE_VERSION,

        stage: STAGE,

        mode: MODE,

        checkedAt:
          startedAt,

        shadowOnly:
          true,

        authoritativeBillingPath:
          'legacy',
      };
    } catch (error) {
      this.log(
        'error',
        'Stage 01d telemetry health check failed.',
        {
          error:
            error.message,
        },
      );

      return {
        healthy: false,

        service:
          SERVICE_NAME,

        stage: STAGE,

        mode: MODE,

        checkedAt:
          startedAt,

        reason:
          error.message,
      };
    }
  }

  /**
   * ==========================================================================
   * SERVICE METADATA
   * ==========================================================================
   */

  getMetadata() {
    return {
      service:
        SERVICE_NAME,

      version:
        SERVICE_VERSION,

      stage: STAGE,

      mode: MODE,

      responsibilities: [
        'execution-counting',
        'success-failure-measurement',
        'exact-match-rate',
        'tolerance-match-rate',
        'divergence-rate',
        'execution-failure-rate',
        'monetary-divergence-exposure',
        'severity-measurement',
        'tenant-parity',
        'plan-parity',
        'operation-parity',
        'observation-window-analysis',
        'cutover-readiness-inputs',
      ],

      prohibitedActions: [
        'authoritative-billing-mutation',
        'invoice-posting',
        'ledger-posting',
        'payment-capture',
        'subscription-mutation',
        'billing-engine-switch',
        'automatic-cutover',
      ],

      authoritativeBillingPath:
        'legacy',
    };
  }
}

/**
 * ============================================================================
 * FACTORY
 * ============================================================================
 */

function createStage01dTelemetryService(
  dependencies = {},
) {
  return new Stage01dTelemetryService(
    dependencies,
  );
}

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports =
  Stage01dTelemetryService;

module.exports.Stage01dTelemetryService =
  Stage01dTelemetryService;

module.exports.Stage01dTelemetryError =
  Stage01dTelemetryError;

module.exports.createStage01dTelemetryService =
  createStage01dTelemetryService;

module.exports.EXECUTION_OUTCOMES =
  EXECUTION_OUTCOMES;

module.exports.PARITY_LEVELS =
  PARITY_LEVELS;

module.exports.READINESS_STATUSES =
  READINESS_STATUSES;

module.exports.SEVERITIES =
  SEVERITIES;

module.exports.SERVICE_NAME =
  SERVICE_NAME;

module.exports.SERVICE_VERSION =
  SERVICE_VERSION;

module.exports.STAGE =
  STAGE;

module.exports.MODE =
  MODE;