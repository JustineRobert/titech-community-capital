"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * STAGE 01D — Behavioral Parity Service
 * backend/services/commercial/stage01dParityService.js
 * ============================================================================
 *
 * Purpose:
 *   Execute equivalent operations against legacy and canonical services,
 *   normalize their results, and identify behavioral divergence.
 *
 * IMPORTANT:
 *   This service never performs automatic repair.
 *   It does not mutate either implementation.
 *   Write operations MUST be invoked only with explicitly supplied test/
 *   shadow inputs.
 * ============================================================================
 */

const crypto = require("crypto");

const {
  OPERATIONS,
  resolveOperationMethod,
  isWriteOperation,
} = require("./stage01dContract");

const {
  normalizeOutcome,
  normalizeValue,
} = require("./stage01dNormalizer");

const {
  config,
} = require("../../config/saasBillingStage01d");

function createCorrelationId() {
  return `stage01d_${crypto.randomUUID()}`;
}

function createTimeoutError(
  operation,
  timeoutMs
) {
  const error =
    new Error(
      `[TITech][Stage01D] Operation "${operation}" timed out after ${timeoutMs}ms.`
    );

  error.code =
    "STAGE_01D_OPERATION_TIMEOUT";

  return error;
}

async function withTimeout(
  promise,
  timeoutMs,
  operation
) {
  let timer;

  const timeout =
    new Promise(
      (_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              createTimeoutError(
                operation,
                timeoutMs
              )
            );
          },
          timeoutMs
        );
      }
    );

  try {
    return await Promise.race([
      promise,
      timeout,
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

function assertOperation(
  operation
) {
  if (
    !Object.values(
      OPERATIONS
    ).includes(operation)
  ) {
    throw new Error(
      `[TITech][Stage01D] Unsupported operation "${operation}".`
    );
  }
}

async function executeServiceOperation({
  service,
  operation,
  side,
  args = [],
  kwargs = undefined,
  timeoutMs =
    config.shadowTimeoutMs,
}) {
  assertOperation(
    operation
  );

  const methodName =
    resolveOperationMethod(
      service,
      operation,
      side
    );

  if (!methodName) {
    const error =
      new Error(
        `[TITech][Stage01D] No compatible method found for ${side} operation "${operation}".`
      );

    error.code =
      "STAGE_01D_OPERATION_NOT_IMPLEMENTED";

    error.operation =
      operation;

    error.side = side;

    throw error;
  }

  const method =
    service[methodName].bind(
      service
    );

  const invocation =
    kwargs !== undefined
      ? method(kwargs)
      : method(...args);

  return withTimeout(
    invocation,
    timeoutMs,
    operation
  );
}

async function safelyExecute(
  options
) {
  try {
    const value =
      await executeServiceOperation(
        options
      );

    return {
      value,
      error: null,
    };
  } catch (error) {
    return {
      value: null,
      error,
    };
  }
}

function collectDifferences(
  legacy,
  canonical,
  path = "",
  differences = [],
  maxDifferences =
    config.maxDifferencesPerResult
) {
  if (
    differences.length >=
    maxDifferences
  ) {
    return differences;
  }

  if (
    Object.is(
      legacy,
      canonical
    )
  ) {
    return differences;
  }

  const legacyIsObject =
    legacy !== null &&
    typeof legacy ===
      "object";

  const canonicalIsObject =
    canonical !== null &&
    typeof canonical ===
      "object";

  if (
    Array.isArray(legacy) &&
    Array.isArray(canonical)
  ) {
    if (
      legacy.length !==
      canonical.length
    ) {
      differences.push({
        path,
        type: "ARRAY_LENGTH",
        legacy: legacy.length,
        canonical:
          canonical.length,
      });

      return differences;
    }

    for (
      let index = 0;
      index < legacy.length;
      index += 1
    ) {
      collectDifferences(
        legacy[index],
        canonical[index],
        `${path}[${index}]`,
        differences,
        maxDifferences
      );

      if (
        differences.length >=
        maxDifferences
      ) {
        break;
      }
    }

    return differences;
  }

  if (
    legacyIsObject &&
    canonicalIsObject &&
    !Array.isArray(legacy) &&
    !Array.isArray(canonical)
  ) {
    const keys =
      Array.from(
        new Set([
          ...Object.keys(
            legacy
          ),
          ...Object.keys(
            canonical
          ),
        ])
      ).sort();

    for (const key of keys) {
      const childPath =
        path
          ? `${path}.${key}`
          : key;

      if (
        !(key in legacy)
      ) {
        differences.push({
          path: childPath,
          type: "MISSING_LEGACY_FIELD",
          legacy:
            "<MISSING>",
          canonical:
            canonical[key],
        });

        continue;
      }

      if (
        !(key in canonical)
      ) {
        differences.push({
          path: childPath,
          type: "MISSING_CANONICAL_FIELD",
          legacy:
            legacy[key],
          canonical:
            "<MISSING>",
        });

        continue;
      }

      collectDifferences(
        legacy[key],
        canonical[key],
        childPath,
        differences,
        maxDifferences
      );

      if (
        differences.length >=
        maxDifferences
      ) {
        break;
      }
    }

    return differences;
  }

  differences.push({
    path,
    type: "VALUE_MISMATCH",
    legacy,
    canonical,
  });

  return differences;
}

function compareNormalizedOutcomes(
  legacyOutcome,
  canonicalOutcome
) {
  const differences = [];

  if (
    legacyOutcome.kind !==
    canonicalOutcome.kind
  ) {
    differences.push({
      path: "$",
      type: "OUTCOME_KIND_MISMATCH",
      legacy:
        legacyOutcome.kind,
      canonical:
        canonicalOutcome.kind,
    });

    return {
      equal: false,
      differences,
    };
  }

  if (
    legacyOutcome.kind ===
    "ERROR"
  ) {
    collectDifferences(
      legacyOutcome.error,
      canonicalOutcome.error,
      "error",
      differences
    );

    return {
      equal:
        differences.length ===
        0,
      differences,
    };
  }

  collectDifferences(
    legacyOutcome.value,
    canonicalOutcome.value,
    "value",
    differences
  );

  return {
    equal:
      differences.length ===
      0,
    differences,
  };
}

class Stage01DParityService {
  constructor({
    legacy,
    canonical,
    runtimeConfig = config,
    logger = console,
  } = {}) {
    this.legacy =
      legacy || {};

    this.canonical =
      canonical || {};

    this.runtimeConfig =
      runtimeConfig;

    this.logger =
      logger;
  }

  async compare({
    operation,
    args = [],
    kwargs = undefined,
    metadata = {},
    allowWriteOperation = false,
    timeoutMs =
      this.runtimeConfig.shadowTimeoutMs,
  }) {
    assertOperation(
      operation
    );

    if (
      isWriteOperation(
        operation
      ) &&
      !allowWriteOperation
    ) {
      throw new Error(
        `[TITech][Stage01D] Write operation "${operation}" requires allowWriteOperation=true in an explicit parity/shadow context.`
      );
    }

    const correlationId =
      metadata.correlationId ||
      createCorrelationId();

    const executionMetadata = {
      ...metadata,
      correlationId,
      operation,
    };

    const [
      legacyResult,
      canonicalResult,
    ] = await Promise.all([
      safelyExecute({
        service:
          this.legacy,
        operation,
        side: "legacy",
        args,
        kwargs,
        timeoutMs,
      }),

      safelyExecute({
        service:
          this.canonical,
        operation,
        side: "canonical",
        args,
        kwargs,
        timeoutMs,
      }),
    ]);

    const normalizedLegacy =
      normalizeOutcome(
        legacyResult
      );

    const normalizedCanonical =
      normalizeOutcome(
        canonicalResult
      );

    const comparison =
      compareNormalizedOutcomes(
        normalizedLegacy,
        normalizedCanonical
      );

    const result = {
      stage: "01D",
      correlationId,
      operation,
      comparable: true,

      equal:
        comparison.equal,

      legacy: normalizedLegacy,
      canonical:
        normalizedCanonical,

      differences:
        comparison.differences,

      metadata:
        normalizeValue(
          executionMetadata
        ),

      generatedAt:
        new Date().toISOString(),
    };

    if (!result.equal) {
      this.logger.warn?.(
        "[TITech][Stage01D] Behavioral divergence detected.",
        {
          operation,
          correlationId,
          differences:
            result.differences,
        }
      );
    }

    return result;
  }

  async compareRead({
    operation,
    args = [],
    kwargs = undefined,
    metadata = {},
  }) {
    return this.compare({
      operation,
      args,
      kwargs,
      metadata,
      allowWriteOperation: false,
    });
  }

  async compareWrite({
    operation,
    args = [],
    kwargs = undefined,
    metadata = {},
  }) {
    return this.compare({
      operation,
      args,
      kwargs,
      metadata,
      allowWriteOperation: true,
    });
  }
}

module.exports = {
  Stage01DParityService,
  assertOperation,
  withTimeout,
  collectDifferences,
  compareNormalizedOutcomes,
};