'use strict';

/**
 * =============================================================================
 * TITech Community Capital LTD
 * Enterprise Airtel Payment Intelligence Engine
 * =============================================================================
 *
 * File:
 *   backend/modules/payment/airtel/intelligence/recommendationEngine.js
 *
 * Purpose:
 *   Enterprise-grade, deterministic payment-route recommendation engine for the
 *   Airtel payment intelligence domain.
 *
 * Architectural Position:
 *
 *   Payment Request / Provider Context
 *             |
 *             v
 *       Prediction Engine -----------+
 *             |                      |
 *             v                      v
 *       Provider Learning Engine  Telemetry / Health
 *             |                      |
 *             +----------+-----------+
 *                        v
 *              Recommendation Engine
 *                        |
 *        +---------------+----------------+
 *        |                                |
 *        v                                v
 *   Route Recommendation            Review / Defer
 *                        |
 *                        v
 *                Payment Orchestrator
 *                        |
 *                 Financial Core
 *                 Transaction/Ledger
 *
 * RESPONSIBILITIES
 * ----------------
 * - Normalize and validate provider-intelligence input.
 * - Apply hard safety / eligibility gates before ranking.
 * - Combine provider telemetry, prediction signals and learned signals.
 * - Produce deterministic, explainable route recommendations.
 * - Quantify recommendation score, confidence and data quality.
 * - Return a ranked candidate set and explicit rejection reasons.
 * - Remain stateless so workers can safely process concurrent requests.
 * - Support optional prediction/learning engines without making them mandatory.
 * - Support observability and metrics through dependency injection.
 *
 * NON-RESPONSIBILITIES / IMPORTANT BOUNDARIES
 * --------------------------------------------
 * - Does NOT call Airtel APIs.
 * - Does NOT create or settle financial transactions.
 * - Does NOT mutate balances.
 * - Does NOT write ledger entries.
 * - Does NOT perform KYC/AML decisions; it consumes authoritative signals.
 * - Does NOT override provider resilience / circuit-breaker state.
 * - Does NOT silently retry payment operations.
 * - Does NOT treat a recommendation as proof that a payment succeeded.
 * - Does NOT persist state internally.
 *
 * FINANCIAL SAFETY PRINCIPLE
 * --------------------------
 * A recommendation is decision-support only. The payment orchestration layer
 * remains responsible for provider execution, idempotency and the financial
 * transaction boundary. Successful settlement must still pass through the
 * authoritative transaction / ledger architecture.
 *
 * MODULE FORMAT
 * -------------
 * The TITech backend declares ESM module semantics. This file therefore uses
 * native ESM exports and Node built-ins only; no new runtime dependency is
 * required.
 *
 * =============================================================================
 */

import { createHash } from 'node:crypto';

// =============================================================================
// Engine identity
// =============================================================================

export const ENGINE_NAME = 'airtel-recommendation-engine';
export const ENGINE_VERSION = '1.0.0';
export const COMPONENT = ENGINE_NAME;

// =============================================================================
// Enumerations / policy constants
// =============================================================================

export const OPERATIONS = Object.freeze([
  'COLLECTION',
  'DISBURSEMENT',
  'REFUND',
  'REVERSAL',
  'STATUS',
]);

export const ACTIONS = Object.freeze([
  'ROUTE',
  'ROUTE_WITH_CAUTION',
  'USE_FALLBACK',
  'REQUIRE_REVIEW',
  'DEFER',
  'NO_ELIGIBLE_ROUTE',
]);

export const HEALTH_STATUSES = Object.freeze([
  'UP',
  'HEALTHY',
  'DEGRADED',
  'DOWN',
  'UNKNOWN',
]);

export const CIRCUIT_STATES = Object.freeze([
  'CLOSED',
  'HALF_OPEN',
  'OPEN',
  'UNKNOWN',
]);

const HARD_BLOCKED_HEALTH = new Set(['DOWN']);
const HARD_BLOCKED_CIRCUIT = new Set(['OPEN']);
const AUTO_ROUTE_ACTIONS = new Set([
  'ROUTE',
  'ROUTE_WITH_CAUTION',
  'USE_FALLBACK',
]);
const TERMINAL_RISK_DECISIONS = new Set(['BLOCK', 'DENY', 'REJECT']);
const TERMINAL_COMPLIANCE_STATES = new Set([
  'BLOCKED',
  'DENIED',
  'REJECTED',
]);

const DEFAULT_WEIGHTS = Object.freeze({
  reliability: 0.23,
  availability: 0.14,
  latency: 0.15,
  health: 0.10,
  prediction: 0.15,
  learning: 0.12,
  cost: 0.04,
  capacity: 0.04,
  fit: 0.03,
});

const DEFAULT_THRESHOLDS = Object.freeze({
  minScoreToAutoRoute: 55,
  minConfidenceToAutoRoute: 0.60,
  minSampleSize: 30,
  staleAfterMs: 10 * 60 * 1000,
  maxLatencyMs: 5000,
  idealLatencyMs: 250,
  maxFeeBps: 300,
  highRiskScore: 80,
  mediumRiskScore: 60,
  strongScore: 75,
  cautionScore: 65,
  scoreMarginForConfidence: 15,
});

const DEFAULT_OPTIONS = Object.freeze({
  providerScope: 'AIRTEL',
  requireTenantId: true,
  maxCandidates: 25,
  integrationTimeoutMs: 800,
  includeRejectedCandidates: true,
});

// =============================================================================
// Errors
// =============================================================================

export class AirtelRecommendationEngineError extends Error {
  constructor(message, options = {}) {
    super(message);

    this.name = 'AirtelRecommendationEngineError';
    this.code = options.code || 'AIRTEL_RECOMMENDATION_ERROR';
    this.statusCode = options.statusCode || 500;
    this.details = Object.freeze({
      ...(options.details || {}),
    });
    this.cause = options.cause || null;

    Error.captureStackTrace?.(
      this,
      AirtelRecommendationEngineError,
    );
  }
}

// =============================================================================
// Primitive helpers
// =============================================================================

function isObject(value) {
  return value !== null && typeof value === 'object';
}

function isPlainObject(value) {
  if (!isObject(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function clamp(value, min = 0, max = 1) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeIdentifier(value, field, maxLength = 256) {
  if (value === null || value === undefined) return null;

  const normalized = String(value).trim();

  if (!normalized) return null;

  if (normalized.length > maxLength) {
    throw new AirtelRecommendationEngineError(
      `${field} exceeds the maximum allowed length.`,
      {
        code: 'RECOMMENDATION_IDENTIFIER_TOO_LONG',
        statusCode: 422,
        details: {
          field,
          maxLength,
        },
      },
    );
  }

  return normalized;
}

function normalizeProvider(value, fallback = 'AIRTEL') {
  const normalized = normalizeIdentifier(value, 'provider', 80);

  if (!normalized && (fallback === null || fallback === undefined)) {
    return null;
  }

  return (normalized || fallback).toUpperCase();
}

function normalizeUpper(value, fallback = null) {
  const normalized = normalizeIdentifier(value, 'value', 128);
  return normalized ? normalized.toUpperCase() : fallback;
}

function normalizeRate(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  if (number === null) return null;

  // Accept both [0,1] probabilities and [0,100] percentage representations.
  if (number > 1 && number <= 100) {
    return clamp(number / 100);
  }

  return clamp(number);
}

function normalizeScore(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  if (number === null) return null;

  // Accept [0,1] and [0,100].
  if (number >= 0 && number <= 1) {
    return number * 100;
  }

  return clamp(number, 0, 100);
}

function normalizeDate(value) {
  if (value === null || value === undefined) return null;

  const date = value instanceof Date
    ? new Date(value.getTime())
    : new Date(value);

  return Number.isNaN(date.getTime()) ? null : date;
}

function nowDate(clock) {
  try {
    const value = typeof clock === 'function' ? clock() : Date.now();
    const date = value instanceof Date
      ? new Date(value.getTime())
      : new Date(value);

    return Number.isNaN(date.getTime()) ? new Date() : date;
  } catch {
    return new Date();
  }
}

function safeCall(fn, fallback = null) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

function deepClone(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(deepClone);
  if (!isPlainObject(value)) return value;

  const output = {};

  for (const [key, item] of Object.entries(value)) {
    output[key] = deepClone(item);
  }

  return output;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!isObject(value) || seen.has(value)) return value;

  seen.add(value);

  for (const nested of Object.values(value)) {
    deepFreeze(nested, seen);
  }

  return Object.freeze(value);
}

function normalizeWeights(weights = {}) {
  const merged = {
    ...DEFAULT_WEIGHTS,
    ...(isPlainObject(weights) ? weights : {}),
  };

  const positive = Object.fromEntries(
    Object.entries(merged).map(([key, value]) => [
      key,
      Math.max(0, finiteNumber(value, 0)),
    ]),
  );

  const total = Object.values(positive)
    .reduce((sum, value) => sum + value, 0);

  if (total <= 0) {
    return { ...DEFAULT_WEIGHTS };
  }

  return Object.fromEntries(
    Object.entries(positive)
      .map(([key, value]) => [key, value / total]),
  );
}

function stableNormalize(value) {
  if (Array.isArray(value)) {
    return value.map(stableNormalize);
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort()
      .reduce((result, key) => {
        result[key] = stableNormalize(value[key]);
        return result;
      }, {});
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'number' && !Number.isFinite(value)) {
    return String(value);
  }

  return value;
}

function stableSerialize(value) {
  return JSON.stringify(stableNormalize(value));
}

function sha256(value) {
  return createHash('sha256')
    .update(stableSerialize(value))
    .digest('hex');
}

function normalizeSupportList(value) {
  if (value === null || value === undefined) return null;

  const list = Array.isArray(value) ? value : [value];

  return Object.freeze(
    list
      .map(item => normalizeUpper(item, null))
      .filter(Boolean),
  );
}

function matchesSupport(list, requestedValue) {
  if (!list || list.length === 0 || !requestedValue) return 0.75;

  const requested = String(requestedValue)
    .trim()
    .toUpperCase();

  if (list.includes('*') || list.includes(requested)) return 1;

  return 0;
}

function getFirst(source, keys = []) {
  for (const key of keys) {
    const segments = String(key)
      .split('.')
      .filter(Boolean);

    let value = source;

    for (const segment of segments) {
      if (value === null || value === undefined) {
        value = null;
        break;
      }

      value = value[segment];
    }

    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function toRatio(value, fallback = null) {
  const number = finiteNumber(value, fallback);
  if (number === null) return null;

  if (number > 1 && number <= 100) {
    return clamp(number / 100);
  }

  return clamp(number);
}

function latencyScore(latencyMs, thresholds) {
  const latency = finiteNumber(latencyMs, null);

  if (latency === null || latency < 0) return 0.5;
  if (latency <= thresholds.idealLatencyMs) return 1;
  if (latency >= thresholds.maxLatencyMs) return 0;

  const span =
    thresholds.maxLatencyMs -
    thresholds.idealLatencyMs;

  return clamp(
    1 - (
      (latency - thresholds.idealLatencyMs) /
      span
    ),
  );
}

function healthScore(status) {
  switch (normalizeUpper(status, 'UNKNOWN')) {
    case 'UP':
    case 'HEALTHY':
      return 1;

    case 'DEGRADED':
      return 0.70;

    case 'DOWN':
      return 0;

    default:
      return 0.55;
  }
}

function circuitScore(state) {
  switch (normalizeUpper(state, 'UNKNOWN')) {
    case 'CLOSED':
      return 1;

    case 'HALF_OPEN':
      return 0.60;

    case 'OPEN':
      return 0;

    default:
      return 0.55;
  }
}

function sampleQuality(sampleSize, thresholds) {
  const count = finiteNumber(sampleSize, null);

  if (count === null || count < 0) {
    return 0.40;
  }

  return clamp(
    count / thresholds.minSampleSize,
  );
}

function freshnessQuality(updatedAt, now, thresholds) {
  const date = normalizeDate(updatedAt);

  if (!date) {
    return 0.40;
  }

  const ageMs = Math.max(
    0,
    now.getTime() - date.getTime(),
  );

  if (ageMs <= thresholds.staleAfterMs) {
    return (
      1 -
      (
        ageMs /
        thresholds.staleAfterMs
      ) * 0.25
    );
  }

  if (ageMs >= thresholds.staleAfterMs * 6) {
    return 0.10;
  }

  return clamp(
    0.75 -
    (
      (
        ageMs -
        thresholds.staleAfterMs
      ) /
      (
        thresholds.staleAfterMs * 5
      )
    ) * 0.65,
    0.10,
    0.75,
  );
}

function reason(
  code,
  message,
  severity = 'INFO',
  details = {},
) {
  return Object.freeze({
    code,
    message,
    severity,
    ...(Object.keys(details).length ? { details } : {}),
  });
}

function serializeSafeError(error) {
  if (!error) return null;

  return {
    name: error.name || 'Error',
    code: error.code || null,
    message: error.message || 'Unknown error',
  };
}

// =============================================================================
// Engine
// =============================================================================

export class AirtelRecommendationEngine {
  constructor(options = {}) {
    const optionsObject =
      isPlainObject(options)
        ? options
        : {};

    const mergedOptions = {
      ...DEFAULT_OPTIONS,
      ...optionsObject,
    };

    const thresholds = {
      ...DEFAULT_THRESHOLDS,
      ...(
        isPlainObject(optionsObject.thresholds)
          ? optionsObject.thresholds
          : {}
      ),
    };

    for (const [key, value] of Object.entries(thresholds)) {
      const normalized = finiteNumber(value, null);

      if (normalized === null || normalized < 0) {
        throw new AirtelRecommendationEngineError(
          `Invalid recommendation threshold: ${key}.`,
          {
            code:
              'RECOMMENDATION_CONFIGURATION_INVALID',
            statusCode: 500,
            details: {
              key,
              value,
            },
          },
        );
      }

      thresholds[key] = normalized;
    }

    if (
      thresholds.minScoreToAutoRoute >
      100
    ) {
      thresholds.minScoreToAutoRoute = 100;
    }

    thresholds.minConfidenceToAutoRoute =
      clamp(
        thresholds.minConfidenceToAutoRoute,
      );

    this.config = deepFreeze({
      ...mergedOptions,

      providerScope:
        mergedOptions.providerScope
          ? normalizeProvider(
            mergedOptions.providerScope,
          )
          : null,

      maxCandidates:
        Math.min(
          100,
          Math.max(
            1,
            Math.trunc(
              finiteNumber(
                mergedOptions.maxCandidates,
                DEFAULT_OPTIONS.maxCandidates,
              ),
            ),
          ),
        ),

      integrationTimeoutMs:
        Math.min(
          10000,
          Math.max(
            50,
            Math.trunc(
              finiteNumber(
                mergedOptions.integrationTimeoutMs,
                DEFAULT_OPTIONS.integrationTimeoutMs,
              ),
            ),
          ),
        ),

      weights:
        normalizeWeights(
          optionsObject.weights,
        ),

      thresholds,
    });

    this.clock =
      typeof optionsObject.clock === 'function'
        ? optionsObject.clock
        : () => Date.now();

    this.logger =
      isObject(optionsObject.logger)
        ? optionsObject.logger
        : null;

    this.metrics =
      isObject(optionsObject.metrics)
        ? optionsObject.metrics
        : null;

    this.predictionEngine =
      optionsObject.predictionEngine ||
      null;

    this.providerLearningEngine =
      optionsObject.providerLearningEngine ||
      null;
  }

  // ---------------------------------------------------------------------------
  // Public diagnostics
  // ---------------------------------------------------------------------------

  health() {
    return Object.freeze({
      success: true,
      component: COMPONENT,
      engine: ENGINE_NAME,
      version: ENGINE_VERSION,
      providerScope: this.config.providerScope,
      ready: true,
      stateless: true,

      integrations: Object.freeze({
        predictionEngine:
          Boolean(this.predictionEngine),

        providerLearningEngine:
          Boolean(this.providerLearningEngine),

        metrics:
          Boolean(this.metrics),

        logger:
          Boolean(this.logger),
      }),
    });
  }

  // ---------------------------------------------------------------------------
  // Public synchronous API
  // ---------------------------------------------------------------------------

  recommendSync(input = {}) {
    const context =
      this.#normalizeContext(input);

    const now =
      nowDate(this.clock);

    const preparedCandidates =
      context.candidates.map(
        candidate =>
          this.#prepareCandidate(
            candidate,
            context,
            now,
          ),
      );

    return this.#buildRecommendation(
      context,
      preparedCandidates,
      now,
      {
        asyncIntegrationsAttempted:
          false,

        integrationDiagnostics: [],
      },
    );
  }

  scoreCandidate(
    candidate = {},
    context = {},
  ) {
    const normalizedContext =
      this.#normalizeContext({
        ...context,
        candidates: [candidate],
      });

    const now =
      nowDate(this.clock);

    return this.#prepareCandidate(
      candidate,
      normalizedContext,
      now,
    );
  }

  // ---------------------------------------------------------------------------
  // Public asynchronous API
  // ---------------------------------------------------------------------------

  async recommend(input = {}) {
    const context =
      this.#normalizeContext(input);

    const now =
      nowDate(this.clock);

    const integrationDiagnostics = [];

    const enrichedCandidates =
      await Promise.all(
        context.candidates.map(
          async candidate => {
            const enrichment =
              await this.#enrichCandidate(
                candidate,
                context,
                now,
                integrationDiagnostics,
              );

            return this.#prepareCandidate(
              {
                ...candidate,

                prediction:
                  enrichment.prediction,

                learning:
                  enrichment.learning,
              },
              context,
              now,
            );
          },
        ),
      );

    return this.#buildRecommendation(
      context,
      enrichedCandidates,
      now,
      {
        asyncIntegrationsAttempted:
          true,

        integrationDiagnostics,
      },
    );
  }

  async recommendProvider(input = {}) {
    return this.recommend(input);
  }

  async rankCandidates(input = {}) {
    const result =
      await this.recommend(input);

    return result.rankedCandidates;
  }

  // ---------------------------------------------------------------------------
  // Normalization
  // ---------------------------------------------------------------------------

  #normalizeContext(input = {}) {
    if (!isPlainObject(input)) {
      throw new AirtelRecommendationEngineError(
        'Recommendation input must be a plain object.',
        {
          code:
            'RECOMMENDATION_INPUT_INVALID',
          statusCode: 422,
        },
      );
    }

    const tenantId =
      normalizeIdentifier(
        input.tenantId,
        'tenantId',
        128,
      );

    if (
      this.config.requireTenantId &&
      !tenantId
    ) {
      throw new AirtelRecommendationEngineError(
        'tenantId is required for provider recommendation.',
        {
          code:
            'RECOMMENDATION_TENANT_REQUIRED',
          statusCode: 422,
        },
      );
    }

    const operation =
      normalizeUpper(
        input.operation,
        'COLLECTION',
      );

    if (
      !OPERATIONS.includes(
        operation,
      )
    ) {
      throw new AirtelRecommendationEngineError(
        `Unsupported payment operation: ${operation}.`,
        {
          code:
            'RECOMMENDATION_OPERATION_UNSUPPORTED',

          statusCode:
            422,

          details: {
            operation,
            supportedOperations:
              OPERATIONS,
          },
        },
      );
    }

    const candidatesInput =
      input.candidates ??
      input.providers ??
      null;

    let candidates;

    if (
      candidatesInput === null ||
      candidatesInput === undefined
    ) {
      candidates = [{
        provider:
          this.config.providerScope ||
          'AIRTEL',
      }];
    } else if (
      Array.isArray(candidatesInput)
    ) {
      candidates =
        candidatesInput;
    } else {
      throw new AirtelRecommendationEngineError(
        'candidates/providers must be an array.',
        {
          code:
            'RECOMMENDATION_CANDIDATES_INVALID',
          statusCode: 422,
        },
      );
    }

    if (
      candidates.length === 0
    ) {
      throw new AirtelRecommendationEngineError(
        'At least one provider candidate is required.',
        {
          code:
            'RECOMMENDATION_CANDIDATES_EMPTY',
          statusCode: 422,
        },
      );
    }

    if (
      candidates.length >
      this.config.maxCandidates
    ) {
      throw new AirtelRecommendationEngineError(
        'The candidate set exceeds the configured recommendation limit.',
        {
          code:
            'RECOMMENDATION_CANDIDATES_TOO_MANY',

          statusCode:
            422,

          details: {
            maxCandidates:
              this.config.maxCandidates,
          },
        },
      );
    }

    return Object.freeze({
      tenantId,

      operation,

      channel:
        normalizeUpper(
          input.channel,
          null,
        ),

      country:
        normalizeUpper(
          input.country,
          null,
        ),

      currency:
        normalizeUpper(
          input.currency,
          null,
        ),

      currentProvider:
        normalizeProvider(
          input.currentProvider,
          null,
        ),

      requestId:
        normalizeIdentifier(
          input.requestId,
          'requestId',
          256,
        ),

      correlationId:
        normalizeIdentifier(
          input.correlationId,
          'correlationId',
          256,
        ),

      amount:
        input.amount === null ||
        input.amount === undefined
          ? null
          : String(
            input.amount,
          ).trim(),

      context:
        isPlainObject(
          input.context,
        )
          ? deepClone(
            input.context,
          )
          : {},

      candidates:
        Object.freeze(
          candidates.map(
            candidate => {
              if (
                !isPlainObject(
                  candidate,
                )
              ) {
                throw new AirtelRecommendationEngineError(
                  'Each provider candidate must be a plain object.',
                  {
                    code:
                      'RECOMMENDATION_CANDIDATE_INVALID',

                    statusCode:
                      422,
                  },
                );
              }

              return deepClone(
                candidate,
              );
            },
          ),
        ),
    });
  }

  // ---------------------------------------------------------------------------
  // Optional intelligence integrations
  // ---------------------------------------------------------------------------

  async #enrichCandidate(
    candidate,
    context,
    now,
    diagnostics,
  ) {
    const [
      prediction,
      learning,
    ] = await Promise.all([
      this.#callPredictionEngine(
        candidate,
        context,
        now,
        diagnostics,
      ),

      this.#callLearningEngine(
        candidate,
        context,
        now,
        diagnostics,
      ),
    ]);

    return {
      prediction,
      learning,
    };
  }

  async #callPredictionEngine(
    candidate,
    context,
    now,
    diagnostics,
  ) {
    const engine =
      this.predictionEngine;

    if (!engine) {
      return null;
    }

    const methodNames = [
      'predictRoute',
      'predictProvider',
      'predict',
      'scoreCandidate',
      'estimate',
    ];

    const methodName =
      methodNames.find(
        name =>
          typeof engine?.[name] ===
          'function',
      );

    if (!methodName) {
      diagnostics.push({
        integration:
          'predictionEngine',

        provider:
          normalizeProvider(
            candidate.provider,
          ),

        status:
          'UNAVAILABLE',

        code:
          'PREDICTION_METHOD_NOT_FOUND',
      });

      return null;
    }

    const payload =
      this.#integrationPayload(
        candidate,
        context,
        now,
      );

    try {
      const result =
        await this.#withTimeout(
          Promise.resolve(
            engine[methodName](
              payload,
            ),
          ),
          this.config.integrationTimeoutMs,
        );

      diagnostics.push({
        integration:
          'predictionEngine',

        provider:
          normalizeProvider(
            candidate.provider,
          ),

        status:
          'OK',

        method:
          methodName,
      });

      return this.#sanitizeSignal(
        result,
      );
    } catch (error) {
      diagnostics.push({
        integration:
          'predictionEngine',

        provider:
          normalizeProvider(
            candidate.provider,
          ),

        status:
          'FAILED',

        method:
          methodName,

        code:
          error?.code ||
          'PREDICTION_INTEGRATION_FAILED',
      });

      this.#log(
        'warn',
        {
          event:
            'airtel_recommendation_prediction_integration_failed',

          provider:
            normalizeProvider(
              candidate.provider,
            ),

          code:
            error?.code ||
            'PREDICTION_INTEGRATION_FAILED',
        },
      );

      return null;
    }
  }

  async #callLearningEngine(
    candidate,
    context,
    now,
    diagnostics,
  ) {
    const engine =
      this.providerLearningEngine;

    if (!engine) {
      return null;
    }

    const methodNames = [
      'getProviderLearningSignal',
      'getProviderScore',
      'scoreProvider',
      'getLearningSignal',
      'evaluateProvider',
      'evaluate',
    ];

    const methodName =
      methodNames.find(
        name =>
          typeof engine?.[name] ===
          'function',
      );

    if (!methodName) {
      diagnostics.push({
        integration:
          'providerLearningEngine',

        provider:
          normalizeProvider(
            candidate.provider,
          ),

        status:
          'UNAVAILABLE',

        code:
          'LEARNING_METHOD_NOT_FOUND',
      });

      return null;
    }

    const payload =
      this.#integrationPayload(
        candidate,
        context,
        now,
      );

    try {
      const result =
        await this.#withTimeout(
          Promise.resolve(
            engine[methodName](
              payload,
            ),
          ),
          this.config.integrationTimeoutMs,
        );

      diagnostics.push({
        integration:
          'providerLearningEngine',

        provider:
          normalizeProvider(
            candidate.provider,
          ),

        status:
          'OK',

        method:
          methodName,
      });

      return this.#sanitizeSignal(
        result,
      );
    } catch (error) {
      diagnostics.push({
        integration:
          'providerLearningEngine',

        provider:
          normalizeProvider(
            candidate.provider,
          ),

        status:
          'FAILED',

        method:
          methodName,

        code:
          error?.code ||
          'LEARNING_INTEGRATION_FAILED',
      });

      this.#log(
        'warn',
        {
          event:
            'airtel_recommendation_learning_integration_failed',

          provider:
            normalizeProvider(
              candidate.provider,
            ),

          code:
            error?.code ||
            'LEARNING_INTEGRATION_FAILED',
        },
      );

      return null;
    }
  }

  #integrationPayload(
    candidate,
    context,
    now,
  ) {
    return {
      tenantId:
        context.tenantId,

      provider:
        normalizeProvider(
          candidate.provider,
        ),

      operation:
        context.operation,

      channel:
        context.channel,

      country:
        context.country,

      currency:
        context.currency,

      amount:
        context.amount,

      currentProvider:
        context.currentProvider,

      candidate:
        this.#sanitizedCandidateForIntegration(
          candidate,
        ),

      now:
        now.toISOString(),

      requestId:
        context.requestId,

      correlationId:
        context.correlationId,

      context:
        deepClone(
          context.context,
        ),
    };
  }

  #sanitizedCandidateForIntegration(
    candidate,
  ) {
    // Never forward arbitrary candidate metadata to optional intelligence engines.
    return {
      provider:
        normalizeProvider(
          candidate.provider,
        ),

      routeId:
        normalizeIdentifier(
          candidate.routeId,
          'routeId',
          128,
        ),

      enabled:
        candidate.enabled !== false,

      eligible:
        candidate.eligible !== false,

      healthStatus:
        normalizeUpper(
          candidate.healthStatus,
          'UNKNOWN',
        ),

      circuitState:
        normalizeUpper(
          candidate.circuitState,
          'UNKNOWN',
        ),

      successRate:
        normalizeRate(
          getFirst(
            candidate,
            [
              'recentSuccessRate',
              'successRate',
            ],
          ),
        ),

      availability:
        normalizeRate(
          getFirst(
            candidate,
            [
              'availability',
              'uptime',
            ],
          ),
        ),

      latencyMs:
        finiteNumber(
          getFirst(
            candidate,
            [
              'p95LatencyMs',
              'latencyMs',
              'responseTimeMs',
            ],
          ),
        ),

      feeBps:
        finiteNumber(
          getFirst(
            candidate,
            [
              'feeBps',
              'providerFeeBps',
            ],
          ),
        ),

      capacityUtilization:
        toRatio(
          getFirst(
            candidate,
            [
              'capacityUtilization',
              'utilization',
              'loadRatio',
            ],
          ),
        ),

      sampleSize:
        finiteNumber(
          getFirst(
            candidate,
            [
              'sampleSize',
              'observations',
            ],
          ),
        ),

      updatedAt:
        normalizeDate(
          getFirst(
            candidate,
            [
              'updatedAt',
              'lastObservedAt',
            ],
          ),
        )?.toISOString() ||
        null,
    };
  }

  #sanitizeSignal(signal) {
    if (
      signal === null ||
      signal === undefined
    ) {
      return null;
    }

    if (!isPlainObject(signal)) {
      if (
        typeof signal === 'number' ||
        typeof signal === 'string'
      ) {
        return signal;
      }

      return null;
    }

    const allowed = [
      'predictedSuccessRate',
      'successProbability',
      'probability',
      'confidence',
      'score',
      'learnedScore',
      'providerScore',
      'posteriorMean',
      'sampleSize',
      'observations',
      'status',
      'reasonCodes',
      'updatedAt',
      'lastObservedAt',
    ];

    const sanitized = {};

    for (const key of allowed) {
      if (
        signal[key] !== undefined
      ) {
        sanitized[key] =
          deepClone(
            signal[key],
          );
      }
    }

    return sanitized;
  }

  async #withTimeout(
    promise,
    timeoutMs,
  ) {
    let timer = null;

    const timeoutPromise =
      new Promise(
        (_, reject) => {
          timer =
            setTimeout(
              () => {
                const error =
                  new Error(
                    'Recommendation intelligence integration timed out.',
                  );

                error.code =
                  'RECOMMENDATION_INTEGRATION_TIMEOUT';

                reject(error);
              },
              timeoutMs,
            );

          timer?.unref?.();
        },
      );

    try {
      return await Promise.race([
        promise,
        timeoutPromise,
      ]);
    } finally {
      if (timer) {
        clearTimeout(
          timer,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Candidate preparation / scoring
  // ---------------------------------------------------------------------------

  #prepareCandidate(
    candidate,
    context,
    now,
  ) {
    const provider =
      normalizeProvider(
        candidate.provider ??
        candidate.name ??
        candidate.code,
        this.config.providerScope ||
        'AIRTEL',
      );

    const normalized = {
      ...deepClone(candidate),

      provider,

      routeId:
        normalizeIdentifier(
          candidate.routeId,
          'routeId',
          128,
        ),

      healthStatus:
        normalizeUpper(
          candidate.healthStatus,
          'UNKNOWN',
        ),

      circuitState:
        normalizeUpper(
          candidate.circuitState,
          'UNKNOWN',
        ),

      riskDecision:
        normalizeUpper(
          candidate.riskDecision,
          null,
        ),

      complianceStatus:
        normalizeUpper(
          candidate.complianceStatus,
          null,
        ),

      supportedOperations:
        normalizeSupportList(
          candidate.supportedOperations ??
          candidate.operations,
        ),

      supportedCountries:
        normalizeSupportList(
          candidate.supportedCountries ??
          candidate.countries,
        ),

      supportedCurrencies:
        normalizeSupportList(
          candidate.supportedCurrencies ??
          candidate.currencies,
        ),

      supportedChannels:
        normalizeSupportList(
          candidate.supportedChannels ??
          candidate.channels,
        ),
    };

    const gate =
      this.#evaluateGate(
        normalized,
        context,
      );

    const components =
      this.#scoreComponents(
        normalized,
        context,
      );

    const weightedScore =
      this.#weightedScore(
        components,
      );

    const dataQuality =
      this.#dataQuality(
        normalized,
        components,
        now,
      );

    const finalScore =
      clamp(
        weightedScore *
        (
          0.65 +
          (
            0.35 *
            dataQuality.overall
          )
        ),
        0,
        100,
      );

    const reasons =
      this.#buildCandidateReasons(
        normalized,
        components,
        gate,
        dataQuality,
      );

    return {
      provider,

      routeId:
        normalized.routeId,

      eligible:
        gate.eligible,

      rejectionCodes:
        gate.rejectionCodes,

      score:
        Number(
          finalScore.toFixed(
            4,
          ),
        ),

      rawScore:
        Number(
          weightedScore.toFixed(
            4,
          ),
        ),

      confidence:
        Number(
          this.#candidateConfidence(
            finalScore,
            dataQuality,
            normalized,
          ).toFixed(
            4,
          ),
        ),

      components,

      dataQuality,

      reasons,

      healthStatus:
        normalized.healthStatus,

      circuitState:
        normalized.circuitState,

      riskDecision:
        normalized.riskDecision,

      complianceStatus:
        normalized.complianceStatus,

      sampleSize:
        finiteNumber(
          getFirst(
            normalized,
            [
              'sampleSize',
              'observations',
            ],
          ),
        ),

      updatedAt:
        normalizeDate(
          getFirst(
            normalized,
            [
              'updatedAt',
              'lastObservedAt',
            ],
          ),
        )?.toISOString() ||
        null,

      telemetry: {
        successRate:
          normalizeRate(
            getFirst(
              normalized,
              [
                'recentSuccessRate',
                'successRate',
              ],
            ),
          ),

        availability:
          normalizeRate(
            getFirst(
              normalized,
              [
                'availability',
                'uptime',
              ],
            ),
          ),

        latencyMs:
          finiteNumber(
            getFirst(
              normalized,
              [
                'p95LatencyMs',
                'latencyMs',
                'responseTimeMs',
              ],
            ),
          ),

        feeBps:
          finiteNumber(
            getFirst(
              normalized,
              [
                'feeBps',
                'providerFeeBps',
              ],
            ),
          ),

        capacityUtilization:
          toRatio(
            getFirst(
              normalized,
              [
                'capacityUtilization',
                'utilization',
                'loadRatio',
              ],
            ),
          ),
      },
    };
  }

  #evaluateGate(
    candidate,
    context,
  ) {
    const rejectionCodes = [];

    if (
      candidate.enabled === false
    ) {
      rejectionCodes.push(
        'PROVIDER_DISABLED',
      );
    }

    if (
      candidate.eligible === false
    ) {
      rejectionCodes.push(
        'PROVIDER_INELIGIBLE',
      );
    }

    if (
      candidate.routeAllowed === false
    ) {
      rejectionCodes.push(
        'ROUTE_NOT_ALLOWED',
      );
    }

    if (
      candidate.maintenance === true
    ) {
      rejectionCodes.push(
        'PROVIDER_MAINTENANCE',
      );
    }

    if (
      candidate.capacityAvailable === false
    ) {
      rejectionCodes.push(
        'CAPACITY_UNAVAILABLE',
      );
    }

    if (
      candidate.blocked === true
    ) {
      rejectionCodes.push(
        'PROVIDER_BLOCKED',
      );
    }

    if (
      HARD_BLOCKED_HEALTH.has(
        candidate.healthStatus,
      )
    ) {
      rejectionCodes.push(
        'PROVIDER_DOWN',
      );
    }

    if (
      HARD_BLOCKED_CIRCUIT.has(
        candidate.circuitState,
      )
    ) {
      rejectionCodes.push(
        'CIRCUIT_OPEN',
      );
    }

    if (
      candidate.riskDecision &&
      TERMINAL_RISK_DECISIONS.has(
        candidate.riskDecision,
      )
    ) {
      rejectionCodes.push(
        'RISK_BLOCK',
      );
    }

    if (
      candidate.complianceStatus &&
      TERMINAL_COMPLIANCE_STATES.has(
        candidate.complianceStatus,
      )
    ) {
      rejectionCodes.push(
        'COMPLIANCE_BLOCK',
      );
    }

    if (
      this.config.providerScope &&
      candidate.provider !==
        this.config.providerScope &&
      candidate.allowOutsideProviderScope !==
        true
    ) {
      rejectionCodes.push(
        'PROVIDER_SCOPE_MISMATCH',
      );
    }

    if (
      matchesSupport(
        candidate.supportedOperations,
        context.operation,
      ) === 0
    ) {
      rejectionCodes.push(
        'OPERATION_UNSUPPORTED',
      );
    }

    if (
      matchesSupport(
        candidate.supportedCountries,
        context.country,
      ) === 0
    ) {
      rejectionCodes.push(
        'COUNTRY_UNSUPPORTED',
      );
    }

    if (
      matchesSupport(
        candidate.supportedCurrencies,
        context.currency,
      ) === 0
    ) {
      rejectionCodes.push(
        'CURRENCY_UNSUPPORTED',
      );
    }

    if (
      matchesSupport(
        candidate.supportedChannels,
        context.channel,
      ) === 0
    ) {
      rejectionCodes.push(
        'CHANNEL_UNSUPPORTED',
      );
    }

    return {
      eligible:
        rejectionCodes.length === 0,

      rejectionCodes:
        Object.freeze([
          ...new Set(
            rejectionCodes,
          ),
        ]),
    };
  }

  #scoreComponents(
    candidate,
    context,
  ) {
    const thresholds =
      this.config.thresholds;

    const successRate =
      normalizeRate(
        getFirst(
          candidate,
          [
            'recentSuccessRate',
            'successRate',
          ],
        ),
        0.50,
      );

    const availability =
      normalizeRate(
        getFirst(
          candidate,
          [
            'availability',
            'uptime',
          ],
        ),
        0.50,
      );

    const latencyMs =
      finiteNumber(
        getFirst(
          candidate,
          [
            'p95LatencyMs',
            'latencyMs',
            'responseTimeMs',
          ],
        ),
        null,
      );

    const feeBps =
      finiteNumber(
        getFirst(
          candidate,
          [
            'feeBps',
            'providerFeeBps',
          ],
        ),
        null,
      );

    const utilization =
      toRatio(
        getFirst(
          candidate,
          [
            'capacityUtilization',
            'utilization',
            'loadRatio',
          ],
        ),
        null,
      );

    const predictionSignal =
      candidate.prediction ||
      null;

    const learningSignal =
      candidate.learning ||
      null;

    const predictedProbability =
      normalizeRate(
        getFirst(
          predictionSignal,
          [
            'predictedSuccessRate',
            'successProbability',
            'probability',
          ],
        ),
        null,
      );

    const predictionConfidence =
      normalizeRate(
        getFirst(
          predictionSignal,
          [
            'confidence',
          ],
        ),
        null,
      );

    const predictionScore =
      predictedProbability === null
        ? 0.50
        : clamp(
          (
            predictedProbability *
            0.70
          ) +
          (
            (
              predictionConfidence ??
              0.50
            ) *
            0.30
          ),
        );

    const learnedScoreRaw =
      normalizeScore(
        getFirst(
          learningSignal,
          [
            'learnedScore',
            'providerScore',
            'score',
            'posteriorMean',
          ],
        ),
        null,
      );

    const learningScore =
      learnedScoreRaw === null
        ? 0.50
        : clamp(
          learnedScoreRaw / 100,
        );

    const feeScore =
      feeBps === null
        ? 0.50
        : clamp(
          1 -
          (
            Math.max(
              0,
              feeBps,
            ) /
            Math.max(
              1,
              thresholds.maxFeeBps,
            )
          ),
        );

    const capacityScore =
      utilization === null
        ? 0.50
        : clamp(
          1 -
          utilization,
        );

    const operationFit =
      matchesSupport(
        candidate.supportedOperations,
        context.operation,
      );

    const countryFit =
      matchesSupport(
        candidate.supportedCountries,
        context.country,
      );

    const currencyFit =
      matchesSupport(
        candidate.supportedCurrencies,
        context.currency,
      );

    const channelFit =
      matchesSupport(
        candidate.supportedChannels,
        context.channel,
      );

    const fitScore =
      (
        operationFit *
        0.45
      ) +
      (
        countryFit *
        0.20
      ) +
      (
        currencyFit *
        0.20
      ) +
      (
        channelFit *
        0.15
      );

    const baseHealth =
      healthScore(
        candidate.healthStatus,
      );

    const circuit =
      circuitScore(
        candidate.circuitState,
      );

    const combinedHealth =
      (
        baseHealth *
        0.75
      ) +
      (
        circuit *
        0.25
      );

    return {
      reliability:
        Number(
          clamp(
            successRate,
          ).toFixed(
            4,
          ),
        ),

      availability:
        Number(
          clamp(
            availability,
          ).toFixed(
            4,
          ),
        ),

      latency:
        Number(
          latencyScore(
            latencyMs,
            thresholds,
          ).toFixed(
            4,
          ),
        ),

      health:
        Number(
          clamp(
            combinedHealth,
          ).toFixed(
            4,
          ),
        ),

      prediction:
        Number(
          predictionScore.toFixed(
            4,
          ),
        ),

      learning:
        Number(
          learningScore.toFixed(
            4,
          ),
        ),

      cost:
        Number(
          feeScore.toFixed(
            4,
          ),
        ),

      capacity:
        Number(
          capacityScore.toFixed(
            4,
          ),
        ),

      fit:
        Number(
          clamp(
            fitScore,
          ).toFixed(
            4,
          ),
        ),

      predictionConfidence:
        Number(
          (
            predictionConfidence ??
            0.50
          ).toFixed(
            4,
          ),
        ),
    };
  }

  #weightedScore(
    components,
  ) {
    const weights =
      this.config.weights;

    return clamp(
      (
        (
          components.reliability *
          weights.reliability
        ) +

        (
          components.availability *
          weights.availability
        ) +

        (
          components.latency *
          weights.latency
        ) +

        (
          components.health *
          weights.health
        ) +

        (
          components.prediction *
          weights.prediction
        ) +

        (
          components.learning *
          weights.learning
        ) +

        (
          components.cost *
          weights.cost
        ) +

        (
          components.capacity *
          weights.capacity
        ) +

        (
          components.fit *
          weights.fit
        )
      ) * 100,
      0,
      100,
    );
  }

  #dataQuality(
    candidate,
    components,
    now,
  ) {
    const thresholds =
      this.config.thresholds;

    const sampleSize =
      finiteNumber(
        getFirst(
          candidate,
          [
            'sampleSize',
            'observations',
            'prediction.sampleSize',
            'learning.sampleSize',
          ],
        ),
        null,
      );

    const updatedAt =
      normalizeDate(
        getFirst(
          candidate,
          [
            'updatedAt',
            'lastObservedAt',
          ],
        ),
      );

    const coverageValues = [
      getFirst(
        candidate,
        [
          'recentSuccessRate',
          'successRate',
        ],
      ),

      getFirst(
        candidate,
        [
          'availability',
          'uptime',
        ],
      ),

      getFirst(
        candidate,
        [
          'p95LatencyMs',
          'latencyMs',
          'responseTimeMs',
        ],
      ),

      candidate.prediction,
      candidate.learning,
    ];

    const knownSignals =
      coverageValues.filter(
        value =>
          value !== null &&
          value !== undefined,
      ).length;

    const coverage =
      clamp(
        knownSignals /
        coverageValues.length,
      );

    const sample =
      sampleQuality(
        sampleSize,
        thresholds,
      );

    const freshness =
      freshnessQuality(
        updatedAt,
        now,
        thresholds,
      );

    const overall =
      clamp(
        (
          sample *
          0.45
        ) +
        (
          freshness *
          0.30
        ) +
        (
          coverage *
          0.25
        ),
      );

    const stale =
      updatedAt
        ? (
          now.getTime() -
          updatedAt.getTime()
        ) >
          thresholds.staleAfterMs
        : true;

    return {
      sample:
        Number(
          sample.toFixed(
            4,
          ),
        ),

      freshness:
        Number(
          freshness.toFixed(
            4,
          ),
        ),

      coverage:
        Number(
          coverage.toFixed(
            4,
          ),
        ),

      overall:
        Number(
          overall.toFixed(
            4,
          ),
        ),

      stale,

      sampleSize,

      notes:
        Object.freeze([
          ...(
            sample < 0.50
              ? [
                'Limited historical observations reduce confidence.',
              ]
              : []
          ),

          ...(
            stale
              ? [
                'Provider telemetry is stale or missing.',
              ]
              : []
          ),

          ...(
            coverage < 0.50
              ? [
                'Several intelligence signals are unavailable.',
              ]
              : []
          ),
        ]),
    };
  }

  #candidateConfidence(
    score,
    dataQuality,
    candidate,
  ) {
    const scoreComponent =
      clamp(
        score / 100,
      );

    const riskPenalty =
      this.#riskPenalty(
        candidate,
      );

    return clamp(
      (
        scoreComponent *
        0.55
      ) +
      (
        dataQuality.overall *
        0.35
      ) +
      (
        (
          1 -
          riskPenalty
        ) *
        0.10
      ),
    );
  }

  #riskPenalty(
    candidate,
  ) {
    const explicitRisk =
      normalizeScore(
        getFirst(
          candidate,
          [
            'riskScore',
          ],
        ),
        null,
      );

    if (
      explicitRisk === null
    ) {
      return candidate.riskDecision ===
        'REVIEW'
        ? 0.30
        : 0;
    }

    if (
      explicitRisk >=
      this.config.thresholds.highRiskScore
    ) {
      return 0.80;
    }

    if (
      explicitRisk >=
      this.config.thresholds.mediumRiskScore
    ) {
      return 0.45;
    }

    return 0;
  }

  #buildCandidateReasons(
    candidate,
    components,
    gate,
    dataQuality,
  ) {
    const reasons = [];

    if (
      !gate.eligible
    ) {
      for (
        const rejectionCode of
        gate.rejectionCodes
      ) {
        reasons.push(
          reason(
            rejectionCode,
            this.#humanizeRejection(
              rejectionCode,
            ),
            'BLOCK',
          ),
        );
      }
    }

    const positiveDrivers = [
      [
        'RELIABILITY_STRONG',
        components.reliability,
        'Provider reliability signal is strong.',
      ],

      [
        'AVAILABILITY_STRONG',
        components.availability,
        'Provider availability signal is strong.',
      ],

      [
        'LATENCY_STRONG',
        components.latency,
        'Observed latency is within the preferred range.',
      ],

      [
        'HEALTH_STABLE',
        components.health,
        'Provider health and circuit signals are stable.',
      ],

      [
        'PREDICTION_POSITIVE',
        components.prediction,
        'Prediction signal supports successful execution.',
      ],

      [
        'LEARNING_POSITIVE',
        components.learning,
        'Historical learning signal supports this route.',
      ],

      [
        'COST_REASONABLE',
        components.cost,
        'Provider cost signal is within the configured range.',
      ],

      [
        'CAPACITY_AVAILABLE',
        components.capacity,
        'Provider capacity signal is acceptable.',
      ],

      [
        'ROUTE_FIT',
        components.fit,
        'Provider route matches the requested operation/context.',
      ],
    ];

    for (
      const [
        code,
        score,
        message,
      ] of positiveDrivers
    ) {
      if (
        score >= 0.75
      ) {
        reasons.push(
          reason(
            code,
            message,
            'POSITIVE',
          ),
        );
      }
    }

    const negativeDrivers = [
      [
        'RELIABILITY_WEAK',
        components.reliability,
        'Reliability telemetry is weak or uncertain.',
      ],

      [
        'AVAILABILITY_WEAK',
        components.availability,
        'Availability telemetry is weak or uncertain.',
      ],

      [
        'LATENCY_WEAK',
        components.latency,
        'Observed or estimated latency is elevated.',
      ],

      [
        'HEALTH_DEGRADED',
        components.health,
        'Provider health/circuit state is degraded or uncertain.',
      ],

      [
        'PREDICTION_WEAK',
        components.prediction,
        'Prediction signal does not strongly support the route.',
      ],

      [
        'LEARNING_WEAK',
        components.learning,
        'Learning signal does not strongly support the route.',
      ],

      [
        'COST_HIGH',
        components.cost,
        'Provider cost signal is relatively high.',
      ],

      [
        'CAPACITY_PRESSURE',
        components.capacity,
        'Provider capacity appears constrained.',
      ],

      [
        'ROUTE_FIT_WEAK',
        components.fit,
        'Provider fit for the requested context is incomplete.',
      ],
    ];

    for (
      const [
        code,
        score,
        message,
      ] of negativeDrivers
    ) {
      if (
        score <= 0.40
      ) {
        reasons.push(
          reason(
            code,
            message,
            'NEGATIVE',
          ),
        );
      }
    }

    if (
      dataQuality.notes.length
    ) {
      for (
        const note of
        dataQuality.notes
      ) {
        reasons.push(
          reason(
            'DATA_QUALITY_WARNING',
            note,
            'WARNING',
          ),
        );
      }
    }

    if (
      candidate.riskDecision ===
      'REVIEW'
    ) {
      reasons.push(
        reason(
          'RISK_REVIEW_REQUIRED',
          'Authoritative risk controls indicate that additional review may be required.',
          'WARNING',
        ),
      );
    }

    return Object.freeze(
      reasons,
    );
  }

  #humanizeRejection(
    code,
  ) {
    const messages = {
      PROVIDER_DISABLED:
        'Provider is disabled.',

      PROVIDER_INELIGIBLE:
        'Provider has been marked ineligible.',

      ROUTE_NOT_ALLOWED:
        'The route is explicitly not allowed.',

      PROVIDER_MAINTENANCE:
        'Provider is in a maintenance state.',

      CAPACITY_UNAVAILABLE:
        'Provider reports insufficient capacity.',

      PROVIDER_BLOCKED:
        'Provider is explicitly blocked.',

      PROVIDER_DOWN:
        'Provider health is currently down.',

      CIRCUIT_OPEN:
        'Provider circuit breaker is open.',

      RISK_BLOCK:
        'Authoritative risk controls block this route.',

      COMPLIANCE_BLOCK:
        'Authoritative compliance controls block this route.',

      PROVIDER_SCOPE_MISMATCH:
        'Candidate is outside the configured provider scope.',

      OPERATION_UNSUPPORTED:
        'Provider does not support the requested operation.',

      COUNTRY_UNSUPPORTED:
        'Provider does not support the requested country.',

      CURRENCY_UNSUPPORTED:
        'Provider does not support the requested currency.',

      CHANNEL_UNSUPPORTED:
        'Provider does not support the requested channel.',
    };

    return (
      messages[code] ||
      'Provider candidate failed an eligibility rule.'
    );
  }

  // ---------------------------------------------------------------------------
  // Final recommendation assembly
  // ---------------------------------------------------------------------------

  #buildRecommendation(
    context,
    candidates,
    now,
    diagnostics = {},
  ) {
    const ranked =
      [...candidates].sort(
        (
          left,
          right,
        ) => {
          if (
            left.eligible !==
            right.eligible
          ) {
            return left.eligible
              ? -1
              : 1;
          }

          if (
            right.score !==
            left.score
          ) {
            return (
              right.score -
              left.score
            );
          }

          if (
            right.confidence !==
            left.confidence
          ) {
            return (
              right.confidence -
              left.confidence
            );
          }

          return left.provider.localeCompare(
            right.provider,
          );
        },
      );

    const eligible =
      ranked.filter(
        candidate =>
          candidate.eligible,
      );

    const selected =
      eligible[0] ||
      null;

    const second =
      eligible[1] ||
      null;

    const margin =
      selected
        ? Math.max(
          0,
          selected.score -
          (
            second?.score ??
            0
          ),
        )
        : 0;

    const confidence =
      selected
        ? this.#overallConfidence(
          selected,
          margin,
        )
        : 0;

    const action =
      this.#resolveAction(
        context,
        selected,
        confidence,
      );

    const recommendation =
      selected
        ? this.#safeCandidate(
          selected,
        )
        : null;

    const rankedCandidates =
      eligible.map(
        (
          candidate,
          index,
        ) =>
          this.#safeCandidate({
            ...candidate,

            rank:
              index + 1,

            recommendationRole:
              index === 0
                ? 'PRIMARY'
                : 'SECONDARY',
          }),
      );

    const rejectedCandidates =
      this.config
        .includeRejectedCandidates
        ? ranked
          .filter(
            candidate =>
              !candidate.eligible,
          )
          .map(
            candidate =>
              this.#safeCandidate(
                candidate,
              ),
          )
        : [];

    const reasons =
      selected
        ? this.#buildRecommendationReasons(
          selected,
          second,
          margin,
          confidence,
          action,
        )
        : [
          reason(
            'NO_ELIGIBLE_PROVIDER',
            'No provider candidate passed the configured hard eligibility gates.',
            'BLOCK',
          ),
        ];

    const decisionId =
      sha256({
        engine:
          ENGINE_NAME,

        version:
          ENGINE_VERSION,

        tenantId:
          context.tenantId,

        operation:
          context.operation,

        channel:
          context.channel,

        country:
          context.country,

        currency:
          context.currency,

        currentProvider:
          context.currentProvider,

        candidates:
          candidates.map(
            candidate =>
              this.#decisionFingerprint(
                candidate,
              ),
          ),
      }).slice(
        0,
        32,
      );

    const result = {
      success:
        true,

      recommended:
        Boolean(
          selected &&
          AUTO_ROUTE_ACTIONS.has(
            action,
          ),
        ),

      action,

      engine:
        ENGINE_NAME,

      version:
        ENGINE_VERSION,

      component:
        COMPONENT,

      decisionId,

      generatedAt:
        now.toISOString(),

      tenantId:
        context.tenantId,

      operation:
        context.operation,

      provider:
        recommendation,

      confidence:
        Number(
          confidence.toFixed(
            4,
          ),
        ),

      score:
        selected
          ? Number(
            selected.score.toFixed(
              4,
            ),
          )
          : null,

      scoreMargin:
        Number(
          margin.toFixed(
            4,
          ),
        ),

      rankedCandidates,

      rejectedCandidates,

      reasons:
        Object.freeze(
          reasons,
        ),

      dataQuality:
        selected
          ? Object.freeze({
            ...selected.dataQuality,
          })
          : Object.freeze({
            overall:
              0,

            sample:
              0,

            freshness:
              0,

            coverage:
              0,

            stale:
              true,

            sampleSize:
              null,
          }),

      diagnostics:
        Object.freeze({
          asyncIntegrationsAttempted:
            Boolean(
              diagnostics.asyncIntegrationsAttempted,
            ),

          predictionEngineConfigured:
            Boolean(
              this.predictionEngine,
            ),

          providerLearningEngineConfigured:
            Boolean(
              this.providerLearningEngine,
            ),

          integrationDiagnostics:
            Object.freeze(
              (
                diagnostics.integrationDiagnostics ||
                []
              ).map(
                entry => ({
                  ...entry,
                }),
              ),
            ),
        }),
    };

    this.#recordMetrics(
      result,
    );

    this.#log(
      'info',
      {
        event:
          'airtel_recommendation_decision',

        decisionId,

        action,

        provider:
          selected?.provider ||
          null,

        score:
          result.score,

        confidence:
          result.confidence,

        eligibleCandidateCount:
          eligible.length,

        rejectedCandidateCount:
          ranked.length -
          eligible.length,

        operation:
          context.operation,
      },
    );

    return deepFreeze(
      result,
    );
  }

  #overallConfidence(
    selected,
    margin,
  ) {
    const marginScore =
      clamp(
        margin /
        Math.max(
          1,
          this.config.thresholds
            .scoreMarginForConfidence,
        ),
      );

    return clamp(
      (
        selected.confidence *
        0.70
      ) +
      (
        marginScore *
        0.20
      ) +
      (
        selected.dataQuality.overall *
        0.10
      ),
    );
  }

  #resolveAction(
    context,
    selected,
    confidence,
  ) {
    if (!selected) {
      return 'NO_ELIGIBLE_ROUTE';
    }

    if (
      selected.score <
        this.config.thresholds
          .minScoreToAutoRoute ||
      confidence <
        this.config.thresholds
          .minConfidenceToAutoRoute
    ) {
      return 'REQUIRE_REVIEW';
    }

    const caution = (
      selected.score <
        this.config.thresholds
          .cautionScore ||

      selected.healthStatus ===
        'DEGRADED' ||

      selected.circuitState ===
        'HALF_OPEN' ||

      selected.dataQuality.stale ||

      selected.confidence <
        this.config.thresholds
          .minConfidenceToAutoRoute
    );

    if (caution) {
      return (
        context.currentProvider &&
        selected.provider !==
          context.currentProvider
      )
        ? 'USE_FALLBACK'
        : 'ROUTE_WITH_CAUTION';
    }

    if (
      context.currentProvider &&
      selected.provider !==
        context.currentProvider
    ) {
      return 'USE_FALLBACK';
    }

    return 'ROUTE';
  }

  #buildRecommendationReasons(
    selected,
    second,
    margin,
    confidence,
    action,
  ) {
    const reasons = [];

    if (
      action === 'ROUTE'
    ) {
      reasons.push(
        reason(
          'ROUTE_ELIGIBLE',
          'Selected provider passed all hard eligibility gates and the configured auto-route thresholds.',
          'POSITIVE',
        ),
      );
    }

    if (
      action === 'USE_FALLBACK'
    ) {
      reasons.push(
        reason(
          'FALLBACK_ROUTE_SELECTED',
          'Selected provider differs from the current provider and is eligible under the configured policy.',
          'INFO',
        ),
      );
    }

    if (
      action ===
      'ROUTE_WITH_CAUTION'
    ) {
      reasons.push(
        reason(
          'CAUTION_ROUTE',
          'Route remains eligible but one or more health, freshness or confidence signals warrant caution.',
          'WARNING',
        ),
      );
    }

    if (
      action ===
      'REQUIRE_REVIEW'
    ) {
      reasons.push(
        reason(
          'REVIEW_THRESHOLD',
          'The candidate is eligible, but score or confidence is below the configured automatic-routing threshold.',
          'WARNING',
        ),
      );
    }

    if (
      selected.score >=
      this.config.thresholds.strongScore
    ) {
      reasons.push(
        reason(
          'SCORE_STRONG',
          'Aggregate provider score is strong relative to the configured policy.',
          'POSITIVE',
        ),
      );
    }

    if (
      margin >=
      this.config.thresholds
        .scoreMarginForConfidence
    ) {
      reasons.push(
        reason(
          'RANKING_MARGIN',
          'Selected candidate has a meaningful score margin over the next eligible candidate.',
          'POSITIVE',
        ),
      );
    }

    if (
      second &&
      margin <
        this.config.thresholds
          .scoreMarginForConfidence
    ) {
      reasons.push(
        reason(
          'RANKING_MARGIN_LOW',
          'Top eligible candidates are closely matched; recommendation confidence is therefore reduced.',
          'WARNING',
        ),
      );
    }

    if (
      confidence <
        this.config.thresholds
          .minConfidenceToAutoRoute
    ) {
      reasons.push(
        reason(
          'CONFIDENCE_LOW',
          'Recommendation confidence is below the configured automatic-routing threshold.',
          'WARNING',
        ),
      );
    }

    for (
      const candidateReason of
      selected.reasons
    ) {
      if (
        candidateReason.severity ===
          'NEGATIVE' ||
        candidateReason.severity ===
          'WARNING'
      ) {
        reasons.push(
          candidateReason,
        );
      }
    }

    return Object.freeze(
      reasons,
    );
  }

  #decisionFingerprint(
    candidate,
  ) {
    return {
      provider:
        candidate.provider,

      routeId:
        candidate.routeId,

      eligible:
        candidate.eligible,

      score:
        Number(
          candidate.score.toFixed(
            4,
          ),
        ),

      confidence:
        Number(
          candidate.confidence.toFixed(
            4,
          ),
        ),

      healthStatus:
        candidate.healthStatus,

      circuitState:
        candidate.circuitState,

      riskDecision:
        candidate.riskDecision,

      complianceStatus:
        candidate.complianceStatus,

      sampleSize:
        candidate.sampleSize,

      updatedAt:
        candidate.updatedAt,

      components:
        candidate.components,
    };
  }

  #safeCandidate(
    candidate,
  ) {
    return {
      provider:
        candidate.provider,

      routeId:
        candidate.routeId,

      rank:
        candidate.rank ??
        null,

      recommendationRole:
        candidate.recommendationRole ??
        null,

      eligible:
        candidate.eligible,

      score:
        Number(
          candidate.score.toFixed(
            4,
          ),
        ),

      confidence:
        Number(
          candidate.confidence.toFixed(
            4,
          ),
        ),

      rawScore:
        Number(
          candidate.rawScore.toFixed(
            4,
          ),
        ),

      healthStatus:
        candidate.healthStatus,

      circuitState:
        candidate.circuitState,

      sampleSize:
        candidate.sampleSize,

      updatedAt:
        candidate.updatedAt,

      telemetry: {
        successRate:
          candidate.telemetry.successRate,

        availability:
          candidate.telemetry.availability,

        latencyMs:
          candidate.telemetry.latencyMs,

        feeBps:
          candidate.telemetry.feeBps,

        capacityUtilization:
          candidate.telemetry.capacityUtilization,
      },

      components: {
        reliability:
          candidate.components.reliability,

        availability:
          candidate.components.availability,

        latency:
          candidate.components.latency,

        health:
          candidate.components.health,

        prediction:
          candidate.components.prediction,

        learning:
          candidate.components.learning,

        cost:
          candidate.components.cost,

        capacity:
          candidate.components.capacity,

        fit:
          candidate.components.fit,
      },

      dataQuality: {
        overall:
          candidate.dataQuality.overall,

        sample:
          candidate.dataQuality.sample,

        freshness:
          candidate.dataQuality.freshness,

        coverage:
          candidate.dataQuality.coverage,

        stale:
          candidate.dataQuality.stale,

        sampleSize:
          candidate.dataQuality.sampleSize,
      },

      rejectionCodes:
        [
          ...candidate.rejectionCodes,
        ],

      reasons:
        candidate.reasons.map(
          item => ({
            ...item,
          }),
        ),
    };
  }

  // ---------------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------------

  #recordMetrics(
    result,
  ) {
    if (!this.metrics) {
      return;
    }

    const labels = {
      action:
        result.action,

      operation:
        result.operation,

      provider:
        result.provider?.provider ||
        'NONE',
    };

    safeCall(() => {
      if (
        typeof this.metrics.increment ===
        'function'
      ) {
        this.metrics.increment(
          'titech_airtel_recommendation_total',
          1,
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.inc ===
        'function'
      ) {
        this.metrics.inc(
          'titech_airtel_recommendation_total',
          labels,
        );

        return;
      }

      if (
        typeof this.metrics.count ===
        'function'
      ) {
        this.metrics.count(
          'titech_airtel_recommendation_total',
          1,
          labels,
        );
      }
    });

    safeCall(() => {
      if (
        typeof this.metrics.observe ===
          'function' &&
        result.score !== null
      ) {
        this.metrics.observe(
          'titech_airtel_recommendation_score',
          result.score,
          labels,
        );
      }
    });

    safeCall(() => {
      if (
        typeof this.metrics.observe ===
        'function'
      ) {
        this.metrics.observe(
          'titech_airtel_recommendation_confidence',
          result.confidence,
          labels,
        );
      }
    });
  }

  #log(
    level,
    payload,
  ) {
    if (!this.logger) {
      return;
    }

    safeCall(() => {
      const method =
        typeof this.logger[level] ===
        'function'
          ? this.logger[level]
          : typeof this.logger.info ===
              'function'
            ? this.logger.info
            : null;

      if (method) {
        method.call(
          this.logger,
          {
            component:
              COMPONENT,

            engineVersion:
              ENGINE_VERSION,

            ...payload,
          },
        );
      }
    });
  }
}

// =============================================================================
// Factory / default instance
// =============================================================================

export function createRecommendationEngine(
  options = {},
) {
  return new AirtelRecommendationEngine(
    options,
  );
}

export const defaultRecommendationEngine =
  createRecommendationEngine();

export default AirtelRecommendationEngine;