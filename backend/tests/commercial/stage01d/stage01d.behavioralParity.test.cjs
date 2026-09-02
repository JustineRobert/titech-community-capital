"use strict";
//backend/tests/commercial/stage01d/stage01d.behavioralParity.test.cjs
const assert = require("node:assert/strict");
const test = require("node:test");

const {
  loadStage01DServices,
} = require("../../../services/commercial/stage01dServiceLoader");

const {
  OPERATIONS,
  validateOperationCoverage,
} = require("../../../services/commercial/stage01dContract");

const {
  Stage01DParityService,
} = require("../../../services/commercial/stage01dParityService");

const {
  config,
  validateStage01DConfiguration,
} = require("../../../config/saasBillingStage01d");

function buildSafeDependencies() {
  return {
    db: null,

    logger: {
      info() {},
      warn() {},
      error() {},
    },

    cache: null,

    queueService: null,

    auditService: null,

    metricsService: null,

    tenantBillingService: null,

    notificationService: null,

    featureFlagService: null,

    eventBus: null,

    outboxService: null,
  };
}

let loadedServices = null;

test(
  "STAGE 01D configuration is structurally valid",
  () => {
    const result =
      validateStage01DConfiguration(
        config
      );

    assert.equal(
      result.valid,
      true,
      result.errors.join("\n")
    );
  }
);

test(
  "STAGE 01D service loader resolves legacy services",
  () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    assert.ok(
      loadedServices.legacy.subscription,
      "Legacy SubscriptionService must resolve."
    );

    assert.ok(
      loadedServices.legacy.tenantBilling,
      "Legacy TenantBillingService must resolve."
    );
  }
);

test(
  "STAGE 01D service loader resolves canonical commercial services",
  () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    assert.ok(
      loadedServices.canonical.subscription,
      "Canonical commercial SubscriptionService must resolve."
    );

    assert.ok(
      loadedServices.canonical.tenantBilling,
      "Canonical commercial TenantBillingService must resolve."
    );
  }
);

test(
  "legacy SubscriptionService satisfies required parity coverage",
  () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const coverage =
      validateOperationCoverage(
        loadedServices.legacy.subscription,
        "legacy"
      );

    for (const [
      operation,
      result,
    ] of Object.entries(
      coverage
    )) {
      if (!result.required) {
        continue;
      }

      assert.equal(
        result.implemented,
        true,
        `Legacy service missing required operation ${operation}.`
      );
    }
  }
);

test(
  "canonical SubscriptionService satisfies required parity coverage",
  () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const coverage =
      validateOperationCoverage(
        loadedServices.canonical.subscription,
        "canonical"
      );

    for (const [
      operation,
      result,
    ] of Object.entries(
      coverage
    )) {
      if (!result.required) {
        continue;
      }

      assert.equal(
        result.implemented,
        true,
        `Canonical service missing required operation ${operation}.`
      );
    }
  }
);

test(
  "legacy TenantBillingService exposes core billing contract",
  () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const service =
      loadedServices.legacy.tenantBilling;

    for (const method of [
      "calculateUsageCharges",
      "generateInvoice",
      "markInvoicePaid",
      "processPastDueTenant",
      "validateTenantAccess",
      "calculateMRR",
    ]) {
      assert.equal(
        typeof service[method],
        "function",
        `Legacy TenantBillingService missing ${method}.`
      );
    }
  }
);

test(
  "canonical TenantBillingService exposes core billing contract",
  () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const service =
      loadedServices.canonical.tenantBilling;

    for (const method of [
      "generateInvoice",
      "calculateUsageCharges",
      "markInvoicePaid",
      "validateTenantAccess",
      "calculateMRR",
    ]) {
      assert.equal(
        typeof service[method],
        "function",
        `Canonical TenantBillingService missing ${method}.`
      );
    }
  }
);

test(
  "usage billing remains behaviorally comparable",
  async () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const parity =
      new Stage01DParityService({
        legacy:
          loadedServices.legacy
            .tenantBilling,

        canonical:
          loadedServices.canonical
            .tenantBilling,
      });

    const result =
      await parity.compareRead({
        operation:
          OPERATIONS.CALCULATE_USAGE_CHARGES,

        kwargs: {
          memberCount: 125,
          activeLoans: 12,
          apiCalls: 4000,
        },
      });

    assert.equal(
      result.comparable,
      true
    );

    assert.equal(
      result.equal,
      true,
      `Usage billing divergence:\n${JSON.stringify(
        result.differences,
        null,
        2
      )}`
    );
  }
);

test(
  "tenant access validation remains behaviorally comparable",
  async () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const parity =
      new Stage01DParityService({
        legacy:
          loadedServices.legacy
            .tenantBilling,

        canonical:
          loadedServices.canonical
            .tenantBilling,
      });

    const result =
      await parity.compareRead({
        operation:
          OPERATIONS.VALIDATE_TENANT_ACCESS,

        kwargs: {
          subscription: {
            status: "ACTIVE",
          },
        },
      });

    assert.equal(
      result.equal,
      true,
      JSON.stringify(
        result.differences,
        null,
        2
      )
    );
  }
);

test(
  "MRR calculation remains behaviorally comparable",
  async () => {
    loadedServices =
      loadedServices ||
      loadStage01DServices(
        buildSafeDependencies()
      );

    const subscriptions = [
      {
        status: "ACTIVE",
        billingInterval: "MONTHLY",
        amount: 50000,
      },
      {
        status: "ACTIVE",
        billingInterval: "YEARLY",
        amount: 1200000,
      },
      {
        status: "CANCELLED",
        billingInterval: "MONTHLY",
        amount: 100000,
      },
    ];

    const parity =
      new Stage01DParityService({
        legacy:
          loadedServices.legacy
            .tenantBilling,

        canonical:
          loadedServices.canonical
            .tenantBilling,
      });

    const result =
      await parity.compareRead({
        operation:
          OPERATIONS.CALCULATE_MRR,

        args: [
          subscriptions,
        ],
      });

    assert.equal(
      result.equal,
      true,
      JSON.stringify(
        result.differences,
        null,
        2
      )
    );
  }
);