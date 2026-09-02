"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Workflow Engine
 * ============================================================================
 *
 * File:
 * backend/modules/onboarding/onboarding.workflow.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Centralized, deterministic workflow engine for SACCO onboarding.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - Define onboarding lifecycle states
 * - Define valid state transitions
 * - Validate state transitions
 * - Determine workflow stage and progress
 * - Validate compliance readiness
 * - Validate mobile-money readiness
 * - Validate go-live readiness
 * - Generate audit events
 * - Expose status metadata
 * - Provide transition metadata
 *
 * Design Principles:
 * ----------------------------------------------------------------------------
 * - No database access
 * - No HTTP dependencies
 * - No side effects
 * - Deterministic
 * - Service-layer friendly
 * - Controller agnostic
 * - Multi-tenant safe
 * - Audit friendly
 * - Extensible for future workflow states
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * This module does NOT mutate SACCO documents.
 * The onboarding service remains responsible for persistence.
 * ============================================================================
 */

/**
 * ============================================================================
 * WORKFLOW STATES
 * ============================================================================
 */

const STATES = Object.freeze({
  DRAFT: "DRAFT",

  VERIFICATION: "VERIFICATION",

  KYC_PENDING: "KYC_PENDING",

  KYC_APPROVED: "KYC_APPROVED",

  SUBSCRIPTION: "SUBSCRIPTION",

  GO_LIVE_REVIEW: "GO_LIVE_REVIEW",

  LIVE: "LIVE",

  SUSPENDED: "SUSPENDED",

  REJECTED: "REJECTED"
});

/**
 * ============================================================================
 * TERMINAL STATES
 * ============================================================================
 *
 * These states represent workflows that cannot proceed normally.
 */

const TERMINAL_STATES = Object.freeze([
  STATES.REJECTED
]);

/**
 * ============================================================================
 * ACTIVE STATES
 * ============================================================================
 */

const ACTIVE_STATES = Object.freeze([
  STATES.DRAFT,
  STATES.VERIFICATION,
  STATES.KYC_PENDING,
  STATES.KYC_APPROVED,
  STATES.SUBSCRIPTION,
  STATES.GO_LIVE_REVIEW,
  STATES.LIVE,
  STATES.SUSPENDED
]);

/**
 * ============================================================================
 * WORKFLOW ORDER
 * ============================================================================
 *
 * This represents the normal onboarding path.
 *
 * DRAFT
 *   ↓
 * VERIFICATION
 *   ↓
 * KYC_PENDING
 *   ↓
 * KYC_APPROVED
 *   ↓
 * SUBSCRIPTION
 *   ↓
 * GO_LIVE_REVIEW
 *   ↓
 * LIVE
 *
 * REJECTED and SUSPENDED are lifecycle exceptions.
 */

const WORKFLOW_ORDER = Object.freeze([
  STATES.DRAFT,
  STATES.VERIFICATION,
  STATES.KYC_PENDING,
  STATES.KYC_APPROVED,
  STATES.SUBSCRIPTION,
  STATES.GO_LIVE_REVIEW,
  STATES.LIVE
]);

/**
 * ============================================================================
 * VALID STATE TRANSITIONS
 * ============================================================================
 *
 * Explicit transition graph.
 *
 * IMPORTANT:
 * ----------------------------------------------------------------------------
 * We do not use WORKFLOW_ORDER to determine transition permissions.
 * This prevents accidental state skipping.
 */

const TRANSITIONS = Object.freeze({
  [STATES.DRAFT]: Object.freeze([
    STATES.VERIFICATION,
    STATES.REJECTED
  ]),

  [STATES.VERIFICATION]: Object.freeze([
    STATES.KYC_PENDING,
    STATES.REJECTED
  ]),

  [STATES.KYC_PENDING]: Object.freeze([
    STATES.KYC_APPROVED,
    STATES.REJECTED
  ]),

  [STATES.KYC_APPROVED]: Object.freeze([
    STATES.SUBSCRIPTION,
    STATES.REJECTED
  ]),

  [STATES.SUBSCRIPTION]: Object.freeze([
    STATES.GO_LIVE_REVIEW,
    STATES.REJECTED
  ]),

  [STATES.GO_LIVE_REVIEW]: Object.freeze([
    STATES.LIVE,
    STATES.REJECTED
  ]),

  [STATES.LIVE]: Object.freeze([
    STATES.SUSPENDED
  ]),

  [STATES.SUSPENDED]: Object.freeze([
    STATES.LIVE,
    STATES.REJECTED
  ]),

  [STATES.REJECTED]: Object.freeze([])
});

/**
 * ============================================================================
 * TRANSITION METADATA
 * ============================================================================
 */

const TRANSITION_METADATA = Object.freeze({
  [`${STATES.DRAFT}->${STATES.VERIFICATION}`]: {
    action: "SUBMIT_FOR_VERIFICATION",
    requiresReason: false
  },

  [`${STATES.VERIFICATION}->${STATES.KYC_PENDING}`]: {
    action: "START_KYC",
    requiresReason: false
  },

  [`${STATES.KYC_PENDING}->${STATES.KYC_APPROVED}`]: {
    action: "APPROVE_KYC",
    requiresReason: false
  },

  [`${STATES.KYC_APPROVED}->${STATES.SUBSCRIPTION}`]: {
    action: "ACTIVATE_SUBSCRIPTION",
    requiresReason: false
  },

  [`${STATES.SUBSCRIPTION}->${STATES.GO_LIVE_REVIEW}`]: {
    action: "SUBMIT_GO_LIVE_REVIEW",
    requiresReason: false
  },

  [`${STATES.GO_LIVE_REVIEW}->${STATES.LIVE}`]: {
    action: "APPROVE_GO_LIVE",
    requiresReason: false
  },

  [`${STATES.LIVE}->${STATES.SUSPENDED}`]: {
    action: "SUSPEND_SACCO",
    requiresReason: true
  },

  [`${STATES.SUSPENDED}->${STATES.LIVE}`]: {
    action: "REINSTATE_SACCO",
    requiresReason: true
  },

  [`${STATES.DRAFT}->${STATES.REJECTED}`]: {
    action: "REJECT_APPLICATION",
    requiresReason: true
  },

  [`${STATES.VERIFICATION}->${STATES.REJECTED}`]: {
    action: "REJECT_APPLICATION",
    requiresReason: true
  },

  [`${STATES.KYC_PENDING}->${STATES.REJECTED}`]: {
    action: "REJECT_APPLICATION",
    requiresReason: true
  },

  [`${STATES.KYC_APPROVED}->${STATES.REJECTED}`]: {
    action: "REJECT_APPLICATION",
    requiresReason: true
  },

  [`${STATES.SUBSCRIPTION}->${STATES.REJECTED}`]: {
    action: "REJECT_APPLICATION",
    requiresReason: true
  },

  [`${STATES.GO_LIVE_REVIEW}->${STATES.REJECTED}`]: {
    action: "REJECT_APPLICATION",
    requiresReason: true
  },

  [`${STATES.SUSPENDED}->${STATES.REJECTED}`]: {
    action: "REJECT_SUSPENDED_SACCO",
    requiresReason: true
  }
});

/**
 * ============================================================================
 * STATE VALIDATION
 * ============================================================================
 */

const isValidState = (status) => {
  return Object.values(STATES).includes(status);
};

/**
 * ============================================================================
 * TRANSITION KEY
 * ============================================================================
 */

const getTransitionKey = (
  currentStatus,
  targetStatus
) => {
  return `${currentStatus}->${targetStatus}`;
};

/**
 * ============================================================================
 * CAN TRANSITION
 * ============================================================================
 */

const canTransition = (
  currentStatus,
  targetStatus
) => {
  if (
    !isValidState(currentStatus) ||
    !isValidState(targetStatus)
  ) {
    return false;
  }

  if (currentStatus === targetStatus) {
    return false;
  }

  const allowed =
    TRANSITIONS[currentStatus] || [];

  return allowed.includes(targetStatus);
};

/**
 * ============================================================================
 * GET ALLOWED TRANSITIONS
 * ============================================================================
 */

const getAllowedTransitions = (
  currentStatus
) => {
  if (!isValidState(currentStatus)) {
    return [];
  }

  return [
    ...(TRANSITIONS[currentStatus] || [])
  ];
};

/**
 * ============================================================================
 * GET TRANSITION METADATA
 * ============================================================================
 */

const getTransitionMetadata = (
  currentStatus,
  targetStatus
) => {
  if (
    !canTransition(
      currentStatus,
      targetStatus
    )
  ) {
    return null;
  }

  return (
    TRANSITION_METADATA[
      getTransitionKey(
        currentStatus,
        targetStatus
      )
    ] || {
      action: "STATUS_CHANGED",
      requiresReason: false
    }
  );
};

/**
 * ============================================================================
 * VALIDATE TRANSITION
 * ============================================================================
 *
 * Returns a structured result rather than throwing.
 *
 * This makes the engine reusable by:
 * - services
 * - controllers
 * - jobs
 * - workflow workers
 * - tests
 */

const validateTransition = (
  currentStatus,
  targetStatus,
  options = {}
) => {
  const {
    reason
  } = options;

  if (!isValidState(currentStatus)) {
    return {
      valid: false,
      code: "INVALID_CURRENT_STATE",
      message:
        `Invalid current onboarding state: ${currentStatus}`
    };
  }

  if (!isValidState(targetStatus)) {
    return {
      valid: false,
      code: "INVALID_TARGET_STATE",
      message:
        `Invalid target onboarding state: ${targetStatus}`
    };
  }

  if (currentStatus === targetStatus) {
    return {
      valid: false,
      code: "SAME_STATE_TRANSITION",
      message:
        "Current and target onboarding states are identical"
    };
  }

  if (
    TERMINAL_STATES.includes(
      currentStatus
    )
  ) {
    return {
      valid: false,
      code: "TERMINAL_STATE",
      message:
        `Onboarding workflow is already terminal: ${currentStatus}`
    };
  }

  if (
    !canTransition(
      currentStatus,
      targetStatus
    )
  ) {
    return {
      valid: false,
      code: "INVALID_TRANSITION",
      message:
        `Transition from ${currentStatus} to ${targetStatus} is not permitted`
    };
  }

  const metadata =
    getTransitionMetadata(
      currentStatus,
      targetStatus
    );

  if (
    metadata?.requiresReason &&
    (!reason ||
      typeof reason !== "string" ||
      !reason.trim())
  ) {
    return {
      valid: false,
      code: "REASON_REQUIRED",
      message:
        "A transition reason is required"
    };
  }

  return {
    valid: true,
    code: "VALID_TRANSITION",
    message: "Transition permitted",
    metadata
  };
};

/**
 * ============================================================================
 * ASSERT VALID TRANSITION
 * ============================================================================
 *
 * Useful inside service methods.
 *
 * Throws a normal Error with structured properties.
 * The application's centralized error middleware can map this appropriately.
 */

const assertValidTransition = (
  currentStatus,
  targetStatus,
  options = {}
) => {
  const result =
    validateTransition(
      currentStatus,
      targetStatus,
      options
    );

  if (!result.valid) {
    const error = new Error(
      result.message
    );

    error.code = result.code;
    error.currentStatus =
      currentStatus;
    error.targetStatus =
      targetStatus;

    throw error;
  }

  return result;
};

/**
 * ============================================================================
 * NEXT NORMAL WORKFLOW STEP
 * ============================================================================
 *
 * Unlike the old implementation, this never returns REJECTED or SUSPENDED
 * as the normal next onboarding step.
 */

const nextStep = (
  currentStatus
) => {
  const index =
    WORKFLOW_ORDER.indexOf(
      currentStatus
    );

  if (
    index === -1 ||
    index >=
      WORKFLOW_ORDER.length - 1
  ) {
    return null;
  }

  return WORKFLOW_ORDER[
    index + 1
  ];
};

/**
 * ============================================================================
 * PREVIOUS NORMAL WORKFLOW STEP
 * ============================================================================
 */

const previousStep = (
  currentStatus
) => {
  const index =
    WORKFLOW_ORDER.indexOf(
      currentStatus
    );

  if (index <= 0) {
    return null;
  }

  return WORKFLOW_ORDER[
    index - 1
  ];
};

/**
 * ============================================================================
 * STAGE NUMBER
 * ============================================================================
 */

const getStageNumber = (
  currentStatus
) => {
  const index =
    WORKFLOW_ORDER.indexOf(
      currentStatus
    );

  return index === -1
    ? 0
    : index + 1;
};

/**
 * ============================================================================
 * TOTAL WORKFLOW STAGES
 * ============================================================================
 */

const getTotalStages = () => {
  return WORKFLOW_ORDER.length;
};

/**
 * ============================================================================
 * PROGRESS %
 * ============================================================================
 */

const calculateProgress = (
  currentStatus
) => {
  const stage =
    getStageNumber(
      currentStatus
    );

  if (stage === 0) {
    return 0;
  }

  return Math.min(
    100,
    Math.round(
      (stage /
        WORKFLOW_ORDER.length) *
        100
    )
  );
};

/**
 * ============================================================================
 * CHECKLIST PROGRESS
 * ============================================================================
 */

const calculateChecklistProgress = (
  sacco
) => {
  const checklist =
    sacco?.onboardingChecklist || {};

  const keys = Object.keys(
    checklist
  );

  if (keys.length === 0) {
    return {
      completed: 0,
      total: 0,
      percentage: 0
    };
  }

  const completed =
    keys.filter(
      (key) => checklist[key] === true
    ).length;

  return {
    completed,
    total: keys.length,
    percentage: Math.round(
      (completed / keys.length) * 100
    )
  };
};

/**
 * ============================================================================
 * COMPLIANCE CHECK
 * ============================================================================
 *
 * This is deliberately deterministic.
 *
 * It does not call external KYC/AML providers.
 * Those integrations belong to dedicated services.
 */

const validateCompliance = (
  sacco
) => {
  const issues = [];

  if (!sacco) {
    return {
      compliant: false,
      issues: [
        "SACCO information is required"
      ]
    };
  }

  if (!sacco.registrationNumber) {
    issues.push(
      "Registration number missing"
    );
  }

  if (!sacco.tinNumber) {
    issues.push(
      "TIN number missing"
    );
  }

  if (!sacco.email) {
    issues.push(
      "SACCO email missing"
    );
  }

  if (!sacco.phone) {
    issues.push(
      "SACCO phone number missing"
    );
  }

  if (!sacco.contactPerson) {
    issues.push(
      "Contact person missing"
    );
  }

  if (
    !sacco.contactPerson?.fullName
  ) {
    issues.push(
      "Contact person name missing"
    );
  }

  if (
    !sacco.contactPerson?.phone
  ) {
    issues.push(
      "Contact person phone missing"
    );
  }

  if (
    !sacco.kycCompleted
  ) {
    issues.push(
      "KYC incomplete"
    );
  }

  if (
    sacco.complianceStatus &&
    sacco.complianceStatus !==
      "COMPLIANT"
  ) {
    issues.push(
      `Compliance status is ${sacco.complianceStatus}`
    );
  }

  if (
    !Array.isArray(
      sacco.documents
    ) ||
    sacco.documents.length === 0
  ) {
    issues.push(
      "Required KYC documents missing"
    );
  }

  const unverifiedDocuments =
    Array.isArray(sacco.documents)
      ? sacco.documents.filter(
          (document) =>
            document &&
            document.verified !== true
        )
      : [];

  if (
    unverifiedDocuments.length > 0
  ) {
    issues.push(
      `${unverifiedDocuments.length} KYC document(s) not verified`
    );
  }

  return {
    compliant:
      issues.length === 0,
    issues
  };
};

/**
 * ============================================================================
 * SUBSCRIPTION READINESS
 * ============================================================================
 */

const validateSubscription = (
  sacco
) => {
  const issues = [];

  if (!sacco?.subscription) {
    issues.push(
      "Subscription not configured"
    );

    return {
      ready: false,
      issues
    };
  }

  if (
    !sacco.subscription.plan
  ) {
    issues.push(
      "Subscription plan missing"
    );
  }

  if (
    !sacco.subscription.billingCycle
  ) {
    issues.push(
      "Subscription billing cycle missing"
    );
  }

  if (
    sacco.subscription.price ===
      undefined ||
    sacco.subscription.price ===
      null
  ) {
    issues.push(
      "Subscription price missing"
    );
  }

  if (
    sacco.subscription.active !== true
  ) {
    issues.push(
      "Subscription inactive"
    );
  }

  return {
    ready:
      issues.length === 0,
    issues
  };
};

/**
 * ============================================================================
 * MOBILE MONEY READINESS
 * ============================================================================
 *
 * Mobile money is optional for onboarding unless the SACCO has selected it.
 *
 * If mobileMoneyEnabled = true:
 * - at least one provider must be enabled
 * - the selected provider must have a collection account
 */

const validateMobileMoneySetup = (
  sacco
) => {
  const issues = [];

  if (!sacco) {
    return {
      ready: false,
      issues: [
        "SACCO information is required"
      ]
    };
  }

  if (
    sacco.mobileMoneyEnabled !== true
  ) {
    return {
      ready: true,
      optional: true,
      issues: []
    };
  }

  const mtnEnabled =
    sacco.mtnMomoEnabled === true;

  const airtelEnabled =
    sacco.airtelMoneyEnabled === true;

  if (
    !mtnEnabled &&
    !airtelEnabled
  ) {
    issues.push(
      "Mobile money is enabled but no provider is configured"
    );
  }

  if (
    mtnEnabled &&
    !sacco.mtnCollectionAccount
  ) {
    issues.push(
      "MTN MoMo collection account missing"
    );
  }

  if (
    airtelEnabled &&
    !sacco.airtelCollectionAccount
  ) {
    issues.push(
      "Airtel Money collection account missing"
    );
  }

  return {
    ready:
      issues.length === 0,
    optional: false,
    providers: {
      mtnMomo:
        mtnEnabled,
      airtelMoney:
        airtelEnabled
    },
    issues
  };
};

/**
 * ============================================================================
 * ADMIN CONFIGURATION CHECK
 * ============================================================================
 */

const validateAdminConfiguration = (
  sacco
) => {
  const issues = [];

  if (!sacco?.adminUser) {
    issues.push(
      "Admin user not configured"
    );
  } else {
    if (
      !sacco.adminUser.fullName
    ) {
      issues.push(
        "Admin user name missing"
      );
    }

    if (
      !sacco.adminUser.email
    ) {
      issues.push(
        "Admin user email missing"
      );
    }

    if (
      !sacco.adminUser.phone
    ) {
      issues.push(
        "Admin user phone missing"
      );
    }
  }

  if (
    !sacco?.onboardingChecklist
      ?.adminCreated
  ) {
    issues.push(
      "Admin account creation incomplete"
    );
  }

  return {
    ready:
      issues.length === 0,
    issues
  };
};

/**
 * ============================================================================
 * TENANT CONFIGURATION CHECK
 * ============================================================================
 */

const validateTenantConfiguration = (
  sacco
) => {
  const issues = [];

  if (!sacco?.tenantId) {
    issues.push(
      "Tenant ID missing"
    );
  }

  if (
    !sacco?.tenantSettings
  ) {
    issues.push(
      "Tenant settings not configured"
    );
  } else {
    if (
      !sacco.tenantSettings.subdomain
    ) {
      issues.push(
        "Tenant subdomain missing"
      );
    }

    if (
      !sacco.tenantSettings.timezone
    ) {
      issues.push(
        "Tenant timezone missing"
      );
    }

    if (
      !sacco.tenantSettings.defaultCurrency
    ) {
      issues.push(
        "Tenant default currency missing"
      );
    }
  }

  if (
    !sacco?.onboardingChecklist
      ?.tenantSetupCompleted
  ) {
    issues.push(
      "Tenant setup incomplete"
    );
  }

  return {
    ready:
      issues.length === 0,
    issues
  };
};

/**
 * ============================================================================
 * GO-LIVE REVIEW CHECK
 * ============================================================================
 */

const validateGoLiveReview = (
  sacco
) => {
  const issues = [];

  const compliance =
    validateCompliance(
      sacco
    );

  if (
    !compliance.compliant
  ) {
    issues.push(
      ...compliance.issues
    );
  }

  const subscription =
    validateSubscription(
      sacco
    );

  if (
    !subscription.ready
  ) {
    issues.push(
      ...subscription.issues
    );
  }

  const admin =
    validateAdminConfiguration(
      sacco
    );

  if (!admin.ready) {
    issues.push(
      ...admin.issues
    );
  }

  const tenant =
    validateTenantConfiguration(
      sacco
    );

  if (!tenant.ready) {
    issues.push(
      ...tenant.issues
    );
  }

  if (
    !sacco?.contactPerson
  ) {
    issues.push(
      "Contact person missing"
    );
  }

  if (
    !sacco?.onboardingChecklist
      ?.registrationCompleted
  ) {
    issues.push(
      "Registration completion pending"
    );
  }

  if (
    !sacco?.onboardingChecklist
      ?.subscriptionCompleted
  ) {
    issues.push(
      "Subscription completion pending"
    );
  }

  return {
    readyForReview:
      issues.length === 0,
    issues,

    checks: {
      compliance,
      subscription,
      admin,
      tenant
    }
  };
};

/**
 * ============================================================================
 * FINAL GO-LIVE VALIDATION
 * ============================================================================
 */

const validateGoLive = (
  sacco
) => {
  const review =
    validateGoLiveReview(
      sacco
    );

  if (
    !review.readyForReview
  ) {
    return {
      isReady: false,
      issues: review.issues,
      checks: review.checks
    };
  }

  const issues = [];

  const checklist =
    sacco?.onboardingChecklist ||
    {};

  if (
    checklist.trainingCompleted !==
    true
  ) {
    issues.push(
      "Training incomplete"
    );
  }

  if (
    checklist.mobileMoneyConfigured !==
    true &&
    sacco.mobileMoneyEnabled === true
  ) {
    issues.push(
      "Mobile money configuration incomplete"
    );
  }

  if (
    checklist.goLiveApproved !==
    true
  ) {
    issues.push(
      "Go-live approval pending"
    );
  }

  const mobileMoney =
    validateMobileMoneySetup(
      sacco
    );

  if (
    !mobileMoney.ready
  ) {
    issues.push(
      ...mobileMoney.issues
    );
  }

  return {
    isReady:
      issues.length === 0,
    issues,
    checks: {
      ...review.checks,
      mobileMoney
    }
  };
};

/**
 * ============================================================================
 * ONBOARDING READINESS SUMMARY
 * ============================================================================
 *
 * Provides a single dashboard-friendly object.
 */

const getReadinessSummary = (
  sacco
) => {
  const compliance =
    validateCompliance(
      sacco
    );

  const subscription =
    validateSubscription(
      sacco
    );

  const mobileMoney =
    validateMobileMoneySetup(
      sacco
    );

  const admin =
    validateAdminConfiguration(
      sacco
    );

  const tenant =
    validateTenantConfiguration(
      sacco
    );

  const goLive =
    validateGoLive(
      sacco
    );

  const checklist =
    calculateChecklistProgress(
      sacco
    );

  return {
    status:
      sacco?.status || null,

    stage:
      getStageNumber(
        sacco?.status
      ),

    totalStages:
      getTotalStages(),

    workflowProgress:
      calculateProgress(
        sacco?.status
      ),

    checklistProgress:
      checklist,

    readyForGoLive:
      goLive.isReady,

    compliance,
    subscription,
    mobileMoney,
    admin,
    tenant,
    goLive
  };
};

/**
 * ============================================================================
 * STATUS METADATA
 * ============================================================================
 */

const STATUS_METADATA = Object.freeze({
  [STATES.DRAFT]: {
    label: "Draft",
    color: "secondary",
    risk: "LOW",
    category: "ONBOARDING"
  },

  [STATES.VERIFICATION]: {
    label: "Verification",
    color: "primary",
    risk: "LOW",
    category: "ONBOARDING"
  },

  [STATES.KYC_PENDING]: {
    label: "KYC Pending",
    color: "warning",
    risk: "MEDIUM",
    category: "COMPLIANCE"
  },

  [STATES.KYC_APPROVED]: {
    label: "KYC Approved",
    color: "success",
    risk: "LOW",
    category: "COMPLIANCE"
  },

  [STATES.SUBSCRIPTION]: {
    label: "Subscription",
    color: "info",
    risk: "LOW",
    category: "COMMERCIAL"
  },

  [STATES.GO_LIVE_REVIEW]: {
    label: "Go-Live Review",
    color: "info",
    risk: "MEDIUM",
    category: "OPERATIONS"
  },

  [STATES.LIVE]: {
    label: "Live",
    color: "success",
    risk: "LOW",
    category: "OPERATIONS"
  },

  [STATES.SUSPENDED]: {
    label: "Suspended",
    color: "danger",
    risk: "HIGH",
    category: "OPERATIONS"
  },

  [STATES.REJECTED]: {
    label: "Rejected",
    color: "dark",
    risk: "HIGH",
    category: "ONBOARDING"
  }
});

/**
 * ============================================================================
 * GET STATUS METADATA
 * ============================================================================
 */

const getStatusMetadata = (
  status
) => {
  return (
    STATUS_METADATA[status] || {
      label: "Unknown",
      color: "secondary",
      risk: "UNKNOWN",
      category: "UNKNOWN"
    }
  );
};

/**
 * ============================================================================
 * AUDIT EVENT GENERATOR
 * ============================================================================
 *
 * Audit event contains enough information for:
 * - audit logs
 * - event publishing
 * - compliance review
 * - operational dashboards
 * - workflow history
 */

const generateAuditEvent = ({
  saccoId,
  tenantId,
  previousStatus,
  newStatus,
  userId,
  reason = null,
  metadata = {}
}) => {
  const transition =
    getTransitionMetadata(
      previousStatus,
      newStatus
    );

  return {
    entity: "SACCO",

    entityId:
      saccoId,

    tenantId:
      tenantId || null,

    action:
      transition?.action ||
      "STATUS_CHANGED",

    eventType:
      "SACCO_ONBOARDING_STATUS_CHANGED",

    before: {
      status:
        previousStatus
    },

    after: {
      status:
        newStatus
    },

    transition: {
      from:
        previousStatus,
      to:
        newStatus
    },

    performedBy:
      userId || null,

    reason,

    metadata,

    timestamp:
      new Date()
  };
};

/**
 * ============================================================================
 * WORKFLOW SNAPSHOT
 * ============================================================================
 *
 * Useful for audit/event payloads and dashboard APIs.
 */

const getWorkflowSnapshot = (
  sacco
) => {
  const status =
    sacco?.status || null;

  return {
    status,

    metadata:
      getStatusMetadata(
        status
      ),

    stage:
      getStageNumber(
        status
      ),

    totalStages:
      getTotalStages(),

    progress:
      calculateProgress(
        status
      ),

    nextStep:
      nextStep(
        status
      ),

    previousStep:
      previousStep(
        status
      ),

    allowedTransitions:
      getAllowedTransitions(
        status
      ),

    readiness:
      getReadinessSummary(
        sacco
      )
  };
};

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = {
  STATES,

  TERMINAL_STATES,

  ACTIVE_STATES,

  WORKFLOW_ORDER,

  TRANSITIONS,

  TRANSITION_METADATA,

  STATUS_METADATA,

  isValidState,

  canTransition,

  validateTransition,

  assertValidTransition,

  getAllowedTransitions,

  getTransitionMetadata,

  nextStep,

  previousStep,

  getStageNumber,

  getTotalStages,

  calculateProgress,

  calculateChecklistProgress,

  validateCompliance,

  validateSubscription,

  validateMobileMoneySetup,

  validateAdminConfiguration,

  validateTenantConfiguration,

  validateGoLiveReview,

  validateGoLive,

  getReadinessSummary,

  getStatusMetadata,

  generateAuditEvent,

  getWorkflowSnapshot
};