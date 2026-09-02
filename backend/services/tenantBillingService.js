// ============================================================================
// File: backend/services/tenantBillingService.js
// Description: Multi-Tenant SaaS Billing Service
// Production Grade Version
// ============================================================================

const crypto = require("crypto");

const logger = require("../utils/logger");

// ============================================================================
// Constants
// ============================================================================

const BILLING_STATUS = {
  ACTIVE: "ACTIVE",
  TRIAL: "TRIAL",
  PAST_DUE: "PAST_DUE",
  SUSPENDED: "SUSPENDED",
  CANCELLED: "CANCELLED"
};

const BILLING_INTERVAL = {
  MONTHLY: "MONTHLY",
  YEARLY: "YEARLY"
};

const PLAN_CODES = {
  STARTER: "STARTER",
  GROWTH: "GROWTH",
  ENTERPRISE: "ENTERPRISE"
};

// ============================================================================
// SaaS Plans
// ============================================================================

const PLANS = {
  [PLAN_CODES.STARTER]: {
    code: PLAN_CODES.STARTER,
    name: "Starter",
    monthlyPrice: 50000,
    yearlyPrice: 500000,
    maxMembers: 500,
    maxLoans: 1000,
    maxUsers: 10
  },

  [PLAN_CODES.GROWTH]: {
    code: PLAN_CODES.GROWTH,
    name: "Growth",
    monthlyPrice: 150000,
    yearlyPrice: 1500000,
    maxMembers: 5000,
    maxLoans: 10000,
    maxUsers: 50
  },

  [PLAN_CODES.ENTERPRISE]: {
    code: PLAN_CODES.ENTERPRISE,
    name: "Enterprise",
    monthlyPrice: 500000,
    yearlyPrice: 5000000,
    maxMembers: Number.MAX_SAFE_INTEGER,
    maxLoans: Number.MAX_SAFE_INTEGER,
    maxUsers: Number.MAX_SAFE_INTEGER
  }
};

// ============================================================================
// Helpers
// ============================================================================

function generateId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function addYears(date, years) {
  const d = new Date(date);
  d.setFullYear(d.getFullYear() + years);
  return d;
}

function calculateBillingPeriod(startDate, interval) {
  const start = new Date(startDate);

  const end =
    interval === BILLING_INTERVAL.YEARLY
      ? addYears(start, 1)
      : addMonths(start, 1);

  return {
    startDate: start,
    endDate: end
  };
}

function validatePlan(planCode) {
  if (!PLANS[planCode]) {
    throw new Error(`Invalid plan: ${planCode}`);
  }
}

function getPlanPrice(planCode, interval) {
  validatePlan(planCode);

  const plan = PLANS[planCode];

  return interval === BILLING_INTERVAL.YEARLY
    ? plan.yearlyPrice
    : plan.monthlyPrice;
}

// ============================================================================
// Create Subscription
// ============================================================================

async function createSubscription({
  tenantId,
  planCode = PLAN_CODES.STARTER,
  billingInterval = BILLING_INTERVAL.MONTHLY,
  trialDays = 14,
  createdBy
}) {
  validatePlan(planCode);

  const subscriptionId =
    generateId("sub");

  const startDate = new Date();

  const trialEndsAt =
    new Date(
      Date.now() +
      trialDays * 24 * 60 * 60 * 1000
    );

  const billingPeriod =
    calculateBillingPeriod(
      trialEndsAt,
      billingInterval
    );

  const subscription = {
    id: subscriptionId,
    tenantId,
    planCode,
    billingInterval,

    status: BILLING_STATUS.TRIAL,

    amount:
      getPlanPrice(
        planCode,
        billingInterval
      ),

    trialEndsAt,

    currentPeriodStart:
      billingPeriod.startDate,

    currentPeriodEnd:
      billingPeriod.endDate,

    createdBy,
    createdAt: startDate,
    updatedAt: startDate
  };

  logger.info(
    "Tenant subscription created",
    {
      tenantId,
      subscriptionId,
      planCode
    }
  );

  return subscription;
}

// ============================================================================
// Upgrade Subscription
// ============================================================================

async function upgradeSubscription({
  tenantId,
  currentPlan,
  newPlan,
  billingInterval,
  upgradedBy
}) {
  validatePlan(currentPlan);
  validatePlan(newPlan);

  const oldPrice =
    getPlanPrice(
      currentPlan,
      billingInterval
    );

  const newPrice =
    getPlanPrice(
      newPlan,
      billingInterval
    );

  const priceDifference =
    newPrice - oldPrice;

  logger.info(
    "Subscription upgraded",
    {
      tenantId,
      currentPlan,
      newPlan,
      upgradedBy
    }
  );

  return {
    tenantId,
    previousPlan: currentPlan,
    newPlan,
    priceDifference,
    effectiveImmediately: true,
    upgradedAt: new Date()
  };
}

// ============================================================================
// Downgrade Subscription
// ============================================================================

async function downgradeSubscription({
  tenantId,
  currentPlan,
  newPlan,
  billingInterval,
  downgradedBy
}) {
  validatePlan(currentPlan);
  validatePlan(newPlan);

  logger.info(
    "Subscription downgrade scheduled",
    {
      tenantId,
      currentPlan,
      newPlan,
      downgradedBy
    }
  );

  return {
    tenantId,
    previousPlan: currentPlan,
    newPlan,
    effectiveNextCycle: true,
    downgradedAt: new Date()
  };
}

// ============================================================================
// Usage Billing
// ============================================================================

async function calculateUsageCharges({
  memberCount = 0,
  activeLoans = 0,
  apiCalls = 0
}) {
  let overage = 0;

  if (memberCount > 5000) {
    overage += (memberCount - 5000) * 50;
  }

  if (activeLoans > 10000) {
    overage += (activeLoans - 10000) * 25;
  }

  if (apiCalls > 100000) {
    overage +=
      Math.ceil(
        (apiCalls - 100000) / 1000
      ) * 100;
  }

  return {
    overageAmount: overage,
    memberCount,
    activeLoans,
    apiCalls
  };
}

// ============================================================================
// Invoice Generation
// ============================================================================

async function generateInvoice({
  tenantId,
  subscriptionId,
  planCode,
  billingInterval,
  usageCharges = 0
}) {
  const invoiceId =
    generateId("inv");

  const baseAmount =
    getPlanPrice(
      planCode,
      billingInterval
    );

  const total =
    baseAmount + usageCharges;

  const invoice = {
    invoiceId,
    tenantId,
    subscriptionId,

    amount: total,
    baseAmount,
    usageCharges,

    currency: "UGX",

    status: "PENDING",

    issuedAt: new Date(),

    dueDate:
      addMonths(
        new Date(),
        1
      )
  };

  logger.info(
    "Invoice generated",
    {
      invoiceId,
      tenantId,
      total
    }
  );

  return invoice;
}

// ============================================================================
// Billing Collection
// ============================================================================

async function markInvoicePaid({
  invoiceId,
  paymentReference,
  amount
}) {
  logger.info(
    "Invoice payment received",
    {
      invoiceId,
      paymentReference,
      amount
    }
  );

  return {
    invoiceId,
    status: "PAID",
    paidAt: new Date(),
    amount,
    paymentReference
  };
}

// ============================================================================
// Past Due Processing
// ============================================================================

async function processPastDueTenant({
  tenantId,
  daysPastDue
}) {
  let status =
    BILLING_STATUS.PAST_DUE;

  if (daysPastDue >= 30) {
    status =
      BILLING_STATUS.SUSPENDED;
  }

  logger.warn(
    "Past due tenant processed",
    {
      tenantId,
      daysPastDue,
      status
    }
  );

  return {
    tenantId,
    status,
    processedAt: new Date()
  };
}

// ============================================================================
// Tenant Access Validation
// ============================================================================

async function validateTenantAccess({
  subscription
}) {
  const allowed =
    ![
      BILLING_STATUS.SUSPENDED,
      BILLING_STATUS.CANCELLED
    ].includes(
      subscription.status
    );

  return {
    allowed,
    status:
      subscription.status
  };
}

// ============================================================================
// Analytics
// ============================================================================

async function calculateMRR(
  subscriptions = []
) {
  let total = 0;

  for (const subscription of subscriptions) {
    if (
      subscription.status ===
      BILLING_STATUS.ACTIVE
    ) {
      total +=
        subscription.billingInterval ===
        BILLING_INTERVAL.YEARLY
          ? subscription.amount / 12
          : subscription.amount;
    }
  }

  return {
    mrr: total,
    activeSubscriptions:
      subscriptions.length
  };
}

// ============================================================================
// Exports
// ============================================================================

module.exports = {
  BILLING_STATUS,
  BILLING_INTERVAL,
  PLAN_CODES,
  PLANS,

  createSubscription,
  upgradeSubscription,
  downgradeSubscription,

  calculateUsageCharges,

  generateInvoice,
  markInvoicePaid,

  processPastDueTenant,
  validateTenantAccess,

  calculateMRR
};
