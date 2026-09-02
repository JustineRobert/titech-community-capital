// ============================================================================
// TITech Community Capital
// File: backend/middleware/featureGuard.js
// Production Grade Feature Guard Middleware
// Multi-Tenant | SaaS | Enterprise Licensing | Feature Flags
// ============================================================================

"use strict";

const logger = require("../utils/logger");
const metricsService = require("../services/metricsService");

let featureFlagService = null;
let auditService = null;
let cacheService = null;

try {
  featureFlagService = require(
    "../services/featureFlagService"
  );
} catch (_) {}

try {
  auditService = require(
    "../services/auditService"
  );
} catch (_) {}

try {
  cacheService = require(
    "../services/cacheService"
  );
} catch (_) {}

const CACHE_TTL =
  Number(
    process.env.FEATURE_CACHE_TTL_SECONDS
  ) || 300;

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function toArray(features) {
  if (!features) {
    return [];
  }

  if (Array.isArray(features)) {
    return features;
  }

  return [features];
}

function normalizeFeature(feature) {
  return String(feature)
    .trim()
    .toLowerCase();
}

function getTenant(req) {
  return (
    req.tenant ||
    req.context?.tenant
  );
}

async function getCachedFeature(
  tenantId,
  feature
) {
  if (!cacheService) {
    return null;
  }

  try {
    return await cacheService.get(
      `feature:${tenantId}:${feature}`
    );
  } catch (_) {
    return null;
  }
}

async function cacheFeature(
  tenantId,
  feature,
  value
) {
  if (!cacheService) {
    return;
  }

  try {
    await cacheService.set(
      `feature:${tenantId}:${feature}`,
      value,
      CACHE_TTL
    );
  } catch (_) {}
}

async function isFeatureEnabled(
  tenant,
  feature
) {
  const tenantId =
    tenant.id;

  const normalized =
    normalizeFeature(
      feature
    );

  const cached =
    await getCachedFeature(
      tenantId,
      normalized
    );

  if (
    cached !== null &&
    cached !== undefined
  ) {
    return cached;
  }

  let enabled =
    Array.isArray(
      tenant.features
    ) &&
    tenant.features
      .map(
        normalizeFeature
      )
      .includes(
        normalized
      );

  /**
   * External Feature Flag Service
   */
  if (
    featureFlagService &&
    typeof featureFlagService.isEnabled ===
      "function"
  ) {
    try {
      enabled =
        await featureFlagService.isEnabled(
          normalized,
          tenantId,
          enabled
        );
    } catch (error) {
      logger.error(
        "Feature service lookup failed",
        {
          tenantId,
          feature:
            normalized,
          error:
            error.message,
        }
      );
    }
  }

  await cacheFeature(
    tenantId,
    normalized,
    enabled
  );

  return enabled;
}

/**
 * ============================================================================
 * Main Middleware Factory
 * ============================================================================
 *
 * Usage:
 *
 * router.use(featureGuard("loans"));
 * router.use(featureGuard(["kyc","aml"], { requireAll: true }));
 * router.use(featureGuard("mobile_money"));
 *
 */

function featureGuard(
  features,
  options = {}
) {
  const required =
    toArray(features).map(
      normalizeFeature
    );

  const requireAll =
    options.requireAll ===
    true;

  const allowSuperAdmin =
    options.allowSuperAdmin !==
    false;

  const customMessage =
    options.message;

  return async function (
    req,
    res,
    next
  ) {
    const startedAt =
      Date.now();

    try {
      const tenant =
        getTenant(req);

      if (!tenant) {
        return res
          .status(401)
          .json({
            success: false,
            error:
              "TENANT_NOT_AUTHENTICATED",
            message:
              "Tenant authentication required.",
          });
      }

      /**
       * ------------------------------------------------------------
       * Super Admin Bypass
       * ------------------------------------------------------------
       */

      if (
        allowSuperAdmin &&
        req.user?.isSuperAdmin
      ) {
        return next();
      }

      const checks =
        await Promise.all(
          required.map(
            feature =>
              isFeatureEnabled(
                tenant,
                feature
              )
          )
        );

      const enabled =
        requireAll
          ? checks.every(
              Boolean
            )
          : checks.some(
              Boolean
            );

      metricsService.timing(
        "feature_guard.duration",
        Date.now() -
          startedAt,
        {
          tenantId:
            tenant.id,
        }
      );

      if (!enabled) {
        metricsService.increment(
          "feature_guard.denied",
          1,
          {
            tenantId:
              tenant.id,
          }
        );

        if (
          auditService &&
          typeof auditService.log ===
            "function"
        ) {
          auditService
            .log({
              action:
                "FEATURE_ACCESS_DENIED",
              tenantId:
                tenant.id,
              userId:
                req.user?.id,
              metadata: {
                features:
                  required,
                path:
                  req.originalUrl,
                method:
                  req.method,
              },
            })
            .catch(
              () => {}
            );
        }

        logger.warn(
          "Feature access denied",
          {
            tenantId:
              tenant.id,
            features:
              required,
            path:
              req.originalUrl,
          }
        );

        return res
          .status(403)
          .json({
            success: false,
            error:
              "FEATURE_NOT_ENABLED",
            message:
              customMessage ||
              "Required feature is not enabled for this tenant.",
            requiredFeatures:
              required,
            tenantId:
              tenant.id,
          });
      }

      metricsService.increment(
        "feature_guard.allowed",
        1,
        {
          tenantId:
            tenant.id,
        }
      );

      /**
       * Expose to downstream middleware
       */
      req.enabledFeatures =
        tenant.features ||
        [];

      req.featureAccess = {
        granted: true,
        features:
          required,
      };

      return next();
    } catch (error) {
      logger.error(
        "Feature guard failed",
        {
          error:
            error.message,
          stack:
            error.stack,
          path:
            req.originalUrl,
        }
      );

      metricsService.increment(
        "feature_guard.errors"
      );

      return res
        .status(500)
        .json({
          success: false,
          error:
            "FEATURE_GUARD_ERROR",
          message:
            "Unable to evaluate feature access.",
        });
    }
  };
}

/**
 * ============================================================================
 * Helper Middleware
 * ============================================================================
 */

featureGuard.requireAny =
  (...features) =>
    featureGuard(
      features,
      {
        requireAll:
          false,
      }
    );

featureGuard.requireAll =
  (...features) =>
    featureGuard(
      features,
      {
        requireAll:
          true,
      }
    );

/**
 * ============================================================================
 * Express Helper
 * ============================================================================
 */

featureGuard.attachHelpers =
  function (
    req,
    res,
    next
  ) {
    const tenant =
      getTenant(req);

    req.hasFeature =
      feature =>
        tenant?.features?.includes(
          feature
        ) || false;

    req.hasAllFeatures =
      (...features) =>
        features.every(
          feature =>
            req.hasFeature(
              feature
            )
        );

    req.hasAnyFeature =
      (...features) =>
        features.some(
          feature =>
            req.hasFeature(
              feature
            )
        );

    next();
  };

/**
 * ============================================================================
 * Utilities
 * ============================================================================
 */

featureGuard.isEnabled =
  async function (
    tenant,
    feature
  ) {
    return isFeatureEnabled(
      tenant,
      feature
    );
  };

featureGuard.normalizeFeature =
  normalizeFeature;

/**
 * ============================================================================
 * Export
 * ============================================================================
 */

module.exports =
  featureGuard;