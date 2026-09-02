"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Service
 * ============================================================================
 *
 * File:
 * backend/modules/onboarding/onboarding.service.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Enterprise orchestration layer for SACCO onboarding.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - SACCO registration
 * - Tenant isolation
 * - Onboarding lifecycle transitions
 * - KYC approval
 * - Subscription setup
 * - Document management
 * - Go-live readiness
 * - Rejection
 * - Suspension / restoration
 * - Pagination
 * - Metrics
 *
 * Architectural Rule:
 * ----------------------------------------------------------------------------
 * Controllers MUST NOT implement onboarding business rules.
 *
 * Controllers
 *     ↓
 * Onboarding Service
 *     ↓
 * SACCO Model / Repository
 *
 * Financial operations MUST NOT be implemented here.
 * ============================================================================
 */

const mongoose = require("mongoose");

const Sacco = require("./onboarding.model");

const {
  NotFoundError,
  BadRequestError,
} = require("../../shared/errors");

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const STATUS = Object.freeze({
  DRAFT: "DRAFT",
  VERIFICATION: "VERIFICATION",
  KYC_PENDING: "KYC_PENDING",
  KYC_APPROVED: "KYC_APPROVED",
  SUBSCRIPTION: "SUBSCRIPTION",
  LIVE: "LIVE",
  SUSPENDED: "SUSPENDED",
  REJECTED: "REJECTED",
});

const COMPLIANCE_STATUS = Object.freeze({
  PENDING: "PENDING",
  UNDER_REVIEW: "UNDER_REVIEW",
  COMPLIANT: "COMPLIANT",
  NON_COMPLIANT: "NON_COMPLIANT",
});

const ALLOWED_STATUS_TRANSITIONS = Object.freeze({
  DRAFT: [
    STATUS.VERIFICATION,
    STATUS.KYC_PENDING,
    STATUS.REJECTED,
  ],

  VERIFICATION: [
    STATUS.KYC_PENDING,
    STATUS.REJECTED,
  ],

  KYC_PENDING: [
    STATUS.KYC_APPROVED,
    STATUS.REJECTED,
  ],

  KYC_APPROVED: [
    STATUS.SUBSCRIPTION,
    STATUS.REJECTED,
  ],

  SUBSCRIPTION: [
    STATUS.LIVE,
    STATUS.REJECTED,
  ],

  LIVE: [
    STATUS.SUSPENDED,
  ],

  SUSPENDED: [
    STATUS.LIVE,
  ],

  REJECTED: [],
});

/**
 * ============================================================================
 * HELPERS
 * ============================================================================
 */

function assertValidObjectId(id) {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new BadRequestError(
      "Invalid SACCO ID"
    );
  }
}

function normalizeEmail(email) {
  return String(email || "")
    .trim()
    .toLowerCase();
}

function normalizeTenantId(tenantId) {
  return String(tenantId || "").trim();
}

function assertTenantContext(tenantId) {
  if (!tenantId) {
    throw new BadRequestError(
      "Tenant context is required"
    );
  }
}

function assertStatusTransition(
  currentStatus,
  nextStatus
) {
  if (currentStatus === nextStatus) {
    throw new BadRequestError(
      `SACCO is already in ${nextStatus} status`
    );
  }

  const allowed =
    ALLOWED_STATUS_TRANSITIONS[
      currentStatus
    ] || [];

  if (!allowed.includes(nextStatus)) {
    throw new BadRequestError(
      `Invalid onboarding transition from ${currentStatus} to ${nextStatus}`
    );
  }
}

function assertNotDeleted(sacco) {
  if (sacco.isDeleted) {
    throw new BadRequestError(
      "SACCO has been deleted"
    );
  }
}

/**
 * ============================================================================
 * FIND SACCO
 * ============================================================================
 *
 * Every tenant-scoped lookup MUST use tenantId.
 * ============================================================================
 */

async function findSaccoById(
  saccoId,
  tenantId,
  options = {}
) {
  assertValidObjectId(saccoId);
  assertTenantContext(tenantId);

  const query = {
    _id: saccoId,
    tenantId: normalizeTenantId(tenantId),
  };

  if (!options.includeDeleted) {
    query.isDeleted = false;
  }

  const sacco = await Sacco.findOne(query);

  if (!sacco) {
    throw new NotFoundError(
      "SACCO not found"
    );
  }

  return sacco;
}

/**
 * ============================================================================
 * REGISTER SACCO
 * ============================================================================
 */

exports.registerSacco = async (
  payload,
  context = {}
) => {
  const tenantId = normalizeTenantId(
    context.tenantId
  );

  const userId = context.userId || null;

  assertTenantContext(tenantId);

  const email = normalizeEmail(
    payload.email
  );

  /**
   * Never allow callers to override tenant identity.
   */
  const existingByTenant =
    await Sacco.findOne({
      tenantId,
      isDeleted: false,
    });

  if (existingByTenant) {
    throw new BadRequestError(
      "A SACCO already exists for this tenant"
    );
  }

  /**
   * Email uniqueness is useful as an onboarding safeguard,
   * but tenant identity remains the primary boundary.
   */
  const existingByEmail =
    await Sacco.findOne({
      email,
      isDeleted: false,
    });

  if (existingByEmail) {
    throw new BadRequestError(
      "A SACCO with this email already exists"
    );
  }

  const sacco = await Sacco.create({
    ...payload,

    /**
     * Security:
     * tenantId comes from authenticated tenant context,
     * not from the client payload.
     */
    tenantId,

    email,

    status: STATUS.DRAFT,

    createdBy: userId,

    updatedBy: userId,

    statusChangedBy: userId,

    statusChangedAt: new Date(),

    lastActivityAt: new Date(),
  });

  return sacco;
};

/**
 * ============================================================================
 * GET SACCO BY ID
 * ============================================================================
 */

exports.getSaccoById = async (
  saccoId,
  context = {}
) => {
  return findSaccoById(
    saccoId,
    context.tenantId
  );
};

/**
 * ============================================================================
 * LIST SACCOs
 * ============================================================================
 */

exports.getAllSaccos = async (
  options = {},
  context = {}
) => {
  const tenantId = normalizeTenantId(
    context.tenantId
  );

  assertTenantContext(tenantId);

  let page = Number(options.page) || 1;
  let limit = Number(options.limit) || 20;

  page = Math.max(1, page);
  limit = Math.min(
    Math.max(1, limit),
    100
  );

  const query = {
    tenantId,
    isDeleted: false,
  };

  if (options.status) {
    query.status = options.status;
  }

  if (options.search) {
    const search =
      String(options.search).trim();

    if (search) {
      const escapedSearch =
        search.replace(
          /[.*+?^${}()|[\]\\]/g,
          "\\$&"
        );

      query.$or = [
        {
          saccoName: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          email: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
        {
          registrationNumber: {
            $regex: escapedSearch,
            $options: "i",
          },
        },
      ];
    }
  }

  const skip =
    (page - 1) * limit;

  const [
    total,
    items,
  ] = await Promise.all([
    Sacco.countDocuments(query),

    Sacco.find(query)
      .sort({
        createdAt: -1,
      })
      .skip(skip)
      .limit(limit)
      .lean(),
  ]);

  return {
    total,
    page,
    limit,

    pages:
      total === 0
        ? 0
        : Math.ceil(total / limit),

    hasNextPage:
      page * limit < total,

    hasPreviousPage:
      page > 1,

    items,
  };
};

/**
 * ============================================================================
 * VERIFY / APPROVE KYC
 * ============================================================================
 */

exports.verifyKYC = async (
  saccoId,
  payload = {},
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (
    sacco.status === STATUS.LIVE
  ) {
    throw new BadRequestError(
      "SACCO is already live"
    );
  }

  if (
    sacco.status === STATUS.REJECTED
  ) {
    throw new BadRequestError(
      "Rejected SACCO cannot be approved"
    );
  }

  if (
    sacco.status !== STATUS.KYC_PENDING &&
    sacco.status !== STATUS.VERIFICATION &&
    sacco.status !== STATUS.DRAFT
  ) {
    throw new BadRequestError(
      `KYC cannot be approved while SACCO is in ${sacco.status} status`
    );
  }

  const userId =
    context.userId || null;

  /**
   * Merge validated KYC data.
   */
  sacco.kycData = {
    ...(sacco.kycData || {}),
    ...payload,
  };

  sacco.kycCompleted = true;

  sacco.kycApprovedBy = userId;

  sacco.kycApprovedAt = new Date();

  sacco.status =
    STATUS.KYC_APPROVED;

  sacco.statusChangedAt =
    new Date();

  sacco.statusChangedBy =
    userId;

  if (sacco.onboardingChecklist) {
    sacco.onboardingChecklist
      .kycCompleted = true;
  }

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * SETUP SUBSCRIPTION
 * ============================================================================
 */

exports.setupSubscription = async (
  saccoId,
  payload,
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (
    sacco.status !==
    STATUS.KYC_APPROVED
  ) {
    throw new BadRequestError(
      "KYC must be approved before subscription setup"
    );
  }

  if (
    sacco.complianceStatus ===
    COMPLIANCE_STATUS.NON_COMPLIANT
  ) {
    throw new BadRequestError(
      "Non-compliant SACCO cannot activate subscription"
    );
  }

  const userId =
    context.userId || null;

  const now = new Date();

  sacco.subscription = {
    plan: payload.plan,
    billingCycle:
      payload.billingCycle,

    price: Number(
      payload.price || 0
    ),

    currency:
      payload.currency || "UGX",

    activatedBy: userId,

    activatedAt: now,

    active: true,

    status: "ACTIVE",

    expiresAt:
      payload.expiresAt || null,
  };

  sacco.status =
    STATUS.SUBSCRIPTION;

  sacco.statusChangedAt = now;

  sacco.statusChangedBy =
    userId;

  if (sacco.onboardingChecklist) {
    sacco.onboardingChecklist
      .subscriptionCompleted = true;
  }

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * UPLOAD DOCUMENTS
 * ============================================================================
 *
 * Expects normalized file metadata from the upload middleware/controller.
 * ============================================================================
 */

exports.uploadDocuments = async (
  saccoId,
  files = [],
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (!Array.isArray(files) ||
      files.length === 0) {
    throw new BadRequestError(
      "At least one document is required"
    );
  }

  const userId =
    context.userId || null;

  const documents =
    files.map((file) => ({
      documentType:
        file.documentType ||
        "OTHER",

      fileName:
        file.originalname ||
        file.fileName,

      fileType:
        file.mimetype ||
        file.fileType,

      fileSize:
        file.size ||
        file.fileSize ||
        0,

      path:
        file.path ||
        file.location,

      storageProvider:
        file.storageProvider ||
        "LOCAL",

      checksum:
        file.checksum,

      uploadedBy:
        userId,

      uploadedAt:
        new Date(),

      verified: false,
    }));

  sacco.documents.push(
    ...documents
  );

  if (
    sacco.status === STATUS.DRAFT
  ) {
    sacco.status =
      STATUS.VERIFICATION;
  }

  sacco.statusChangedAt =
    new Date();

  sacco.statusChangedBy =
    userId;

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * VERIFY DOCUMENT
 * ============================================================================
 */

exports.verifyDocument = async (
  saccoId,
  documentIndex,
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  const index =
    Number(documentIndex);

  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= sacco.documents.length
  ) {
    throw new NotFoundError(
      "KYC document not found"
    );
  }

  const document =
    sacco.documents[index];

  const now = new Date();

  document.verified = true;

  document.verifiedBy =
    context.userId || null;

  document.verifiedAt = now;

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * GET ONBOARDING PROGRESS
 * ============================================================================
 */

exports.getOnboardingProgress =
  async (
    saccoId,
    context = {}
  ) => {
    const sacco =
      await findSaccoById(
        saccoId,
        context.tenantId
      );

    const checklist =
      sacco.onboardingChecklist || {};

    const total = 8;

    const completed =
      Object.values(checklist)
        .filter(Boolean)
        .length;

    return {
      saccoId: sacco._id,

      status: sacco.status,

      progress:
        sacco.onboardingProgress,

      completed,

      total,

      remaining:
        total - completed,

      checklist,
    };
  };

/**
 * ============================================================================
 * GO LIVE
 * ============================================================================
 *
 * This is intentionally strict.
 * ============================================================================
 */

exports.goLive = async (
  saccoId,
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (
    sacco.status === STATUS.LIVE
  ) {
    return sacco;
  }

  if (
    sacco.status !==
    STATUS.SUBSCRIPTION
  ) {
    throw new BadRequestError(
      `SACCO cannot go live from ${sacco.status} status`
    );
  }

  /**
   * KYC prerequisite.
   */
  if (!sacco.kycCompleted) {
    throw new BadRequestError(
      "KYC must be completed before go-live"
    );
  }

  /**
   * Compliance prerequisite.
   */
  if (
    sacco.complianceStatus !==
    COMPLIANCE_STATUS.COMPLIANT
  ) {
    throw new BadRequestError(
      "SACCO must be compliant before go-live"
    );
  }

  /**
   * Subscription prerequisite.
   */
  if (
    !sacco.subscription ||
    !sacco.subscription.active ||
    sacco.subscription.status !==
      "ACTIVE"
  ) {
    throw new BadRequestError(
      "An active subscription is required before go-live"
    );
  }

  /**
   * Tenant configuration prerequisite.
   */
  if (!sacco.tenantSettings) {
    throw new BadRequestError(
      "Tenant configuration must be completed before go-live"
    );
  }

  /**
   * Admin prerequisite.
   */
  if (
    !sacco.adminUser ||
    !sacco.adminUser.email
  ) {
    throw new BadRequestError(
      "SACCO administrator must be provisioned before go-live"
    );
  }

  const checklist =
    sacco.onboardingChecklist || {};

  /**
   * Required operational steps.
   */
  const requiredSteps = [
    "registrationCompleted",
    "kycCompleted",
    "subscriptionCompleted",
    "tenantSetupCompleted",
    "adminCreated",
    "trainingCompleted",
  ];

  const missingSteps =
    requiredSteps.filter(
      (step) => checklist[step] !== true
    );

  if (missingSteps.length > 0) {
    throw new BadRequestError(
      `SACCO onboarding is incomplete. Missing: ${missingSteps.join(
        ", "
      )}`
    );
  }

  const now = new Date();

  sacco.status =
    STATUS.LIVE;

  sacco.liveAt = now;

  sacco.liveBy =
    context.userId || null;

  sacco.goLiveApprovedAt =
    now;

  sacco.goLiveApprovedBy =
    context.userId || null;

  sacco.statusChangedAt =
    now;

  sacco.statusChangedBy =
    context.userId || null;

  if (sacco.onboardingChecklist) {
    sacco.onboardingChecklist
      .goLiveApproved = true;
  }

  sacco.updateProgress();

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * REJECT APPLICATION
 * ============================================================================
 */

exports.rejectApplication =
  async (
    saccoId,
    reason,
    context = {}
  ) => {
    const sacco =
      await findSaccoById(
        saccoId,
        context.tenantId
      );

    assertNotDeleted(sacco);

    if (
      sacco.status === STATUS.LIVE
    ) {
      throw new BadRequestError(
        "A live SACCO cannot be rejected. Suspend it instead."
      );
    }

    if (
      sacco.status === STATUS.REJECTED
    ) {
      throw new BadRequestError(
        "SACCO is already rejected"
      );
    }

    if (
      !reason ||
      !String(reason).trim()
    ) {
      throw new BadRequestError(
        "Rejection reason is required"
      );
    }

    const now = new Date();

    sacco.status =
      STATUS.REJECTED;

    sacco.rejectionReason =
      String(reason).trim();

    sacco.rejectedBy =
      context.userId || null;

    sacco.rejectedAt = now;

    sacco.statusChangedAt =
      now;

    sacco.statusChangedBy =
      context.userId || null;

    await sacco.save();

    return sacco;
  };

/**
 * ============================================================================
 * SUSPEND SACCO
 * ============================================================================
 */

exports.suspend = async (
  saccoId,
  reason,
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (
    sacco.status !== STATUS.LIVE
  ) {
    throw new BadRequestError(
      "Only LIVE SACCOs can be suspended"
    );
  }

  if (
    !reason ||
    !String(reason).trim()
  ) {
    throw new BadRequestError(
      "Suspension reason is required"
    );
  }

  const now = new Date();

  sacco.status =
    STATUS.SUSPENDED;

  sacco.suspendedAt = now;

  sacco.suspendedBy =
    context.userId || null;

  sacco.suspensionReason =
    String(reason).trim();

  sacco.statusChangedAt =
    now;

  sacco.statusChangedBy =
    context.userId || null;

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * RESTORE SACCO
 * ============================================================================
 */

exports.restore = async (
  saccoId,
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (
    sacco.status !==
    STATUS.SUSPENDED
  ) {
    throw new BadRequestError(
      "Only suspended SACCOs can be restored"
    );
  }

  const now = new Date();

  sacco.status =
    STATUS.LIVE;

  sacco.statusChangedAt =
    now;

  sacco.statusChangedBy =
    context.userId || null;

  sacco.suspendedAt = null;

  sacco.suspendedBy = null;

  sacco.suspensionReason = null;

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * MTN MOMO READINESS
 * ============================================================================
 *
 * This service only records onboarding readiness.
 *
 * Actual provider integration belongs in the payment subsystem.
 * ============================================================================
 */

exports.setupMtnMomo = async (
  saccoId,
  payload = {},
  context = {}
) => {
  const sacco =
    await findSaccoById(
      saccoId,
      context.tenantId
    );

  assertNotDeleted(sacco);

  if (
    sacco.status === STATUS.REJECTED
  ) {
    throw new BadRequestError(
      "Rejected SACCO cannot configure MTN MoMo"
    );
  }

  sacco.mtnMomoEnabled = true;

  sacco.mobileMoneyEnabled = true;

  if (
    payload.collectionAccount
  ) {
    sacco.mtnCollectionAccount =
      String(
        payload.collectionAccount
      ).trim();
  }

  sacco.mobileMoneyConfiguredAt =
    new Date();

  sacco.mobileMoneyConfiguredBy =
    context.userId || null;

  if (sacco.onboardingChecklist) {
    sacco.onboardingChecklist
      .mobileMoneyConfigured = true;
  }

  await sacco.save();

  return sacco;
};

/**
 * ============================================================================
 * AIRTEL MONEY READINESS
 * ============================================================================
 */

exports.setupAirtelMoney =
  async (
    saccoId,
    payload = {},
    context = {}
  ) => {
    const sacco =
      await findSaccoById(
        saccoId,
        context.tenantId
      );

    assertNotDeleted(sacco);

    if (
      sacco.status === STATUS.REJECTED
    ) {
      throw new BadRequestError(
        "Rejected SACCO cannot configure Airtel Money"
      );
    }

    sacco.airtelMoneyEnabled =
      true;

    sacco.mobileMoneyEnabled =
      true;

    if (
      payload.collectionAccount
    ) {
      sacco.airtelCollectionAccount =
        String(
          payload.collectionAccount
        ).trim();
    }

    sacco.mobileMoneyConfiguredAt =
      new Date();

    sacco.mobileMoneyConfiguredBy =
      context.userId || null;

    if (sacco.onboardingChecklist) {
      sacco.onboardingChecklist
        .mobileMoneyConfigured = true;
    }

    await sacco.save();

    return sacco;
  };

/**
 * ============================================================================
 * METRICS
 * ============================================================================
 */

exports.getOnboardingMetrics =
  async (context = {}) => {
    const tenantId =
      normalizeTenantId(
        context.tenantId
      );

    assertTenantContext(tenantId);

    const filter = {
      tenantId,
      isDeleted: false,
    };

    const [
      total,
      draft,
      verification,
      kycPending,
      kycApproved,
      subscription,
      live,
      suspended,
      rejected,
    ] = await Promise.all([
      Sacco.countDocuments(filter),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.DRAFT,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.VERIFICATION,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.KYC_PENDING,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.KYC_APPROVED,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.SUBSCRIPTION,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.LIVE,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.SUSPENDED,
      }),

      Sacco.countDocuments({
        ...filter,
        status: STATUS.REJECTED,
      }),
    ]);

    return {
      total,
      draft,
      verification,
      kycPending,
      kycApproved,
      subscription,
      live,
      suspended,
      rejected,
    };
  };

/**
 * ============================================================================
 * EXPORT CONSTANTS FOR INTERNAL SERVICES / TESTS
 * ============================================================================
 */

exports.STATUS = STATUS;

exports.COMPLIANCE_STATUS =
  COMPLIANCE_STATUS;

exports.ALLOWED_STATUS_TRANSITIONS =
  ALLOWED_STATUS_TRANSITIONS;