/**
 * ============================================================================
 * TITech Community Capital LTD
 * Enterprise Member Model
 * ============================================================================
 *
 * File:
 *   backend/models/Member.js
 *
 * Purpose:
 *   Central member registry and customer profile management for the TITech
 *   Community Capital operating system.
 *
 * Supports:
 *   - Multi-tenant membership
 *   - Member onboarding
 *   - KYC / AML state
 *   - Risk and fraud indicators
 *   - Credit-readiness metadata
 *   - Mobile-money profile metadata
 *   - Beneficiaries
 *   - Next of kin
 *   - Audit metadata
 *   - Dashboard/reporting read models
 *
 * ARCHITECTURAL BOUNDARY
 * ----------------------------------------------------------------------------
 * Member is an identity / customer / risk aggregate.
 *
 * Member is NOT the authoritative source for:
 *   - savings balances
 *   - share balances
 *   - fixed-deposit balances
 *   - loan balances
 *   - transaction balances
 *   - ledger balances
 *   - wallet balances
 *
 * Financial authority remains with the canonical:
 *
 *   Account / Savings / Loan / Transaction / Ledger
 *
 * and their corresponding repositories/services.
 *
 * Derived analytics may be cached on Member only where explicitly controlled
 * by the owning domain service. Financial values must never be mutated here
 * merely as a convenience.
 *
 * TENANT MODEL
 * ----------------------------------------------------------------------------
 * tenantId is a MongoDB ObjectId referencing Tenant.
 *
 * Every operational query must include tenant scope.
 *
 * ESM MODEL CONTRACT
 * ----------------------------------------------------------------------------
 * This file intentionally uses native ESM because the TITech repository uses:
 *
 *   package.json -> "type": "module"
 *
 * Consumers should use:
 *
 *   import Member from "../models/Member.js";
 *
 * ============================================================================
 */

import mongoose from "mongoose";
import validator from "validator";

const { Schema } = mongoose;

/**
 * ============================================================================
 * CONFIGURATION
 * ============================================================================
 */

const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_PHONE_LENGTH = 32;
const MAX_TEXT_LENGTH = 500;
const MAX_LONG_TEXT_LENGTH = 1000;

const MAX_NEXT_OF_KIN = 10;
const MAX_BENEFICIARIES = 20;

const MEMBER_NUMBER_MAX_LENGTH = 64;

const MEMBER_STATUSES = Object.freeze([
  "PENDING",
  "ACTIVE",
  "DORMANT",
  "SUSPENDED",
  "EXITED",
  "DECEASED",
]);

const GENDER_VALUES = Object.freeze([
  "MALE",
  "FEMALE",
  "OTHER",
]);

const MEMBER_TIERS = Object.freeze([
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
]);

const MEMBER_SEGMENTS = Object.freeze([
  "REGULAR",
  "PREMIUM",
  "VIP",
  "CORPORATE",
]);

const KYC_STATUSES = Object.freeze([
  "PENDING",
  "VERIFIED",
  "REJECTED",
]);

const MOBILE_MONEY_PROVIDERS = Object.freeze([
  "MTN",
  "AIRTEL",
]);

const PREFERRED_CHANNELS = Object.freeze([
  "MOBILE_APP",
  "USSD",
  "WEB",
  "AGENT",
]);

/**
 * ============================================================================
 * NORMALIZATION / VALIDATION HELPERS
 * ============================================================================
 */

function normalizeString(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeEmail(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim().toLowerCase();
}

function normalizePhone(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value.trim();
}

function normalizeMemberNumber(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "");
}

function normalizeNationalId(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .toUpperCase();
}

function normalizePassportNumber(value) {
  if (typeof value !== "string") {
    return value;
  }

  return value
    .trim()
    .toUpperCase();
}

function toObjectId(value) {
  if (
    value instanceof mongoose.Types.ObjectId
  ) {
    return value;
  }

  if (
    !value ||
    !mongoose.Types.ObjectId.isValid(value)
  ) {
    return null;
  }

  return new mongoose.Types.ObjectId(value);
}

function isValidObjectId(value) {
  return Boolean(
    value &&
      mongoose.Types.ObjectId.isValid(value)
  );
}

function clampScore(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.min(
    100,
    Math.max(0, numeric)
  );
}

function clampNonNegative(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return 0;
  }

  return Math.max(0, numeric);
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date =
    value instanceof Date
      ? value
      : new Date(value);

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

/**
 * Validate an E.164 phone number.
 */
function isValidE164(value) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    return false;
  }

  return /^\+[1-9]\d{1,14}$/.test(value);
}

/**
 * ============================================================================
 * NEXT OF KIN SCHEMA
 * ============================================================================
 */

const nextOfKinSchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: MAX_NAME_LENGTH,
      set: normalizeString,
    },

    relationship: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
      set: normalizeString,
    },

    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_PHONE_LENGTH,
      set: normalizePhone,
      validate: {
        validator(value) {
          return isValidE164(value);
        },
        message:
          "Next-of-kin phone number must be a valid E.164 number",
      },
    },

    /**
     * National ID remains optional because not every next of kin will have
     * an identifier recorded by the institution.
     *
     * Store only when legally and operationally required.
     */
    nationalId: {
      type: String,
      trim: true,
      maxlength: 100,
      set: normalizeNationalId,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * BENEFICIARY SCHEMA
 * ============================================================================
 */

const beneficiarySchema = new Schema(
  {
    fullName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: MAX_NAME_LENGTH,
      set: normalizeString,
    },

    percentage: {
      type: Number,
      required: true,
      min: 0,
      max: 100,
    },
  },
  {
    _id: false,
  }
);

/**
 * ============================================================================
 * MEMBER SCHEMA
 * ============================================================================
 */

const memberSchema = new Schema(
  {
    /**
     * ========================================================================
     * MULTI-TENANCY
     * ========================================================================
     */

    tenantId: {
      type: Schema.Types.ObjectId,
      ref: "Tenant",
      required: true,
      index: true,
    },

    /**
     * ========================================================================
     * MEMBER IDENTIFICATION
     * ========================================================================
     */

    memberNumber: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: MEMBER_NUMBER_MAX_LENGTH,
      set: normalizeMemberNumber,
    },

    /**
     * The User identity is retained separately from the Member registry.
     *
     * A Member is a customer/member record; User is the authentication
     * identity.
     */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_NAME_LENGTH,
      set: normalizeString,
    },

    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: MAX_NAME_LENGTH,
      set: normalizeString,
    },

    otherNames: {
      type: String,
      trim: true,
      maxlength: MAX_NAME_LENGTH,
      set: normalizeString,
    },

    gender: {
      type: String,
      enum: GENDER_VALUES,
      default: null,
    },

    dateOfBirth: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * CONTACTS
     * ========================================================================
     */

    email: {
      type: String,
      trim: true,
      lowercase: true,
      maxlength: MAX_EMAIL_LENGTH,
      set: normalizeEmail,
      validate: {
        validator(value) {
          return (
            !value ||
            validator.isEmail(value)
          );
        },
        message:
          "Member email must be a valid email address",
      },
    },

    phoneNumber: {
      type: String,
      required: true,
      trim: true,
      maxlength: MAX_PHONE_LENGTH,
      set: normalizePhone,
      validate: {
        validator(value) {
          return isValidE164(value);
        },
        message:
          "Member phone number must be a valid E.164 number",
      },
    },

    alternatePhoneNumber: {
      type: String,
      trim: true,
      maxlength: MAX_PHONE_LENGTH,
      set: normalizePhone,
      validate: {
        validator(value) {
          return (
            !value ||
            isValidE164(value)
          );
        },
        message:
          "Alternate phone number must be a valid E.164 number",
      },
    },

    address: {
      type: String,
      trim: true,
      maxlength: MAX_TEXT_LENGTH,
      set: normalizeString,
    },

    district: {
      type: String,
      trim: true,
      maxlength: 100,
      set: normalizeString,
    },

    subCounty: {
      type: String,
      trim: true,
      maxlength: 100,
      set: normalizeString,
    },

    village: {
      type: String,
      trim: true,
      maxlength: 100,
      set: normalizeString,
    },

    /**
     * ========================================================================
     * NATIONAL IDENTIFICATION
     * ========================================================================
     *
     * PII must be protected at the service/security layer.
     * Do not expose these fields through uncontrolled API serialization.
     */

    nationalId: {
      type: String,
      trim: true,
      maxlength: 100,
      set: normalizeNationalId,
      select: false,
    },

    passportNumber: {
      type: String,
      trim: true,
      maxlength: 100,
      set: normalizePassportNumber,
      select: false,
    },

    /**
     * ========================================================================
     * MEMBERSHIP
     * ========================================================================
     */

    memberStatus: {
      type: String,
      enum: MEMBER_STATUSES,
      default: "PENDING",
      required: true,
      index: true,
    },

    joinedAt: {
      type: Date,
      default: null,
    },

    exitedAt: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * EMPLOYMENT
     * ========================================================================
     */

    occupation: {
      type: String,
      trim: true,
      maxlength: 150,
      set: normalizeString,
    },

    employer: {
      type: String,
      trim: true,
      maxlength: 200,
      set: normalizeString,
    },

    monthlyIncome: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * ========================================================================
     * CREDIT / RISK
     * ========================================================================
     *
     * These are analytical/derived indicators.
     * They are not financial balances.
     */

    creditScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    fraudRiskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    fraudFlagged: {
      type: Boolean,
      default: false,
      index: true,
    },

    blacklisted: {
      type: Boolean,
      default: false,
      index: true,
    },

    blacklistedAt: {
      type: Date,
      default: null,
    },

    blacklistedReason: {
      type: String,
      maxlength: MAX_LONG_TEXT_LENGTH,
      trim: true,
      set: normalizeString,
    },

    sanctionsScreened: {
      type: Boolean,
      default: false,
    },

    sanctionsScreenedAt: {
      type: Date,
      default: null,
    },

    memberTier: {
      type: String,
      enum: MEMBER_TIERS,
      default: "BRONZE",
      index: true,
    },

    /**
     * ========================================================================
     * MEMBER SEGMENTATION
     * ========================================================================
     */

    memberSegment: {
      type: String,
      enum: MEMBER_SEGMENTS,
      default: "REGULAR",
      index: true,
    },

    memberHealthScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    loanEligibilityScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100,
    },

    guarantorCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    guaranteedLoansCount: {
      type: Number,
      default: 0,
      min: 0,
    },

    activeSavingsAccounts: {
      type: Number,
      default: 0,
      min: 0,
    },

    activeFixedDeposits: {
      type: Number,
      default: 0,
      min: 0,
    },

    /**
     * ========================================================================
     * KYC / AML
     * ========================================================================
     */

    kycStatus: {
      type: String,
      enum: KYC_STATUSES,
      default: "PENDING",
      index: true,
    },

    kycVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    kycVerifiedAt: {
      type: Date,
      default: null,
    },

    amlChecked: {
      type: Boolean,
      default: false,
      index: true,
    },

    amlCheckedAt: {
      type: Date,
      default: null,
    },

    /**
     * ========================================================================
     * MOBILE MONEY
     * ========================================================================
     */

    momoRegistered: {
      type: Boolean,
      default: false,
    },

    momoProvider: {
      type: String,
      enum: MOBILE_MONEY_PROVIDERS,
      default: null,
    },

    preferredChannel: {
      type: String,
      enum: PREFERRED_CHANNELS,
      default: "MOBILE_APP",
    },

    /**
     * ========================================================================
     * DEPRECATED FINANCIAL SNAPSHOT FIELDS
     * ========================================================================
     *
     * IMPORTANT:
     *
     * Older TITech code may still read these fields.
     *
     * They are deliberately NOT used by:
     *
     *   - validation
     *   - tier automation
     *   - financial calculations
     *   - ledger posting
     *   - transaction processing
     *
     * These values should be considered legacy/derived compatibility data until
     * the remaining consumers are migrated to the authoritative financial
     * services.
     *
     * New services MUST NOT write to them.
     */

    savingsBalance: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    sharesBalance: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    fixedDepositBalance: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    activeLoans: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    totalLoansTaken: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    outstandingLoanBalance: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    totalAmountBorrowed: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    totalAmountRepaid: {
      type: Number,
      default: 0,
      min: 0,
      deprecated: true,
    },

    /**
     * ========================================================================
     * NEXT OF KIN
     * ========================================================================
     */

    nextOfKin: {
      type: [nextOfKinSchema],
      default: [],
      validate: {
        validator(value) {
          return (
            Array.isArray(value) &&
            value.length <= MAX_NEXT_OF_KIN
          );
        },
        message:
          `A member cannot have more than ${MAX_NEXT_OF_KIN} next-of-kin records`,
      },
    },

    /**
     * ========================================================================
     * BENEFICIARIES
     * ========================================================================
     */

    beneficiaries: {
      type: [beneficiarySchema],
      default: [],
      validate: {
        validator(value) {
          if (
            !Array.isArray(value) ||
            value.length > MAX_BENEFICIARIES
          ) {
            return false;
          }

          const total = value.reduce(
            (sum, beneficiary) =>
              sum +
              Number(
                beneficiary?.percentage || 0
              ),
            0
          );

          return total <= 100;
        },
        message:
          "Beneficiary percentages must total 100% or less",
      },
    },

    /**
     * ========================================================================
     * AUDIT / ACTIVITY
     * ========================================================================
     */

    auditReference: {
      type: String,
      trim: true,
      maxlength: 200,
    },

    lastLoginAt: {
      type: Date,
      default: null,
    },

    lastTransactionAt: {
      type: Date,
      default: null,
    },

    lastLoanApplicationAt: {
      type: Date,
      default: null,
    },

    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    workflowVersion: {
      type: Number,
      default: 1,
      min: 1,
    },

    /**
     * ========================================================================
     * SOFT DELETE
     * ========================================================================
     */

    deletedAt: {
      type: Date,
      default: null,
      index: true,
    },

    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /**
     * ========================================================================
     * SCHEMA VERSION
     * ========================================================================
     */

    schemaVersion: {
      type: Number,
      default: 2,
      min: 1,
    },
  },
  {
    timestamps: true,
    versionKey: "__v",
    optimisticConcurrency: true,
    strict: true,

    toJSON: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id
          ? ret._id.toString()
          : undefined;

        delete ret._id;
        delete ret.__v;

        /**
         * Sensitive PII.
         *
         * Explicit administrative/security projections should be used when
         * this data is legitimately required.
         */
        delete ret.nationalId;
        delete ret.passportNumber;

        return ret;
      },
    },

    toObject: {
      virtuals: true,

      transform(doc, ret) {
        ret.id = ret._id
          ? ret._id.toString()
          : undefined;

        delete ret._id;
        delete ret.__v;

        delete ret.nationalId;
        delete ret.passportNumber;

        return ret;
      },
    },
  }
);

/**
 * ============================================================================
 * VIRTUALS
 * ============================================================================
 */

memberSchema.virtual("fullName")
  .get(function fullName() {
    return [
      this.firstName,
      this.otherNames,
      this.lastName,
    ]
      .filter(Boolean)
      .join(" ");
  });

memberSchema.virtual("isHighRisk")
  .get(function isHighRisk() {
    return this.riskScore >= 80;
  });

memberSchema.virtual("isFraudRisk")
  .get(function isFraudRisk() {
    return this.fraudRiskScore >= 80;
  });

memberSchema.virtual("isBlacklisted")
  .get(function isBlacklisted() {
    return this.blacklisted === true;
  });

memberSchema.virtual("isKYCComplete")
  .get(function isKYCComplete() {
    return (
      this.kycVerified === true &&
      this.kycStatus === "VERIFIED"
    );
  });

memberSchema.virtual("isAMLComplete")
  .get(function isAMLComplete() {
    return this.amlChecked === true;
  });

memberSchema.virtual("isEligibleForLoan")
  .get(function isEligibleForLoan() {
    return (
      this.loanEligibilityScore >= 70 &&
      this.memberStatus === "ACTIVE" &&
      this.blacklisted !== true &&
      this.fraudFlagged !== true &&
      this.kycVerified === true &&
      this.amlChecked === true
    );
  });

memberSchema.virtual("memberSinceYears")
  .get(function memberSinceYears() {
    if (!this.joinedAt) {
      return 0;
    }

    const joinedAt =
      this.joinedAt instanceof Date
        ? this.joinedAt
        : new Date(this.joinedAt);

    if (
      Number.isNaN(
        joinedAt.getTime()
      )
    ) {
      return 0;
    }

    return Math.max(
      0,
      Math.floor(
        (
          Date.now() -
          joinedAt.getTime()
        ) /
          (
            1000 *
            60 *
            60 *
            24 *
            365.25
          )
      )
    );
  });

memberSchema.virtual("isExited")
  .get(function isExited() {
    return (
      this.memberStatus === "EXITED"
    );
  });

memberSchema.virtual("isActiveMember")
  .get(function isActiveMember() {
    return (
      this.memberStatus === "ACTIVE" &&
      !this.deletedAt
    );
  });

/**
 * ============================================================================
 * VALIDATION / NORMALIZATION MIDDLEWARE
 * ============================================================================
 */

memberSchema.pre(
  "validate",
  function normalizeMemberFields(next) {
    this.memberNumber =
      normalizeMemberNumber(
        this.memberNumber
      );

    this.firstName =
      normalizeString(
        this.firstName
      );

    this.lastName =
      normalizeString(
        this.lastName
      );

    this.otherNames =
      normalizeString(
        this.otherNames
      );

    this.email =
      normalizeEmail(
        this.email
      );

    this.phoneNumber =
      normalizePhone(
        this.phoneNumber
      );

    this.alternatePhoneNumber =
      normalizePhone(
        this.alternatePhoneNumber
      );

    this.nationalId =
      normalizeNationalId(
        this.nationalId
      );

    this.passportNumber =
      normalizePassportNumber(
        this.passportNumber
      );

    this.tenantId =
      toObjectId(
        this.tenantId
      );

    this.userId =
      toObjectId(
        this.userId
      );

    this.createdBy =
      toObjectId(
        this.createdBy
      );

    this.updatedBy =
      toObjectId(
        this.updatedBy
      );

    this.deletedBy =
      toObjectId(
        this.deletedBy
      );

    /**
     * Normalize analytical score fields.
     *
     * These are derived indicators, not financial balances.
     */
    this.creditScore =
      clampScore(
        this.creditScore
      );

    this.riskScore =
      clampScore(
        this.riskScore
      );

    this.fraudRiskScore =
      clampScore(
        this.fraudRiskScore
      );

    this.memberHealthScore =
      clampScore(
        this.memberHealthScore
      );

    this.loanEligibilityScore =
      clampScore(
        this.loanEligibilityScore
      );

    /**
     * Normalize count fields.
     */
    this.guarantorCount =
      Math.floor(
        clampNonNegative(
          this.guarantorCount
        )
      );

    this.guaranteedLoansCount =
      Math.floor(
        clampNonNegative(
          this.guaranteedLoansCount
        )
      );

    this.activeSavingsAccounts =
      Math.floor(
        clampNonNegative(
          this.activeSavingsAccounts
        )
      );

    this.activeFixedDeposits =
      Math.floor(
        clampNonNegative(
          this.activeFixedDeposits
        )
      );

    /**
     * Normalize lifecycle dates.
     */
    this.joinedAt =
      normalizeDate(
        this.joinedAt
      );

    this.exitedAt =
      normalizeDate(
        this.exitedAt
      );

    this.kycVerifiedAt =
      normalizeDate(
        this.kycVerifiedAt
      );

    this.amlCheckedAt =
      normalizeDate(
        this.amlCheckedAt
      );

    this.blacklistedAt =
      normalizeDate(
        this.blacklistedAt
      );

    this.sanctionsScreenedAt =
      normalizeDate(
        this.sanctionsScreenedAt
      );

    return next();
  }
);

/**
 * ============================================================================
 * BUSINESS-INTEGRITY VALIDATION
 * ============================================================================
 */

memberSchema.pre(
  "validate",
  function validateMemberLifecycle(next) {
    if (
      this.memberStatus === "ACTIVE" &&
      !this.joinedAt
    ) {
      this.joinedAt = new Date();
    }

    if (
      this.memberStatus !== "EXITED" &&
      this.exitedAt
    ) {
      this.invalidate(
        "exitedAt",
        "Only exited members should have an exitedAt timestamp"
      );
    }

    if (
      this.memberStatus === "EXITED" &&
      !this.exitedAt
    ) {
      this.exitedAt = new Date();
    }

    if (
      this.kycStatus === "VERIFIED" &&
      !this.kycVerified
    ) {
      this.invalidate(
        "kycVerified",
        "A VERIFIED KYC status requires kycVerified=true"
      );
    }

    if (
      this.kycVerified &&
      this.kycStatus !== "VERIFIED"
    ) {
      this.kycStatus = "VERIFIED";
    }

    if (
      this.blacklisted &&
      !this.blacklistedAt
    ) {
      this.blacklistedAt = new Date();
    }

    if (
      !this.blacklisted &&
      this.blacklistedAt
    ) {
      this.blacklistedAt = null;
    }

    if (
      this.sanctionsScreened &&
      !this.sanctionsScreenedAt
    ) {
      this.sanctionsScreenedAt =
        new Date();
    }

    return next();
  }
);

/**
 * ============================================================================
 * FINANCIAL-COMPATIBILITY GUARD
 * ============================================================================
 *
 * The legacy financial snapshot fields remain in the schema temporarily so
 * existing documents can be read during migration.
 *
 * New business logic must never derive tier/risk/eligibility from them.
 *
 * This hook intentionally does NOT mutate financial values.
 *
 * The owning financial service must be the sole authority for changes.
 * ============================================================================
 */

/**
 * ============================================================================
 * MEMBER METHODS
 * ============================================================================
 */

/**
 * Check tenant ownership safely.
 */
memberSchema.methods.belongsToTenant =
  function belongsToTenant(
    tenantId
  ) {
    if (
      !this.tenantId ||
      !tenantId
    ) {
      return false;
    }

    return (
      String(this.tenantId) ===
      String(tenantId)
    );
  };

/**
 * Check whether member is operationally active.
 */
memberSchema.methods.isOperational =
  function isOperational() {
    return (
      this.memberStatus === "ACTIVE" &&
      this.deletedAt === null &&
      this.blacklisted !== true &&
      this.memberStatus !== "SUSPENDED"
    );
  };

/**
 * Mark member as active.
 */
memberSchema.methods.activate =
  async function activate() {
    this.memberStatus = "ACTIVE";

    if (!this.joinedAt) {
      this.joinedAt = new Date();
    }

    this.exitedAt = null;

    return this.save();
  };

/**
 * Suspend member.
 */
memberSchema.methods.suspend =
  async function suspend() {
    this.memberStatus = "SUSPENDED";

    return this.save();
  };

/**
 * Mark member exited.
 */
memberSchema.methods.exit =
  async function exit() {
    this.memberStatus = "EXITED";
    this.exitedAt = new Date();

    return this.save();
  };

/**
 * Mark deceased.
 */
memberSchema.methods.markDeceased =
  async function markDeceased() {
    this.memberStatus = "DECEASED";

    return this.save();
  };

/**
 * Mark dormant.
 */
memberSchema.methods.markDormant =
  async function markDormant() {
    this.memberStatus = "DORMANT";

    return this.save();
  };

/**
 * Soft delete member.
 */
memberSchema.methods.softDelete =
  async function softDelete(
    deletedBy = null
  ) {
    this.deletedAt = new Date();
    this.deletedBy =
      toObjectId(deletedBy);

    if (
      this.memberStatus !==
      "DECEASED"
    ) {
      this.memberStatus =
        "EXITED";
    }

    return this.save();
  };

/**
 * Restore a soft-deleted member.
 */
memberSchema.methods.restore =
  async function restore() {
    this.deletedAt = null;
    this.deletedBy = null;

    if (
      this.memberStatus ===
      "EXITED"
    ) {
      this.memberStatus =
        "ACTIVE";

      if (!this.joinedAt) {
        this.joinedAt =
          new Date();
      }
    }

    return this.save();
  };

/**
 * Update KYC state.
 */
memberSchema.methods.markKYCVerified =
  async function markKYCVerified() {
    this.kycStatus = "VERIFIED";
    this.kycVerified = true;
    this.kycVerifiedAt = new Date();

    return this.save();
  };

/**
 * Reject KYC.
 */
memberSchema.methods.rejectKYC =
  async function rejectKYC() {
    this.kycStatus = "REJECTED";
    this.kycVerified = false;
    this.kycVerifiedAt = null;

    return this.save();
  };

/**
 * Mark AML screening complete.
 */
memberSchema.methods.markAMLChecked =
  async function markAMLChecked() {
    this.amlChecked = true;
    this.amlCheckedAt = new Date();

    return this.save();
  };

/**
 * Flag for fraud review.
 */
memberSchema.methods.flagFraud =
  async function flagFraud(
    fraudRiskScore = 80
  ) {
    this.fraudFlagged = true;
    this.fraudRiskScore =
      clampScore(
        fraudRiskScore
      );

    return this.save();
  };

/**
 * Clear fraud flag after authorized review.
 */
memberSchema.methods.clearFraudFlag =
  async function clearFraudFlag(
    fraudRiskScore = 0
  ) {
    this.fraudFlagged = false;
    this.fraudRiskScore =
      clampScore(
        fraudRiskScore
      );

    return this.save();
  };

/**
 * Blacklist member.
 */
memberSchema.methods.blacklistMember =
  async function blacklistMember(
    reason = null
  ) {
    this.blacklisted = true;
    this.blacklistedAt = new Date();

    this.blacklistedReason =
      reason
        ? normalizeString(reason)
        : null;

    return this.save();
  };

/**
 * Remove blacklist after authorized review.
 */
memberSchema.methods.removeBlacklist =
  async function removeBlacklist() {
    this.blacklisted = false;
    this.blacklistedAt = null;
    this.blacklistedReason = null;

    return this.save();
  };

/**
 * ============================================================================
 * STATIC HELPERS
 * ============================================================================
 */

/**
 * Tenant-scoped member lookup by ID.
 */
memberSchema.statics.findTenantMember =
  function findTenantMember(
    tenantId,
    memberId,
    {
      includeDeleted = false,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const memberObjectId =
      toObjectId(memberId);

    if (
      !tenantObjectId ||
      !memberObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    const query = {
      _id: memberObjectId,
      tenantId: tenantObjectId,
    };

    if (!includeDeleted) {
      query.deletedAt = null;
    }

    return this.findOne(query);
  };

/**
 * Tenant-scoped member-number lookup.
 */
memberSchema.statics.findByMemberNumber =
  function findByMemberNumber(
    tenantId,
    memberNumber,
    {
      includeDeleted = false,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (
      !tenantObjectId ||
      typeof memberNumber !==
        "string"
    ) {
      return this.findOne({
        _id: null,
      });
    }

    const query = {
      tenantId: tenantObjectId,
      memberNumber:
        normalizeMemberNumber(
          memberNumber
        ),
    };

    if (!includeDeleted) {
      query.deletedAt = null;
    }

    return this.findOne(query);
  };

/**
 * Tenant-scoped phone lookup.
 */
memberSchema.statics.findByPhoneNumber =
  function findByPhoneNumber(
    tenantId,
    phoneNumber
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (
      !tenantObjectId ||
      typeof phoneNumber !==
        "string"
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId: tenantObjectId,
      phoneNumber:
        normalizePhone(
          phoneNumber
        ),
      deletedAt: null,
    });
  };

/**
 * Tenant-scoped user-to-member lookup.
 */
memberSchema.statics.findByUserId =
  function findByUserId(
    tenantId,
    userId
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    const userObjectId =
      toObjectId(userId);

    if (
      !tenantObjectId ||
      !userObjectId
    ) {
      return this.findOne({
        _id: null,
      });
    }

    return this.findOne({
      tenantId: tenantObjectId,
      userId: userObjectId,
      deletedAt: null,
    });
  };

/**
 * Tenant-scoped active-member query.
 */
memberSchema.statics.findActiveMembers =
  function findActiveMembers(
    tenantId,
    {
      skip = 0,
      limit = 100,
      sort = {
        createdAt: -1,
      },
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (!tenantObjectId) {
      return this.findOne({
        _id: null,
      });
    }

    const safeSkip =
      Math.max(
        0,
        Number.parseInt(
          skip,
          10
        ) || 0
      );

    const safeLimit =
      Math.min(
        100,
        Math.max(
          1,
          Number.parseInt(
            limit,
            10
          ) || 100
        )
      );

    return this.find({
      tenantId: tenantObjectId,
      memberStatus: "ACTIVE",
      deletedAt: null,
    })
      .sort(sort)
      .skip(safeSkip)
      .limit(safeLimit);
  };

/**
 * Tenant-level count.
 */
memberSchema.statics.countTenantMembers =
  function countTenantMembers(
    tenantId,
    {
      status = null,
    } = {}
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (!tenantObjectId) {
      return Promise.resolve(0);
    }

    const query = {
      tenantId: tenantObjectId,
      deletedAt: null,
    };

    if (
      status &&
      MEMBER_STATUSES.includes(
        status
      )
    ) {
      query.memberStatus = status;
    }

    return this.countDocuments(query);
  };

/**
 * Tenant dashboard summary.
 */
memberSchema.statics.getTenantSummary =
  async function getTenantSummary(
    tenantId
  ) {
    const tenantObjectId =
      toObjectId(tenantId);

    if (!tenantObjectId) {
      return {
        totalMembers: 0,
        activeMembers: 0,
        dormantMembers: 0,
        suspendedMembers: 0,
        exitedMembers: 0,
        deceasedMembers: 0,
        pendingKyc: 0,
        verifiedKyc: 0,
        amlOutstanding: 0,
        highRiskMembers: 0,
        fraudFlaggedMembers: 0,
        blacklistedMembers: 0,
      };
    }

    const baseMatch = {
      tenantId: tenantObjectId,
      deletedAt: null,
    };

    const [
      memberCounts,
      complianceCounts,
      riskCounts,
    ] = await Promise.all([
      this.aggregate([
        {
          $match: baseMatch,
        },
        {
          $group: {
            _id: "$memberStatus",
            count: {
              $sum: 1,
            },
          },
        },
      ]),

      this.aggregate([
        {
          $match: baseMatch,
        },
        {
          $group: {
            _id: null,

            pendingKyc: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$kycStatus",
                      "PENDING",
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            verifiedKyc: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$kycStatus",
                      "VERIFIED",
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            amlOutstanding: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$amlChecked",
                      false,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),

      this.aggregate([
        {
          $match: baseMatch,
        },
        {
          $group: {
            _id: null,

            highRiskMembers: {
              $sum: {
                $cond: [
                  {
                    $gte: [
                      "$riskScore",
                      80,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            fraudFlaggedMembers: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$fraudFlagged",
                      true,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },

            blacklistedMembers: {
              $sum: {
                $cond: [
                  {
                    $eq: [
                      "$blacklisted",
                      true,
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
    ]);

    const counts = Object.fromEntries(
      memberCounts.map(
        (entry) => [
          entry._id,
          entry.count,
        ]
      )
    );

    return {
      totalMembers:
        memberCounts.reduce(
          (sum, entry) =>
            sum + entry.count,
          0
        ),

      activeMembers:
        counts.ACTIVE || 0,

      dormantMembers:
        counts.DORMANT || 0,

      suspendedMembers:
        counts.SUSPENDED || 0,

      exitedMembers:
        counts.EXITED || 0,

      deceasedMembers:
        counts.DECEASED || 0,

      pendingKyc:
        complianceCounts[0]
          ?.pendingKyc || 0,

      verifiedKyc:
        complianceCounts[0]
          ?.verifiedKyc || 0,

      amlOutstanding:
        complianceCounts[0]
          ?.amlOutstanding || 0,

      highRiskMembers:
        riskCounts[0]
          ?.highRiskMembers || 0,

      fraudFlaggedMembers:
        riskCounts[0]
          ?.fraudFlaggedMembers || 0,

      blacklistedMembers:
        riskCounts[0]
          ?.blacklistedMembers || 0,
    };
  };

/**
 * ============================================================================
 * INDEXES
 * ============================================================================
 */

/**
 * Primary tenant/member identity.
 *
 * A member number is unique inside an institution.
 */
memberSchema.index(
  {
    tenantId: 1,
    memberNumber: 1,
  },
  {
    unique: true,
    name: "uq_member_tenant_member_number",
  }
);

/**
 * Prevent multiple member profiles for the same User inside a tenant.
 *
 * Sparse is used because legacy/manual members may exist without a linked
 * authentication User during migration/onboarding.
 */
memberSchema.index(
  {
    tenantId: 1,
    userId: 1,
  },
  {
    unique: true,
    sparse: true,
    name: "uq_member_tenant_user",
  }
);

/**
 * Member administration.
 */
memberSchema.index({
  tenantId: 1,
  memberStatus: 1,
  createdAt: -1,
});

/**
 * Phone lookup.
 */
memberSchema.index({
  tenantId: 1,
  phoneNumber: 1,
});

/**
 * National ID lookup.
 *
 * Non-unique intentionally: existing data migrations may contain unresolved
 * duplicates which should be investigated rather than making them impossible
 * to ingest blindly.
 */
memberSchema.index({
  tenantId: 1,
  nationalId: 1,
});

/**
 * Credit analytics.
 */
memberSchema.index({
  tenantId: 1,
  creditScore: -1,
});

memberSchema.index({
  tenantId: 1,
  riskScore: -1,
});

/**
 * Fraud operations.
 */
memberSchema.index({
  tenantId: 1,
  fraudFlagged: 1,
});

memberSchema.index({
  tenantId: 1,
  blacklisted: 1,
});

/**
 * Compliance queues.
 */
memberSchema.index({
  tenantId: 1,
  kycStatus: 1,
});

memberSchema.index({
  tenantId: 1,
  amlChecked: 1,
});

/**
 * Segmentation.
 */
memberSchema.index({
  tenantId: 1,
  memberTier: 1,
});

memberSchema.index({
  tenantId: 1,
  memberSegment: 1,
});

/**
 * Eligibility / health analytics.
 */
memberSchema.index({
  tenantId: 1,
  loanEligibilityScore: -1,
});

memberSchema.index({
  tenantId: 1,
  memberHealthScore: -1,
});

/**
 * Recent onboarding.
 */
memberSchema.index({
  tenantId: 1,
  createdAt: -1,
});

/**
 * Soft-delete filtering.
 */
memberSchema.index({
  tenantId: 1,
  deletedAt: 1,
});

/**
 * Active member + phone queries.
 */
memberSchema.index({
  tenantId: 1,
  phoneNumber: 1,
  memberStatus: 1,
});

/**
 * ============================================================================
 * MODEL METADATA
 * ============================================================================
 */

export const MEMBER_MODEL_METADATA =
  Object.freeze({
    modelName: "Member",
    schemaVersion: 2,

    tenantField:
      "tenantId",

    tenantFieldType:
      "ObjectId",

    financialAuthority:
      false,

    financialAuthorityModels: [
      "Account",
      "Savings",
      "Loan",
      "Transaction",
      "Ledger",
    ],

    legacyFinancialSnapshotFields: [
      "savingsBalance",
      "sharesBalance",
      "fixedDepositBalance",
      "activeLoans",
      "totalLoansTaken",
      "outstandingLoanBalance",
      "totalAmountBorrowed",
      "totalAmountRepaid",
    ],

    canonicalIdentityLink:
      "userId",

    memberNumberUniqueness:
      "tenant-scoped",

    piiFieldsProtected: [
      "nationalId",
      "passportNumber",
    ],
  });

/**
 * ============================================================================
 * MODEL EXPORT
 * ============================================================================
 */

export const Member =
  mongoose.models.Member ||
  mongoose.model(
    "Member",
    memberSchema
  );

export default Member;

/**
 * ============================================================================
 * CONSTANT EXPORTS
 * ============================================================================
 */

export {
  MEMBER_STATUSES,
  GENDER_VALUES,
  MEMBER_TIERS,
  MEMBER_SEGMENTS,
  KYC_STATUSES,
  MOBILE_MONEY_PROVIDERS,
  PREFERRED_CHANNELS,
  normalizeEmail,
  normalizePhone,
  normalizeMemberNumber,
  normalizeNationalId,
  normalizePassportNumber,
  isValidObjectId,
};