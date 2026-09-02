"use strict";

/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise SACCO Onboarding Model
 * ============================================================================
 *
 * File:
 * backend/modules/onboarding/sacco.model.js
 *
 * Purpose:
 * ----------------------------------------------------------------------------
 * Persistent enterprise representation of a SACCO / tenant onboarding
 * lifecycle.
 *
 * Responsibilities:
 * ----------------------------------------------------------------------------
 * - SACCO registration data
 * - Tenant isolation metadata
 * - KYC and compliance state
 * - Supporting documents
 * - Subscription configuration
 * - Tenant configuration
 * - Operational readiness
 * - Mobile money readiness
 * - Administrative account metadata
 * - Soft deletion
 * - Audit metadata
 * - Onboarding progress tracking
 *
 * Design Principles:
 * ----------------------------------------------------------------------------
 * - Multi-tenant safe
 * - Validation-first
 * - Backward compatible
 * - Audit friendly
 * - Soft-delete aware
 * - Enterprise indexing
 * - Lifecycle aware
 * - Production safe
 *
 * NOTE:
 * ----------------------------------------------------------------------------
 * This model does not perform financial transactions.
 * Financial balances, ledger entries, payments, settlements, etc. MUST remain
 * in their respective domain services and financial models.
 * ============================================================================
 */

const mongoose = require("mongoose");

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONSTANTS
 * ============================================================================
 */

const SACCO_STATUS = Object.freeze({
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

const SUBSCRIPTION_PLANS = Object.freeze([
  "STARTER",
  "GROWTH",
  "ENTERPRISE",
  "CUSTOM",
]);

const BILLING_CYCLES = Object.freeze([
  "MONTHLY",
  "QUARTERLY",
  "ANNUAL",
]);

const ONBOARDING_CHECKLIST_KEYS = Object.freeze([
  "registrationCompleted",
  "kycCompleted",
  "subscriptionCompleted",
  "tenantSetupCompleted",
  "adminCreated",
  "mobileMoneyConfigured",
  "trainingCompleted",
  "goLiveApproved",
]);

const ONBOARDING_CHECKLIST_TOTAL =
  ONBOARDING_CHECKLIST_KEYS.length;

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Normalize email addresses.
 */
function normalizeEmail(value) {
  if (typeof value !== "string") return value;

  return value.trim().toLowerCase();
}

/**
 * Normalize phone values without changing their semantic format.
 */
function normalizePhone(value) {
  if (typeof value !== "string") return value;

  return value.trim();
}

/**
 * Normalize strings.
 */
function normalizeString(value) {
  if (typeof value !== "string") return value;

  return value.trim();
}

/**
 * ============================================================================
 * KYC DOCUMENT SCHEMA
 * ============================================================================
 */

const DocumentSchema = new Schema(
  {
    documentType: {
      type: String,
      trim: true,
      uppercase: true,
      default: "OTHER",
    },

    fileName: {
      type: String,
      required: true,
      trim: true,
    },

    fileType: {
      type: String,
      trim: true,
      lowercase: true,
    },

    fileSize: {
      type: Number,
      min: 0,
    },

    path: {
      type: String,
      required: true,
      trim: true,
    },

    storageProvider: {
      type: String,
      trim: true,
      uppercase: true,
      default: "LOCAL",
    },

    checksum: {
      type: String,
      trim: true,
      lowercase: true,
    },

    uploadedBy: {
      type: String,
      trim: true,
    },

    uploadedAt: {
      type: Date,
      default: Date.now,
    },

    verified: {
      type: Boolean,
      default: false,
    },

    verifiedBy: {
      type: String,
      trim: true,
    },

    verifiedAt: {
      type: Date,
    },

    rejectionReason: {
      type: String,
      trim: true,
    },

    expiresAt: {
      type: Date,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * SUBSCRIPTION SCHEMA
 * ============================================================================
 */

const SubscriptionSchema = new Schema(
  {
    plan: {
      type: String,
      enum: SUBSCRIPTION_PLANS,
      uppercase: true,
      trim: true,
    },

    billingCycle: {
      type: String,
      enum: BILLING_CYCLES,
      uppercase: true,
      trim: true,
    },

    currency: {
      type: String,
      default: "UGX",
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },

    price: {
      type: Number,
      default: 0,
      min: 0,
    },

    activatedAt: {
      type: Date,
    },

    activatedBy: {
      type: String,
      trim: true,
    },

    expiresAt: {
      type: Date,
    },

    active: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: [
        "PENDING",
        "ACTIVE",
        "EXPIRED",
        "SUSPENDED",
        "CANCELLED",
      ],
      default: "PENDING",
    },

    externalSubscriptionId: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * CONTACT PERSON SCHEMA
 * ============================================================================
 */

const ContactPersonSchema = new Schema(
  {
    fullName: {
      type: String,
      trim: true,
    },

    designation: {
      type: String,
      trim: true,
    },

    phone: {
      type: String,
      trim: true,
      set: normalizePhone,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: normalizeEmail,
    },

    nationalId: {
      type: String,
      trim: true,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * TENANT SETTINGS SCHEMA
 * ============================================================================
 */

const TenantSettingsSchema = new Schema(
  {
    subdomain: {
      type: String,
      trim: true,
      lowercase: true,
      match: /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/,
    },

    brandingLogo: {
      type: String,
      trim: true,
    },

    primaryColor: {
      type: String,
      trim: true,
    },

    secondaryColor: {
      type: String,
      trim: true,
    },

    timezone: {
      type: String,
      default: "Africa/Kampala",
      trim: true,
    },

    defaultCurrency: {
      type: String,
      default: "UGX",
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * ONBOARDING CHECKLIST SCHEMA
 * ============================================================================
 */

const OnboardingChecklistSchema = new Schema(
  {
    registrationCompleted: {
      type: Boolean,
      default: false,
    },

    kycCompleted: {
      type: Boolean,
      default: false,
    },

    subscriptionCompleted: {
      type: Boolean,
      default: false,
    },

    tenantSetupCompleted: {
      type: Boolean,
      default: false,
    },

    adminCreated: {
      type: Boolean,
      default: false,
    },

    mobileMoneyConfigured: {
      type: Boolean,
      default: false,
    },

    trainingCompleted: {
      type: Boolean,
      default: false,
    },

    goLiveApproved: {
      type: Boolean,
      default: false,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * ADMIN ACCOUNT SCHEMA
 * ============================================================================
 */

const AdminUserSchema = new Schema(
  {
    userId: {
      type: String,
      trim: true,
    },

    fullName: {
      type: String,
      trim: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
      set: normalizeEmail,
    },

    phone: {
      type: String,
      trim: true,
      set: normalizePhone,
    },

    createdAt: {
      type: Date,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * SYSTEM CONFIGURATION SCHEMA
 * ============================================================================
 */

const SystemConfigurationSchema = new Schema(
  {
    loanModuleEnabled: {
      type: Boolean,
      default: true,
    },

    savingsModuleEnabled: {
      type: Boolean,
      default: true,
    },

    sharesModuleEnabled: {
      type: Boolean,
      default: true,
    },

    investmentsModuleEnabled: {
      type: Boolean,
      default: false,
    },

    accountingModuleEnabled: {
      type: Boolean,
      default: true,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * MAIN SACCO SCHEMA
 * ============================================================================
 */

const SaccoSchema = new Schema(
  {
    /**
     * ========================================================================
     * TENANT
     * ========================================================================
     */

    tenantId: {
      type: String,
      required: true,
      trim: true,
      immutable: true,
      index: true,
    },

    /**
     * ========================================================================
     * BASIC DETAILS
     * ========================================================================
     */

    saccoName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 200,
      index: true,
      set: normalizeString,
    },

    registrationNumber: {
      type: String,
      trim: true,
      uppercase: true,
      sparse: true,
    },

    tinNumber: {
      type: String,
      trim: true,
      uppercase: true,
    },

    district: {
      type: String,
      trim: true,
    },

    region: {
      type: String,
      trim: true,
    },

    country: {
      type: String,
      default: "Uganda",
      trim: true,
    },

    physicalAddress: {
      type: String,
      trim: true,
    },

    postalAddress: {
      type: String,
      trim: true,
    },

    website: {
      type: String,
      trim: true,
    },

    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      set: normalizeEmail,
      index: true,
      maxlength: 254,
    },

    phone: {
      type: String,
      required: true,
      trim: true,
      set: normalizePhone,
    },

    /**
     * ========================================================================
     * CONTACT PERSON
     * ========================================================================
     */

    contactPerson: {
      type: ContactPersonSchema,
    },

    /**
     * ========================================================================
     * STATUS
     * ========================================================================
     */

    status: {
      type: String,
      enum: Object.values(SACCO_STATUS),
      default: SACCO_STATUS.DRAFT,
      index: true,
    },

    statusChangedAt: {
      type: Date,
      default: Date.now,
    },

    statusChangedBy: {
      type: String,
      trim: true,
    },

    /**
     * ========================================================================
     * KYC
     * ========================================================================
     */

    kycCompleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    kycApprovedBy: {
      type: String,
      trim: true,
    },

    kycApprovedAt: {
      type: Date,
    },

    kycData: {
      type: Schema.Types.Mixed,
      default: {},
    },

    kycRiskLevel: {
      type: String,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
    },

    /**
     * ========================================================================
     * DOCUMENTS
     * ========================================================================
     */

    documents: {
      type: [DocumentSchema],
      default: [],
    },

    /**
     * ========================================================================
     * SUBSCRIPTION
     * ========================================================================
     */

    subscription: {
      type: SubscriptionSchema,
      default: undefined,
    },

    /**
     * ========================================================================
     * TENANT SETTINGS
     * ========================================================================
     */

    tenantSettings: {
      type: TenantSettingsSchema,
      default: undefined,
    },

    /**
     * ========================================================================
     * GO LIVE
     * ========================================================================
     */

    liveAt: {
      type: Date,
    },

    liveBy: {
      type: String,
      trim: true,
    },

    goLiveApprovedAt: {
      type: Date,
    },

    goLiveApprovedBy: {
      type: String,
      trim: true,
    },

    /**
     * ========================================================================
     * REJECTION
     * ========================================================================
     */

    rejectedBy: {
      type: String,
      trim: true,
    },

    rejectedAt: {
      type: Date,
    },

    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    /**
     * ========================================================================
     * SUSPENSION
     * ========================================================================
     */

    suspendedBy: {
      type: String,
      trim: true,
    },

    suspendedAt: {
      type: Date,
    },

    suspensionReason: {
      type: String,
      trim: true,
      maxlength: 2000,
    },

    /**
     * ========================================================================
     * BUSINESS METRICS
     * ========================================================================
     */

    expectedMembers: {
      type: Number,
      default: 0,
      min: 0,
    },

    currentMembers: {
      type: Number,
      default: 0,
      min: 0,
    },

    expectedLoanPortfolio: {
      type: Number,
      default: 0,
      min: 0,
    },

    monthlyRevenueEstimate: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * ========================================================================
     * MOBILE MONEY READINESS
     * ========================================================================
     */

    mobileMoneyEnabled: {
      type: Boolean,
      default: false,
    },

    mtnMomoEnabled: {
      type: Boolean,
      default: false,
    },

    airtelMoneyEnabled: {
      type: Boolean,
      default: false,
    },

    mtnCollectionAccount: {
      type: String,
      default: null,
      trim: true,
    },

    airtelCollectionAccount: {
      type: String,
      default: null,
      trim: true,
    },

    mobileMoneyConfiguredAt: {
      type: Date,
    },

    mobileMoneyConfiguredBy: {
      type: String,
      trim: true,
    },

    /**
     * ========================================================================
     * BRANCH INFORMATION
     * ========================================================================
     */

    branchCount: {
      type: Number,
      default: 1,
      min: 1,
    },

    headquartersBranch: {
      type: String,
      default: "MAIN",
      trim: true,
      uppercase: true,
    },

    /**
     * ========================================================================
     * STAFF ESTIMATES
     * ========================================================================
     */

    expectedStaff: {
      type: Number,
      default: 0,
      min: 0,
    },

    currentStaff: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * ========================================================================
     * OPERATIONAL READINESS
     * ========================================================================
     */

    onboardingProgress: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    onboardingChecklist: {
      type: OnboardingChecklistSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * ADMIN ACCOUNT
     * ========================================================================
     */

    adminUser: {
      type: AdminUserSchema,
    },

    /**
     * ========================================================================
     * SACCO CONFIGURATION
     * ========================================================================
     */

    systemConfiguration: {
      type: SystemConfigurationSchema,
      default: () => ({}),
    },

    /**
     * ========================================================================
     * COMPLIANCE
     * ========================================================================
     */

    complianceStatus: {
      type: String,
      enum: Object.values(COMPLIANCE_STATUS),
      default: COMPLIANCE_STATUS.PENDING,
      index: true,
    },

    complianceReviewedBy: {
      type: String,
      trim: true,
    },

    complianceReviewedAt: {
      type: Date,
    },

    complianceNotes: {
      type: String,
      trim: true,
      maxlength: 5000,
    },

    /**
     * ========================================================================
     * AUDIT INFO
     * ========================================================================
     */

    createdBy: {
      type: String,
      default: null,
      trim: true,
      immutable: true,
    },

    updatedBy: {
      type: String,
      default: null,
      trim: true,
    },

    lastActivityAt: {
      type: Date,
      default: Date.now,
      index: true,
    },

    /**
     * ========================================================================
     * SOFT DELETE
     * ========================================================================
     */

    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
    },

    deletedBy: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,

    /**
     * Keep versioning enabled for optimistic concurrency protection.
     */
    versionKey: "__v",

    /**
     * Prevent accidental storage of unknown fields.
     *
     * Existing MongoDB documents are not automatically changed.
     * This only affects future writes through this schema.
     */
    strict: true,

    /**
     * Improve update safety.
     */
    strictQuery: true,
  }
);

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * One SACCO / tenant record per tenant.
 */
SaccoSchema.index(
  {
    tenantId: 1,
  },
  {
    unique: true,
    name: "uniq_sacco_tenant",
  }
);

/**
 * Registration number should be globally unique when supplied.
 */
SaccoSchema.index(
  {
    registrationNumber: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uniq_sacco_registration_number",
  }
);

/**
 * Operational lookup indexes.
 */
SaccoSchema.index(
  {
    status: 1,
    isDeleted: 1,
  },
  {
    name: "sacco_status_deleted",
  }
);

SaccoSchema.index(
  {
    complianceStatus: 1,
    isDeleted: 1,
  },
  {
    name: "sacco_compliance_deleted",
  }
);

SaccoSchema.index(
  {
    kycCompleted: 1,
    status: 1,
  },
  {
    name: "sacco_kyc_status",
  }
);

SaccoSchema.index(
  {
    tenantId: 1,
    status: 1,
  },
  {
    name: "sacco_tenant_status",
  }
);

SaccoSchema.index(
  {
    tenantId: 1,
    createdAt: -1,
  },
  {
    name: "sacco_tenant_created",
  }
);

SaccoSchema.index(
  {
    createdAt: -1,
  },
  {
    name: "sacco_created_desc",
  }
);

SaccoSchema.index(
  {
    lastActivityAt: -1,
  },
  {
    name: "sacco_last_activity",
  }
);

/**
 * Tenant subdomain lookup.
 *
 * Sparse because not every onboarding record necessarily has a subdomain yet.
 */
SaccoSchema.index(
  {
    "tenantSettings.subdomain": 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uniq_sacco_subdomain",
  }
);

/**
 * ============================================================================
 * VALIDATION
 * ============================================================================
 */

/**
 * Prevent negative financial/business metrics.
 */
SaccoSchema.path("currentMembers").validate(function (value) {
  return value <= this.expectedMembers || this.expectedMembers === 0;
}, "Current members cannot exceed expected members unless no expectation was supplied.");

SaccoSchema.path("currentStaff").validate(function (value) {
  return value <= this.expectedStaff || this.expectedStaff === 0;
}, "Current staff cannot exceed expected staff unless no expectation was supplied.");

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

SaccoSchema.virtual("isLive").get(function () {
  return this.status === SACCO_STATUS.LIVE;
});

SaccoSchema.virtual("isRejected").get(function () {
  return this.status === SACCO_STATUS.REJECTED;
});

SaccoSchema.virtual("isKYCApproved").get(function () {
  return this.status === SACCO_STATUS.KYC_APPROVED;
});

SaccoSchema.virtual("subscriptionActive").get(function () {
  return Boolean(
    this.subscription &&
      this.subscription.active &&
      this.subscription.status === "ACTIVE"
  );
});

SaccoSchema.virtual("isSuspended").get(function () {
  return this.status === SACCO_STATUS.SUSPENDED;
});

SaccoSchema.virtual("documentsCount").get(function () {
  return Array.isArray(this.documents)
    ? this.documents.length
    : 0;
});

SaccoSchema.virtual("verifiedDocumentsCount").get(function () {
  if (!Array.isArray(this.documents)) return 0;

  return this.documents.filter(
    (document) => document.verified === true
  ).length;
});

SaccoSchema.virtual("onboardingCompleted").get(function () {
  return this.onboardingProgress === 100;
});

/**
 * ============================================================================
 * INSTANCE METHODS
 * ============================================================================
 */

/**
 * ============================================================================
 * Calculate onboarding progress
 * ============================================================================
 */

SaccoSchema.methods.updateProgress = function () {
  const checklist = this.onboardingChecklist || {};

  const completed = ONBOARDING_CHECKLIST_KEYS.reduce(
    (count, key) => {
      return checklist[key] === true
        ? count + 1
        : count;
    },
    0
  );

  this.onboardingProgress = Math.round(
    (completed / ONBOARDING_CHECKLIST_TOTAL) * 100
  );

  return this.onboardingProgress;
};

/**
 * ============================================================================
 * Mark SACCO as live
 * ============================================================================
 */

SaccoSchema.methods.markAsLive = async function (userId) {
  if (this.isDeleted) {
    throw new Error(
      "Deleted SACCO cannot be activated."
    );
  }

  if (this.status === SACCO_STATUS.REJECTED) {
    throw new Error(
      "Rejected SACCO cannot be activated."
    );
  }

  if (this.complianceStatus !== COMPLIANCE_STATUS.COMPLIANT) {
    throw new Error(
      "SACCO must be compliant before going live."
    );
  }

  if (!this.kycCompleted) {
    throw new Error(
      "SACCO KYC must be completed before going live."
    );
  }

  if (
    !this.subscription ||
    !this.subscription.active
  ) {
    throw new Error(
      "An active subscription is required before going live."
    );
  }

  const now = new Date();

  this.status = SACCO_STATUS.LIVE;
  this.liveAt = now;
  this.liveBy = userId;
  this.goLiveApprovedAt = now;
  this.goLiveApprovedBy = userId;

  this.statusChangedAt = now;
  this.statusChangedBy = userId;

  if (this.onboardingChecklist) {
    this.onboardingChecklist.goLiveApproved = true;
  }

  this.updateProgress();

  return this.save();
};

/**
 * ============================================================================
 * Reject onboarding application
 * ============================================================================
 */

SaccoSchema.methods.rejectApplication = async function (
  reason,
  userId
) {
  if (this.isDeleted) {
    throw new Error(
      "Deleted SACCO cannot be rejected."
    );
  }

  if (!reason || !String(reason).trim()) {
    throw new Error(
      "A rejection reason is required."
    );
  }

  const now = new Date();

  this.status = SACCO_STATUS.REJECTED;

  this.rejectionReason = String(reason).trim();
  this.rejectedBy = userId;
  this.rejectedAt = now;

  this.statusChangedAt = now;
  this.statusChangedBy = userId;

  return this.save();
};

/**
 * ============================================================================
 * Suspend SACCO
 * ============================================================================
 */

SaccoSchema.methods.suspend = async function (
  reason,
  userId
) {
  if (this.isDeleted) {
    throw new Error(
      "Deleted SACCO cannot be suspended."
    );
  }

  if (!reason || !String(reason).trim()) {
    throw new Error(
      "A suspension reason is required."
    );
  }

  const now = new Date();

  this.status = SACCO_STATUS.SUSPENDED;

  this.suspendedBy = userId;
  this.suspendedAt = now;
  this.suspensionReason = String(reason).trim();

  this.statusChangedAt = now;
  this.statusChangedBy = userId;

  return this.save();
};

/**
 * ============================================================================
 * Restore suspended SACCO
 * ============================================================================
 */

SaccoSchema.methods.restoreFromSuspension = async function (
  userId
) {
  if (this.isDeleted) {
    throw new Error(
      "Deleted SACCO cannot be restored."
    );
  }

  if (this.status !== SACCO_STATUS.SUSPENDED) {
    throw new Error(
      "Only suspended SACCOs can be restored."
    );
  }

  const now = new Date();

  this.status = SACCO_STATUS.LIVE;

  this.statusChangedAt = now;
  this.statusChangedBy = userId;

  this.suspendedBy = null;
  this.suspendedAt = null;
  this.suspensionReason = null;

  return this.save();
};

/**
 * ============================================================================
 * Soft delete
 * ============================================================================
 */

SaccoSchema.methods.softDelete = async function (
  userId
) {
  if (this.isDeleted) {
    return this;
  }

  const now = new Date();

  this.isDeleted = true;
  this.deletedAt = now;
  this.deletedBy = userId;

  this.lastActivityAt = now;

  return this.save();
};

/**
 * ============================================================================
 * Restore soft-deleted SACCO
 * ============================================================================
 */

SaccoSchema.methods.restore = async function () {
  if (!this.isDeleted) {
    return this;
  }

  this.isDeleted = false;
  this.deletedAt = null;
  this.deletedBy = null;

  return this.save();
};

/**
 * ============================================================================
 * Activate subscription
 * ============================================================================
 */

SaccoSchema.methods.activateSubscription = async function (
  userId
) {
  if (!this.subscription) {
    throw new Error(
      "Subscription configuration is required."
    );
  }

  const now = new Date();

  this.subscription.active = true;
  this.subscription.status = "ACTIVE";
  this.subscription.activatedAt = now;
  this.subscription.activatedBy = userId;

  this.status = SACCO_STATUS.SUBSCRIPTION;

  this.statusChangedAt = now;
  this.statusChangedBy = userId;

  if (this.onboardingChecklist) {
    this.onboardingChecklist.subscriptionCompleted = true;
  }

  this.updateProgress();

  return this.save();
};

/**
 * ============================================================================
 * Approve KYC
 * ============================================================================
 */

SaccoSchema.methods.approveKYC = async function (
  userId
) {
  if (this.isDeleted) {
    throw new Error(
      "Deleted SACCO cannot have KYC approved."
    );
  }

  const now = new Date();

  this.kycCompleted = true;
  this.kycApprovedBy = userId;
  this.kycApprovedAt = now;

  this.status = SACCO_STATUS.KYC_APPROVED;

  this.statusChangedAt = now;
  this.statusChangedBy = userId;

  if (this.onboardingChecklist) {
    this.onboardingChecklist.kycCompleted = true;
  }

  this.updateProgress();

  return this.save();
};

/**
 * ============================================================================
 * Mark mobile money as configured
 * ============================================================================
 */

SaccoSchema.methods.markMobileMoneyConfigured =
  async function (userId) {
    if (!this.mtnMomoEnabled && !this.airtelMoneyEnabled) {
      throw new Error(
        "At least one mobile money provider must be enabled."
      );
    }

    const now = new Date();

    this.mobileMoneyEnabled = true;
    this.mobileMoneyConfiguredAt = now;
    this.mobileMoneyConfiguredBy = userId;

    if (this.onboardingChecklist) {
      this.onboardingChecklist.mobileMoneyConfigured = true;
    }

    this.updateProgress();

    return this.save();
  };

/**
 * ============================================================================
 * Compliance helpers
 * ============================================================================
 */

SaccoSchema.methods.markCompliant = async function (
  userId,
  notes = null
) {
  const now = new Date();

  this.complianceStatus =
    COMPLIANCE_STATUS.COMPLIANT;

  this.complianceReviewedBy = userId;
  this.complianceReviewedAt = now;
  this.complianceNotes = notes
    ? String(notes).trim()
    : null;

  return this.save();
};

SaccoSchema.methods.markNonCompliant = async function (
  userId,
  notes = null
) {
  const now = new Date();

  this.complianceStatus =
    COMPLIANCE_STATUS.NON_COMPLIANT;

  this.complianceReviewedBy = userId;
  this.complianceReviewedAt = now;
  this.complianceNotes = notes
    ? String(notes).trim()
    : null;

  return this.save();
};

/**
 * ============================================================================
 * STATIC METHODS
 * ============================================================================
 */

/**
 * ============================================================================
 * Get onboarding metrics
 * ============================================================================
 */

SaccoSchema.statics.getMetrics = async function (
  options = {}
) {
  const includeDeleted =
    options.includeDeleted === true;

  const baseFilter = includeDeleted
    ? {}
    : {
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
    this.countDocuments(baseFilter),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.DRAFT,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.VERIFICATION,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.KYC_PENDING,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.KYC_APPROVED,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.SUBSCRIPTION,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.LIVE,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.SUSPENDED,
    }),

    this.countDocuments({
      ...baseFilter,
      status: SACCO_STATUS.REJECTED,
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
 * Find active SACCO by tenant
 * ============================================================================
 */

SaccoSchema.statics.findActiveByTenant =
  function (tenantId) {
    return this.findOne({
      tenantId,
      isDeleted: false,
    });
  };

/**
 * ============================================================================
 * Find live SACCO by tenant
 * ============================================================================
 */

SaccoSchema.statics.findLiveByTenant =
  function (tenantId) {
    return this.findOne({
      tenantId,
      status: SACCO_STATUS.LIVE,
      isDeleted: false,
    });
  };

/**
 * ============================================================================
 * Find by registration number
 * ============================================================================
 */

SaccoSchema.statics.findByRegistrationNumber =
  function (registrationNumber) {
    return this.findOne({
      registrationNumber: String(
        registrationNumber
      )
        .trim()
        .toUpperCase(),

      isDeleted: false,
    });
  };

/**
 * ============================================================================
 * Find by subdomain
 * ============================================================================
 */

SaccoSchema.statics.findBySubdomain =
  function (subdomain) {
    return this.findOne({
      "tenantSettings.subdomain": String(
        subdomain
      )
        .trim()
        .toLowerCase(),

      isDeleted: false,
    });
  };

/**
 * ============================================================================
 * PRE VALIDATE
 * ============================================================================
 */

SaccoSchema.pre(
  "validate",
  function (next) {
    /**
     * Synchronize mobile money master flag.
     */
    if (
      this.mtnMomoEnabled ||
      this.airtelMoneyEnabled
    ) {
      this.mobileMoneyEnabled = true;
    }

    /**
     * If mobile money is explicitly disabled,
     * provider flags must also be disabled.
     */
    if (!this.mobileMoneyEnabled) {
      this.mtnMomoEnabled = false;
      this.airtelMoneyEnabled = false;
    }

    /**
     * Subscription consistency.
     */
    if (
      this.subscription &&
      this.subscription.active
    ) {
      this.subscription.status = "ACTIVE";
    }

    /**
     * Rejection consistency.
     */
    if (
      this.status === SACCO_STATUS.REJECTED &&
      !this.rejectionReason
    ) {
      return next(
        new Error(
          "Rejected SACCO requires a rejection reason."
        )
      );
    }

    /**
     * Suspension consistency.
     */
    if (
      this.status === SACCO_STATUS.SUSPENDED &&
      !this.suspensionReason
    ) {
      return next(
        new Error(
          "Suspended SACCO requires a suspension reason."
        )
      );
    }

    /**
     * LIVE consistency.
     */
    if (
      this.status === SACCO_STATUS.LIVE &&
      !this.kycCompleted
    ) {
      return next(
        new Error(
          "A LIVE SACCO must have completed KYC."
        )
      );
    }

    next();
  }
);

/**
 * ============================================================================
 * PRE SAVE
 * ============================================================================
 */

SaccoSchema.pre(
  "save",
  function (next) {
    const now = new Date();

    /**
     * Always update activity timestamp.
     */
    this.lastActivityAt = now;

    /**
     * Track status transitions.
     */
    if (
      this.isModified("status")
    ) {
      this.statusChangedAt = now;
    }

    /**
     * Recalculate onboarding progress.
     */
    this.updateProgress();

    next();
  }
);

/**
 * ============================================================================
 * QUERY MIDDLEWARE
 * ============================================================================
 *
 * Soft-deleted SACCOs should not accidentally appear in normal queries.
 *
 * Explicit queries can still request deleted records using:
 *
 * .setOptions({ includeDeleted: true })
 *
 * ============================================================================
 */

function excludeDeleted(next) {
  if (
    this.getOptions &&
    this.getOptions().includeDeleted === true
  ) {
    return next();
  }

  this.where({
    isDeleted: false,
  });

  next();
}

SaccoSchema.pre(
  "find",
  excludeDeleted
);

SaccoSchema.pre(
  "findOne",
  excludeDeleted
);

SaccoSchema.pre(
  "findOneAndUpdate",
  excludeDeleted
);

SaccoSchema.pre(
  "countDocuments",
  excludeDeleted
);

/**
 * ============================================================================
 * UPDATE QUERY SAFETY
 * ============================================================================
 *
 * Ensure updated documents continue receiving lastActivityAt.
 *
 * ============================================================================
 */

function applyUpdateMetadata(next) {
  const update = this.getUpdate();

  if (!update) {
    return next();
  }

  const now = new Date();

  if (!update.$set) {
    update.$set = {};
  }

  update.$set.lastActivityAt = now;

  if (
    update.$set.status ||
    update.status
  ) {
    update.$set.statusChangedAt = now;
  }

  this.setUpdate(update);

  next();
}

SaccoSchema.pre(
  "findOneAndUpdate",
  applyUpdateMetadata
);

SaccoSchema.pre(
  "updateOne",
  applyUpdateMetadata
);

SaccoSchema.pre(
  "updateMany",
  applyUpdateMetadata
);

/**
 * ============================================================================
 * JSON SETTINGS
 * ============================================================================
 */

SaccoSchema.set(
  "toJSON",
  {
    virtuals: true,

    transform: function (
      doc,
      ret
    ) {
      /**
       * Do not expose internal MongoDB version
       * metadata through standard API serialization.
       */
      delete ret.__v;

      /**
       * Preserve existing document API.
       */
      return ret;
    },
  }
);

SaccoSchema.set(
  "toObject",
  {
    virtuals: true,
  }
);

/**
 * ============================================================================
 * MODEL
 * ============================================================================
 */

const Sacco = mongoose.model(
  "Sacco",
  SaccoSchema
);

/**
 * ============================================================================
 * EXPORTS
 * ============================================================================
 */

module.exports = Sacco;

/**
 * Optional named exports for internal services.
 *
 * Existing:
 *
 * const Sacco = require("./sacco.model");
 *
 * remains fully compatible.
 */
module.exports.SACCO_STATUS =
  SACCO_STATUS;

module.exports.COMPLIANCE_STATUS =
  COMPLIANCE_STATUS;

module.exports.SUBSCRIPTION_PLANS =
  SUBSCRIPTION_PLANS;

module.exports.BILLING_CYCLES =
  BILLING_CYCLES;