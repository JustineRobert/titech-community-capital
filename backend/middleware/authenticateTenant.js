// ============================================================================
// TITech Community Capital
// File: backend/middleware/authenticateTenant.js
// Production Grade Multi-Tenant Authentication Middleware
// SaaS | Enterprise | API | USSD | Mobile Money | KYC/AML Ready
// ============================================================================

"use strict";

const crypto = require("crypto");

const logger = require("../utils/logger");
const tenantService = require("../services/tenantService");
const metricsService = require("../services/metricsService");

/**
 * Optional services. Middleware still works if they do not exist.
 */
let featureFlagService = null;
let cacheService = null;
let auditService = null;

try {
  featureFlagService = require(
    "../services/featureFlagService"
  );
} catch (_) {}

try {
  cacheService = require(
    "../services/cacheService"
  );
} catch (_) {}

try {
  auditService = require(
    "../services/auditService"
  );
} catch (_) {}

const CACHE_TTL =
  Number(
    process.env.TENANT_CACHE_TTL_SECONDS
  ) || 300;

const HEADER_KEYS = [
  "x-tenant-id",
  "x-tenant",
  "tenant-id",
];

const API_KEY_HEADERS = [
  "x-tenant-api-key",
  "x-api-key",
  "authorization",
];

class TenantAuthenticationError extends Error {
  constructor(
    message,
    statusCode = 401
  ) {
    super(message);

    this.name =
      "TenantAuthenticationError";

    this.statusCode =
      statusCode;
  }
}

/**
 * ============================================================================
 * Helpers
 * ============================================================================
 */

function sanitize(value) {
  if (!value) {
    return null;
  }

  return String(value).trim();
}

function extractBearer(
  authorization
) {
  if (!authorization) {
    return null;
  }

  const value =
    String(authorization);

  if (
    value.startsWith("Bearer ")
  ) {
    return value.substring(7);
  }

  return value;
}

function getCorrelationId(req) {
  return (
    req.correlationId ||
    req.requestId ||
    crypto.randomUUID()
  );
}

function getTenantId(req) {
  for (const header of HEADER_KEYS) {
    const value =
      sanitize(
        req.headers[header]
      );

    if (value) {
      return value;
    }
  }

  if (
    req.params &&
    req.params.tenantId
  ) {
    return sanitize(
      req.params.tenantId
    );
  }

  if (
    req.query &&
    req.query.tenantId
  ) {
    return sanitize(
      req.query.tenantId
    );
  }

  if (
    req.body &&
    req.body.tenantId
  ) {
    return sanitize(
      req.body.tenantId
    );
  }

  return null;
}

function getTenantApiKey(req) {
  for (const header of API_KEY_HEADERS) {
    const value =
      sanitize(
        req.headers[header]
      );

    if (!value) {
      continue;
    }

    if (
      header ===
      "authorization"
    ) {
      return extractBearer(
        value
      );
    }

    return value;
  }

  return null;
}

async function getCachedTenant(
  tenantId
) {
  if (
    !cacheService ||
    !tenantId
  ) {
    return null;
  }

  try {
    return await cacheService.get(
      `tenant:${tenantId}`
    );
  } catch (_) {
    return null;
  }
}

async function cacheTenant(
  tenant
) {
  if (
    !cacheService ||
    !tenant
  ) {
    return;
  }

  try {
    await cacheService.set(
      `tenant:${tenant.id}`,
      tenant,
      CACHE_TTL
    );
  } catch (_) {}
}

async function findTenant(
  tenantId
) {
  if (!tenantId) {
    return null;
  }

  const cached =
    await getCachedTenant(
      tenantId
    );

  if (cached) {
    return cached;
  }

  let tenant = null;

  if (
    typeof tenantService.findById ===
    "function"
  ) {
    tenant =
      await tenantService.findById(
        tenantId
      );
  } else if (
    typeof tenantService.getById ===
    "function"
  ) {
    tenant =
      await tenantService.getById(
        tenantId
      );
  }

  if (tenant) {
    await cacheTenant(
      tenant
    );
  }

  return tenant;
}

async function findTenantByApiKey(
  apiKey
) {
  if (!apiKey) {
    return null;
  }

  if (
    typeof tenantService.findByApiKey ===
    "function"
  ) {
    return tenantService.findByApiKey(
      apiKey
    );
  }

  if (
    typeof tenantService.getByApiKey ===
    "function"
  ) {
    return tenantService.getByApiKey(
      apiKey
    );
  }

  return null;
}

function isTenantActive(
  tenant
) {
  if (!tenant) {
    return false;
  }

  if (
    tenant.deletedAt
  ) {
    return false;
  }

  if (
    tenant.isDeleted === true
  ) {
    return false;
  }

  if (
    tenant.isSuspended === true
  ) {
    return false;
  }

  if (
    tenant.status &&
    [
      "inactive",
      "suspended",
      "disabled",
      "deleted",
    ].includes(
      String(
        tenant.status
      ).toLowerCase()
    )
  ) {
    return false;
  }

  return true;
}

async function validateSubscription(
  tenant
) {
  if (
    !featureFlagService ||
    !tenant
  ) {
    return true;
  }

  try {
    if (
      typeof featureFlagService.isTenantActive ===
      "function"
    ) {
      return await featureFlagService.isTenantActive(
        tenant.id
      );
    }

    return true;
  } catch (_) {
    return true;
  }
}

/**
 * ============================================================================
 * Middleware
 * ============================================================================
 */

async function authenticateTenant(
  req,
  res,
  next
) {
  const startedAt =
    Date.now();

  const correlationId =
    getCorrelationId(req);

  try {
    let tenant =
      null;

    const tenantId =
      getTenantId(req);

    const apiKey =
      getTenantApiKey(req);

    /**
     * ------------------------------------------------------------------------
     * Lookup order:
     * 1. Explicit tenant ID
     * 2. API Key
     * ------------------------------------------------------------------------
     */

    if (tenantId) {
      tenant =
        await findTenant(
          tenantId
        );
    }

    if (
      !tenant &&
      apiKey
    ) {
      tenant =
        await findTenantByApiKey(
          apiKey
        );
    }

    /**
     * ------------------------------------------------------------------------
     * USSD fallback
     * ------------------------------------------------------------------------
     */

    if (
      !tenant &&
      req.body?.serviceCode &&
      typeof tenantService.findByUSSDCode ===
        "function"
    ) {
      tenant =
        await tenantService.findByUSSDCode(
          req.body.serviceCode
        );
    }

    /**
     * ------------------------------------------------------------------------
     * Domain/Subdomain resolution
     * ------------------------------------------------------------------------
     */

    if (
      !tenant &&
      req.hostname &&
      typeof tenantService.findByDomain ===
        "function"
    ) {
      tenant =
        await tenantService.findByDomain(
          req.hostname
        );
    }

    if (!tenant) {
      throw new TenantAuthenticationError(
        "Tenant not found.",
        404
      );
    }

    if (
      !isTenantActive(
        tenant
      )
    ) {
      throw new TenantAuthenticationError(
        "Tenant is inactive.",
        403
      );
    }

    const subscriptionValid =
      await validateSubscription(
        tenant
      );

    if (
      !subscriptionValid
    ) {
      throw new TenantAuthenticationError(
        "Tenant subscription is inactive.",
        403
      );
    }

    /**
     * ------------------------------------------------------------------------
     * Attach context
     * ------------------------------------------------------------------------
     */

    req.tenant = tenant;
    req.tenantId =
      tenant.id;
    req.organizationId =
      tenant.organizationId ||
      tenant.id;

    if (!req.context) {
      req.context = {};
    }

    req.context.tenant =
      tenant;

    metricsService.increment(
      "tenant.authentication.success",
      1,
      {
        tenantId:
          tenant.id,
      }
    );

    metricsService.timing(
      "tenant.authentication.duration",
      Date.now() -
        startedAt,
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
            "TENANT_AUTHENTICATED",
          tenantId:
            tenant.id,
          correlationId,
          metadata: {
            path:
              req.originalUrl,
            method:
              req.method,
            ip:
              req.ip,
          },
        })
        .catch(() => {});
    }

    logger.debug(
      "Tenant authenticated",
      {
        tenantId:
          tenant.id,
        correlationId,
        path:
          req.originalUrl,
      }
    );

    return next();
  } catch (error) {
    const status =
      error.statusCode ||
      401;

    metricsService.increment(
      "tenant.authentication.failure"
    );

    logger.warn(
      "Tenant authentication failed",
      {
        message:
          error.message,
        correlationId,
        path:
          req.originalUrl,
        ip: req.ip,
      }
    );

    return res
      .status(status)
      .json({
        success: false,
        error:
          "TENANT_AUTHENTICATION_FAILED",
        message:
          error.message,
        correlationId,
        timestamp:
          new Date().toISOString(),
      });
  }
}

/**
 * ============================================================================
 * Optional Helpers
 * ============================================================================
 */

authenticateTenant.requirePlan =
  (...plans) =>
  async (
    req,
    res,
    next
  ) => {
    const plan =
      req.tenant?.plan;

    if (
      !plan ||
      !plans.includes(plan)
    ) {
      return res
        .status(403)
        .json({
          success: false,
          error:
            "PLAN_REQUIRED",
          message:
            `Requires one of: ${plans.join(
              ", "
            )}`,
        });
    }

    next();
  };

authenticateTenant.requireFeature =
  feature =>
  (
    req,
    res,
    next
  ) => {
    const features =
      req.tenant
        ?.features || [];

    if (
      !features.includes(
        feature
      )
    ) {
      return res
        .status(403)
        .json({
          success: false,
          error:
            "FEATURE_NOT_ENABLED",
          message: `${feature} is not enabled for this tenant.`,
        });
    }

    next();
  };

module.exports =
  authenticateTenant;