"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * STAGE 01D — SaaS Billing Behavioral Contract
 * backend/services/commercial/stage01dContract.js
 * ============================================================================
 *
 * This file defines the operations that must be behaviorally equivalent
 * before canonical SaaS billing writes can be enabled.
 *
 * The contract intentionally separates:
 *
 *   INPUT
 *   OUTPUT
 *   ERROR
 *   SIDE EFFECT EXPECTATION
 *
 * from implementation details.
 * ============================================================================
 */

const OPERATIONS = Object.freeze({
  GET_SUBSCRIPTION: "GET_SUBSCRIPTION",

  CREATE_SUBSCRIPTION:
    "CREATE_SUBSCRIPTION",

  UPGRADE_PLAN:
    "UPGRADE_PLAN",

  DOWNGRADE_PLAN:
    "DOWNGRADE_PLAN",

  CANCEL_SUBSCRIPTION:
    "CANCEL_SUBSCRIPTION",

  REACTIVATE_SUBSCRIPTION:
    "REACTIVATE_SUBSCRIPTION",

  CHECK_FEATURE_ACCESS:
    "CHECK_FEATURE_ACCESS",

  CHECK_USAGE_LIMIT:
    "CHECK_USAGE_LIMIT",

  CALCULATE_USAGE_CHARGES:
    "CALCULATE_USAGE_CHARGES",

  GENERATE_INVOICE:
    "GENERATE_INVOICE",

  MARK_INVOICE_PAID:
    "MARK_INVOICE_PAID",

  PROCESS_PAST_DUE:
    "PROCESS_PAST_DUE",

  VALIDATE_TENANT_ACCESS:
    "VALIDATE_TENANT_ACCESS",

  CALCULATE_MRR:
    "CALCULATE_MRR",
});

const OPERATION_CATEGORIES =
  Object.freeze({
    READ: new Set([
      OPERATIONS.GET_SUBSCRIPTION,
      OPERATIONS.CHECK_FEATURE_ACCESS,
      OPERATIONS.CHECK_USAGE_LIMIT,
      OPERATIONS.VALIDATE_TENANT_ACCESS,
      OPERATIONS.CALCULATE_MRR,
    ]),

    PURE_CALCULATION: new Set([
      OPERATIONS.CALCULATE_USAGE_CHARGES,
    ]),

    WRITE: new Set([
      OPERATIONS.CREATE_SUBSCRIPTION,
      OPERATIONS.UPGRADE_PLAN,
      OPERATIONS.DOWNGRADE_PLAN,
      OPERATIONS.CANCEL_SUBSCRIPTION,
      OPERATIONS.REACTIVATE_SUBSCRIPTION,
      OPERATIONS.GENERATE_INVOICE,
      OPERATIONS.MARK_INVOICE_PAID,
      OPERATIONS.PROCESS_PAST_DUE,
    ]),
  });

const REQUIRED_BEHAVIOR =
  Object.freeze({
    [OPERATIONS.GET_SUBSCRIPTION]:
      {
        required: false,
        legacyMethods: [
          "getSubscription",
          "getActiveSubscription",
        ],
        canonicalMethods: [
          "getSubscription",
          "getActiveSubscription",
          "getCurrentSubscription",
        ],
      },

    [OPERATIONS.CREATE_SUBSCRIPTION]:
      {
        required: true,
        legacyMethods: [
          "createSubscription",
        ],
        canonicalMethods: [
          "createSubscription",
        ],
      },

    [OPERATIONS.UPGRADE_PLAN]:
      {
        required: true,
        legacyMethods: [
          "upgradePlan",
          "upgradeSubscription",
          "changePlan",
        ],
        canonicalMethods: [
          "upgradePlan",
          "changePlan",
        ],
      },

    [OPERATIONS.DOWNGRADE_PLAN]:
      {
        required: true,
        legacyMethods: [
          "downgradePlan",
          "downgradeSubscription",
          "changePlan",
        ],
        canonicalMethods: [
          "downgradePlan",
          "changePlan",
        ],
      },

    [OPERATIONS.CANCEL_SUBSCRIPTION]:
      {
        required: true,
        legacyMethods: [
          "cancelSubscription",
        ],
        canonicalMethods: [
          "cancelSubscription",
        ],
      },

    [OPERATIONS.REACTIVATE_SUBSCRIPTION]:
      {
        required: false,
        legacyMethods: [
          "reactivateSubscription",
        ],
        canonicalMethods: [
          "reactivateSubscription",
          "restoreSubscription",
        ],
      },

    [OPERATIONS.CHECK_FEATURE_ACCESS]:
      {
        required: false,
        legacyMethods: [
          "checkFeatureAccess",
        ],
        canonicalMethods: [
          "checkFeatureAccess",
        ],
      },

    [OPERATIONS.CHECK_USAGE_LIMIT]:
      {
        required: false,
        legacyMethods: [
          "checkUsageLimit",
        ],
        canonicalMethods: [
          "checkUsageLimit",
        ],
      },

    [OPERATIONS.CALCULATE_USAGE_CHARGES]:
      {
        required: true,
        legacyMethods: [
          "calculateUsageCharges",
        ],
        canonicalMethods: [
          "calculateUsageCharges",
          "calculateUsage",
        ],
      },

    [OPERATIONS.GENERATE_INVOICE]:
      {
        required: true,
        legacyMethods: [
          "generateInvoice",
        ],
        canonicalMethods: [
          "generateInvoice",
        ],
      },

    [OPERATIONS.MARK_INVOICE_PAID]:
      {
        required: true,
        legacyMethods: [
          "markInvoicePaid",
        ],
        canonicalMethods: [
          "markInvoicePaid",
          "recordInvoicePayment",
        ],
      },

    [OPERATIONS.PROCESS_PAST_DUE]:
      {
        required: true,
        legacyMethods: [
          "processPastDueTenant",
        ],
        canonicalMethods: [
          "processPastDueTenant",
          "processPastDue",
        ],
      },

    [OPERATIONS.VALIDATE_TENANT_ACCESS]:
      {
        required: true,
        legacyMethods: [
          "validateTenantAccess",
        ],
        canonicalMethods: [
          "validateTenantAccess",
        ],
      },

    [OPERATIONS.CALCULATE_MRR]:
      {
        required: true,
        legacyMethods: [
          "calculateMRR",
        ],
        canonicalMethods: [
          "calculateMRR",
          "calculateMrr",
        ],
      },
  });

function getOperationDefinition(
  operation
) {
  const definition =
    REQUIRED_BEHAVIOR[operation];

  if (!definition) {
    throw new Error(
      `[TITech][Stage01D] Unknown billing operation "${operation}".`
    );
  }

  return definition;
}

function isWriteOperation(operation) {
  return OPERATION_CATEGORIES.WRITE.has(
    operation
  );
}

function isReadOperation(operation) {
  return OPERATION_CATEGORIES.READ.has(
    operation
  );
}

function isPureCalculation(operation) {
  return OPERATION_CATEGORIES.PURE_CALCULATION.has(
    operation
  );
}

function findCompatibleMethod(
  service,
  candidates
) {
  for (const methodName of candidates) {
    if (
      service &&
      typeof service[methodName] ===
        "function"
    ) {
      return methodName;
    }
  }

  return null;
}

function resolveOperationMethod(
  service,
  operation,
  side
) {
  const definition =
    getOperationDefinition(
      operation
    );

  const candidates =
    side === "legacy"
      ? definition.legacyMethods
      : definition.canonicalMethods;

  return findCompatibleMethod(
    service,
    candidates
  );
}

function validateOperationCoverage(
  service,
  side
) {
  const results = {};

  for (const operation of Object.values(
    OPERATIONS
  )) {
    const definition =
      getOperationDefinition(
        operation
      );

    const method =
      resolveOperationMethod(
        service,
        operation,
        side
      );

    results[operation] = {
      required: definition.required,
      method,
      implemented:
        Boolean(method),
      compliant:
        definition.required
          ? Boolean(method)
          : true,
    };
  }

  return results;
}

module.exports = {
  OPERATIONS,
  OPERATION_CATEGORIES,
  REQUIRED_BEHAVIOR,
  getOperationDefinition,
  isWriteOperation,
  isReadOperation,
  isPureCalculation,
  findCompatibleMethod,
  resolveOperationMethod,
  validateOperationCoverage,
};