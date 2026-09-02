"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * STAGE 01D — Behavioral Result Normalizer
 * backend/services/commercial/stage01dNormalizer.js
 * ============================================================================
 *
 * Converts implementation-specific results into a comparable semantic shape.
 *
 * We intentionally:
 *   - preserve business values
 *   - remove volatile identifiers
 *   - normalize Date instances
 *   - normalize ObjectIds
 *   - normalize error shape
 *   - preserve unknown fields rather than silently dropping them
 * ============================================================================
 */

const VOLATILE_KEYS = new Set([
  "createdAt",
  "updatedAt",
  "issuedAt",
  "paidAt",
  "processedAt",
  "upgradedAt",
  "downgradedAt",
  "startedAt",
  "trialStartedAt",
  "cancellationRequestedAt",
  "cancelledAt",
  "pastDueAt",
  "graceStartedAt",
  "graceEndsAt",
  "suspendedAt",
]);

const IDENTIFIER_KEYS =
  new Set([
    "id",
    "_id",
    "subscriptionId",
    "invoiceId",
    "paymentId",
    "webhookId",
    "correlationId",
    "requestId",
  ]);

const FUNCTIONAL_VOLATILE_KEYS =
  new Set([
    "stack",
  ]);

function isDate(value) {
  return (
    value instanceof Date &&
    !Number.isNaN(
      value.getTime()
    )
  );
}

function isObjectId(value) {
  return Boolean(
    value &&
    typeof value === "object" &&
    typeof value.toHexString ===
      "function"
  );
}

function normalizeDate(value) {
  if (isDate(value)) {
    return "<DATE>";
  }

  return value;
}

function normalizeScalar(value) {
  if (value === undefined) {
    return "<UNDEFINED>";
  }

  if (value === null) {
    return null;
  }

  if (isDate(value)) {
    return "<DATE>";
  }

  if (isObjectId(value)) {
    return "<OBJECT_ID>";
  }

  if (
    typeof value ===
    "bigint"
  ) {
    return String(value);
  }

  if (
    typeof value !==
      "object"
  ) {
    return value;
  }

  return value;
}

function normalizeValue(
  value,
  {
    stripIdentifiers = true,
    stripVolatileTimestamps = true,
    sortArrays = false,
  } = {}
) {
  if (
    value === null ||
    value === undefined
  ) {
    return normalizeScalar(
      value
    );
  }

  if (
    isDate(value) ||
    isObjectId(value) ||
    typeof value !==
      "object"
  ) {
    return normalizeScalar(
      value
    );
  }

  if (Array.isArray(value)) {
    const normalized =
      value.map((item) =>
        normalizeValue(item, {
          stripIdentifiers,
          stripVolatileTimestamps,
          sortArrays,
        })
      );

    if (sortArrays) {
      return normalized.sort(
        (a, b) =>
          JSON.stringify(a).localeCompare(
            JSON.stringify(b)
          )
      );
    }

    return normalized;
  }

  const output = {};

  for (const key of Object.keys(
    value
  ).sort()) {
    if (
      stripVolatileTimestamps &&
      VOLATILE_KEYS.has(key)
    ) {
      continue;
    }

    if (
      stripIdentifiers &&
      IDENTIFIER_KEYS.has(key)
    ) {
      continue;
    }

    if (
      FUNCTIONAL_VOLATILE_KEYS.has(
        key
      )
    ) {
      continue;
    }

    output[key] =
      normalizeValue(
        value[key],
        {
          stripIdentifiers,
          stripVolatileTimestamps,
          sortArrays,
        }
      );
  }

  return output;
}

function normalizeError(error) {
  if (!error) {
    return null;
  }

  return normalizeValue({
    name: error.name,
    code: error.code,
    statusCode: error.statusCode,
    message: error.message,
    retryable: error.retryable,
    details: error.details,
  });
}

function normalizeOutcome(
  outcome
) {
  if (
    outcome &&
    outcome.error
  ) {
    return {
      kind: "ERROR",
      value: null,
      error: normalizeError(
        outcome.error
      ),
    };
  }

  return {
    kind: "SUCCESS",
    value: normalizeValue(
      outcome?.value
    ),
    error: null,
  };
}

module.exports = {
  VOLATILE_KEYS,
  IDENTIFIER_KEYS,
  normalizeValue,
  normalizeError,
  normalizeOutcome,
};