"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * STAGE 01D — Commercial Billing Service Loader
 * backend/services/commercial/stage01dServiceLoader.js
 * ============================================================================
 *
 * Purpose:
 *   Resolve legacy and canonical billing services without hard-coding one
 *   directory layout into the reconciliation engine.
 *
 * Design:
 *   - explicit environment override wins
 *   - known TITech candidate locations follow
 *   - service capabilities are validated
 *   - failures are explicit
 * ============================================================================
 */

const path = require("path");

const {
  config,
} = require("../../config/saasBillingStage01d");

function normalizeModuleExport(moduleValue) {
  if (!moduleValue) {
    return moduleValue;
  }

  if (
    moduleValue.default &&
    typeof moduleValue.default === "object"
  ) {
    return moduleValue.default;
  }

  return moduleValue;
}

function loadModule(
  modulePath,
  label
) {
  if (!modulePath) {
    throw new Error(
      `[TITech][Stage01D] ${label} module path is empty.`
    );
  }

  try {
    return normalizeModuleExport(
      require(modulePath)
    );
  } catch (error) {
    const wrapped =
      new Error(
        `[TITech][Stage01D] Failed to load ${label} from "${modulePath}". ${error.message}`
      );

    wrapped.code =
      "STAGE_01D_SERVICE_LOAD_FAILED";

    wrapped.cause = error;

    throw wrapped;
  }
}

function buildCandidates({
  explicitPath,
  candidates,
}) {
  const ordered = [];

  if (explicitPath) {
    ordered.push(explicitPath);
  }

  for (const candidate of candidates) {
    if (
      candidate &&
      !ordered.includes(candidate)
    ) {
      ordered.push(candidate);
    }
  }

  return ordered;
}

function resolveFirstLoadable(
  candidates,
  label
) {
  const errors = [];

  for (const candidate of candidates) {
    try {
      const service =
        loadModule(
          candidate,
          label
        );

      return {
        service,
        resolvedPath: candidate,
      };
    } catch (error) {
      errors.push({
        path: candidate,
        message: error.message,
      });
    }
  }

  const error =
    new Error(
      `[TITech][Stage01D] Unable to resolve ${label}. Tried: ${candidates.join(
        ", "
      )}`
    );

  error.code =
    "STAGE_01D_SERVICE_NOT_FOUND";

  error.attempts =
    errors;

  throw error;
}

function loadLegacySubscriptionService() {
  const candidates =
    buildCandidates({
      explicitPath:
        config.legacySubscriptionServicePath,

      candidates: [
        "../modules/subscriptionService",
        "../../modules/subscriptionService",
        "../services/subscriptionService",
        "../../services/subscriptionService",
      ],
    });

  return resolveFirstLoadable(
    candidates,
    "legacy SubscriptionService"
  );
}

function loadLegacyTenantBillingService() {
  const candidates =
    buildCandidates({
      explicitPath:
        config.legacyTenantBillingServicePath,

      candidates: [
        "../services/tenantBillingService",
        "../../services/tenantBillingService",
        "../modules/tenantBillingService",
        "../../modules/tenantBillingService",
      ],
    });

  return resolveFirstLoadable(
    candidates,
    "legacy TenantBillingService"
  );
}

function loadCanonicalSubscriptionService() {
  const candidates =
    buildCandidates({
      explicitPath:
        config.canonicalSubscriptionServicePath,

      candidates: [
        "./subscriptionService",
        "./subscriptionService.js",
        "./canonicalSubscriptionService",
        "./canonicalSubscriptionService.js",
        "../../modules/commercial/subscriptionService",
        "../../modules/commercial/subscriptionService.js",
        "../../services/commercial/subscriptionService",
        "../../services/commercial/subscriptionService.js",
        "../../services/commercial/canonicalSubscriptionService",
        "../../services/commercial/canonicalSubscriptionService.js",
      ],
    });

  return resolveFirstLoadable(
    candidates,
    "canonical commercial SubscriptionService"
  );
}

function loadCanonicalTenantBillingService() {
  const candidates =
    buildCandidates({
      explicitPath:
        config.canonicalTenantBillingServicePath,

      candidates: [
        "./tenantBillingService",
        "./tenantBillingService.js",
        "./canonicalTenantBillingService",
        "./canonicalTenantBillingService.js",
        "../../modules/commercial/tenantBillingService",
        "../../modules/commercial/tenantBillingService.js",
        "../../services/commercial/tenantBillingService",
        "../../services/commercial/tenantBillingService.js",
        "../../services/commercial/canonicalTenantBillingService",
        "../../services/commercial/canonicalTenantBillingService.js",
      ],
    });

  return resolveFirstLoadable(
    candidates,
    "canonical commercial TenantBillingService"
  );
}

function listMethods(service) {
  if (!service) {
    return [];
  }

  const methods = new Set();

  let current = service;

  while (current) {
    for (
      const name of Object.getOwnPropertyNames(
        current
      )
    ) {
      if (
        name !== "constructor" &&
        typeof service[name] ===
          "function"
      ) {
        methods.add(name);
      }
    }

    current =
      Object.getPrototypeOf(
        current
      );
  }

  return Array.from(methods).sort();
}

function inspectService(
  service,
  metadata = {}
) {
  return {
    ...metadata,
    type:
      service?.constructor?.name ||
      typeof service,

    methods:
      listMethods(service),

    loaded:
      Boolean(service),
  };
}

function instantiateService(
  ServiceExport,
  dependencies = {}
) {
  if (
    typeof ServiceExport !==
    "function"
  ) {
    return ServiceExport;
  }

  try {
    return new ServiceExport(
      dependencies
    );
  } catch (error) {
    const wrapped =
      new Error(
        `[TITech][Stage01D] Failed to instantiate service "${ServiceExport.name}". ${error.message}`
      );

    wrapped.code =
      "STAGE_01D_SERVICE_INSTANTIATION_FAILED";

    wrapped.cause = error;

    throw wrapped;
  }
}

function loadStage01DServices(
  dependencies = {}
) {
  const legacySubscription =
    loadLegacySubscriptionService();

  const legacyTenantBilling =
    loadLegacyTenantBillingService();

  const canonicalSubscription =
    loadCanonicalSubscriptionService();

  const canonicalTenantBilling =
    loadCanonicalTenantBillingService();

  return {
    legacy: {
      subscription: legacySubscription.service,
      subscriptionPath:
        legacySubscription.resolvedPath,

      tenantBilling:
        legacyTenantBilling.service,

      tenantBillingPath:
        legacyTenantBilling.resolvedPath,
    },

    canonical: {
      subscription:
        instantiateService(
          canonicalSubscription.service,
          dependencies
        ),

      subscriptionPath:
        canonicalSubscription.resolvedPath,

      tenantBilling:
        instantiateService(
          canonicalTenantBilling.service,
          dependencies
        ),

      tenantBillingPath:
        canonicalTenantBilling.resolvedPath,
    },
  };
}

module.exports = {
  loadModule,
  loadStage01DServices,
  loadLegacySubscriptionService,
  loadLegacyTenantBillingService,
  loadCanonicalSubscriptionService,
  loadCanonicalTenantBillingService,
  listMethods,
  inspectService,
  instantiateService,
};