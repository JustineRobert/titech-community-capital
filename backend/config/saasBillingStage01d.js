"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * STAGE 01D — SaaS Billing Migration Control Plane
 * ============================================================================
 *
 * File:
 *   backend/config/saasBillingStage01d.js
 *
 * Purpose:
 *   Central configuration for behavioral parity, shadow reads, reconciliation
 *   and controlled SaaS billing write cut-over.
 *
 * Safety principle:
 *   Stage 01D is READ/COMPARE/OBSERVE by default.
 *
 *   No production write is redirected to the canonical commercial billing
 *   implementation unless the explicit write-cutover gate is enabled.
 * ============================================================================
 */

const BOOLEAN_TRUE_VALUES = new Set([
  "1",
  "true",
  "yes",
  "y",
  "on",
  "enabled",
]);

function parseBoolean(value, defaultValue = false) {
  if (value === undefined || value === null || value === "") {
    return defaultValue;
  }

  return BOOLEAN_TRUE_VALUES.has(
    String(value).trim().toLowerCase()
  );
}

function parsePositiveInteger(value, defaultValue) {
  const number = Number(value);

  if (!Number.isSafeInteger(number) || number < 0) {
    return defaultValue;
  }

  return number;
}

function parseNonNegativeNumber(value, defaultValue) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return defaultValue;
  }

  return number;
}

function parseString(value, defaultValue = "") {
  const normalized = String(value ?? "").trim();

  return normalized || defaultValue;
}

const config = Object.freeze({
  enabled: parseBoolean(
    process.env.TITECH_SAAS_BILLING_STAGE_01D_ENABLED,
    false
  ),

  /**
   * Behavioral parity tests are independent of runtime traffic.
   */
  parityTestsEnabled: parseBoolean(
    process.env.TITECH_SAAS_BILLING_STAGE_01D_PARITY_ENABLED,
    true
  ),

  /**
   * Execute the legacy path and canonical path for comparable reads.
   */
  shadowReadEnabled: parseBoolean(
    process.env.TITECH_SAAS_BILLING_STAGE_01D_SHADOW_READ_ENABLED,
    false
  ),

  /**
   * Persist reconciliation differences.
   */
  reconciliationEnabled: parseBoolean(
    process.env.TITECH_SAAS_BILLING_STAGE_01D_RECONCILIATION_ENABLED,
    false
  ),

  /**
   * Never enable by accident.
   *
   * This is the final application-write switch.
   */
  canonicalWriteEnabled: parseBoolean(
    process.env.TITECH_SAAS_BILLING_CANONICAL_WRITE_ENABLED,
    false
  ),

  /**
   * Explicit emergency rollback switch.
   *
   * When true, canonical writes are disabled regardless of the
   * canonicalWriteEnabled flag.
   */
  rollbackToLegacy: parseBoolean(
    process.env.TITECH_SAAS_BILLING_ROLLBACK_TO_LEGACY,
    false
  ),

  /**
   * Optional traffic sampling for shadow reads.
   *
   * Example:
   *   1     = 1%
   *   10    = 10%
   *   100   = 100%
   */
  shadowSampleRatePercent: parseNonNegativeNumber(
    process.env.TITECH_SAAS_BILLING_SHADOW_SAMPLE_RATE_PERCENT,
    0
  ),

  /**
   * Maximum duration allowed for a shadow operation before it is
   * recorded as a timeout/divergence without affecting the live request.
   */
  shadowTimeoutMs: parsePositiveInteger(
    process.env.TITECH_SAAS_BILLING_SHADOW_TIMEOUT_MS,
    5000
  ),

  /**
   * Maximum number of field-level differences recorded for a single
   * reconciliation result.
   */
  maxDifferencesPerResult: parsePositiveInteger(
    process.env.TITECH_SAAS_BILLING_MAX_DIFFERENCES,
    100
  ),

  /**
   * Canonical service paths can be overridden for local branches where
   * commercial services are placed differently.
   */
  canonicalSubscriptionServicePath: parseString(
    process.env.TITECH_CANONICAL_SUBSCRIPTION_SERVICE_PATH,
    ""
  ),

  canonicalTenantBillingServicePath: parseString(
    process.env.TITECH_CANONICAL_TENANT_BILLING_SERVICE_PATH,
    ""
  ),

  legacySubscriptionServicePath: parseString(
    process.env.TITECH_LEGACY_SUBSCRIPTION_SERVICE_PATH,
    "../modules/subscriptionService"
  ),

  legacyTenantBillingServicePath: parseString(
    process.env.TITECH_LEGACY_TENANT_BILLING_SERVICE_PATH,
    "../services/tenantBillingService"
  ),

  environment: parseString(
    process.env.NODE_ENV,
    "development"
  ),
});

/**
 * Validate dangerous runtime combinations.
 *
 * This function intentionally throws rather than silently accepting
 * contradictory deployment configuration.
 */
function validateStage01DConfiguration(
  runtimeConfig = config
) {
  if (!runtimeConfig.enabled) {
    return {
      valid: true,
      disabled: true,
      errors: [],
    };
  }

  const errors = [];

  if (
    runtimeConfig.canonicalWriteEnabled &&
    runtimeConfig.rollbackToLegacy
  ) {
    errors.push(
      "Canonical writes cannot be enabled while rollbackToLegacy is enabled."
    );
  }

  if (
    runtimeConfig.canonicalWriteEnabled &&
    !runtimeConfig.reconciliationEnabled
  ) {
    errors.push(
      "Canonical writes require reconciliationEnabled=true."
    );
  }

  if (
    runtimeConfig.canonicalWriteEnabled &&
    runtimeConfig.shadowSampleRatePercent < 100
  ) {
    errors.push(
      "Canonical writes require 100% shadow-read coverage."
    );
  }

  if (
    runtimeConfig.shadowSampleRatePercent > 100
  ) {
    errors.push(
      "shadowSampleRatePercent cannot exceed 100."
    );
  }

  if (runtimeConfig.shadowTimeoutMs < 100) {
    errors.push(
      "shadowTimeoutMs must be at least 100ms."
    );
  }

  if (errors.length > 0) {
    return {
      valid: false,
      disabled: false,
      errors,
    };
  }

  return {
    valid: true,
    disabled: false,
    errors: [],
  };
}

function isCanonicalWriteAllowed(
  runtimeConfig = config
) {
  const validation =
    validateStage01DConfiguration(
      runtimeConfig
    );

  return Boolean(
    validation.valid &&
    runtimeConfig.enabled &&
    runtimeConfig.canonicalWriteEnabled &&
    !runtimeConfig.rollbackToLegacy
  );
}

function shouldShadowRead(
  runtimeConfig = config,
  random = Math.random()
) {
  if (
    !runtimeConfig.enabled ||
    !runtimeConfig.shadowReadEnabled
  ) {
    return false;
  }

  if (
    runtimeConfig.shadowSampleRatePercent <= 0
  ) {
    return false;
  }

  if (
    runtimeConfig.shadowSampleRatePercent >= 100
  ) {
    return true;
  }

  const normalizedRandom =
    Number.isFinite(random)
      ? random
      : Math.random();

  return (
    normalizedRandom * 100 <
    runtimeConfig.shadowSampleRatePercent
  );
}

module.exports = {
  config,
  parseBoolean,
  parsePositiveInteger,
  parseNonNegativeNumber,
  validateStage01DConfiguration,
  isCanonicalWriteAllowed,
  shouldShadowRead,
};