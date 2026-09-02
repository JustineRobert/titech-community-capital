"use strict";

/**
 * =============================================================================
 * TITech Community Capital LTD
 * TITech Community Capital Operating System
 * =============================================================================
 *
 * File:
 *   backend/models/Referral.js
 *
 * Purpose:
 *   Enterprise-grade referral, reward, attribution and anti-abuse model.
 *
 * Architectural Role:
 *
 *   Referrer
 *      │
 *      ▼
 *   Referral Code
 *      │
 *      ▼
 *   Referred User
 *      │
 *      ├── Verification
 *      ├── Eligibility
 *      ├── Contribution
 *      ├── Fraud Screening
 *      └── Reward Qualification
 *                 │
 *                 ▼
 *          Reward Issuance
 *                 │
 *                 ▼
 *           Ledger / Wallet
 *
 * IMPORTANT:
 *
 *   This model records referral business state.
 *
 *   It MUST NOT directly mutate account balances.
 *
 *   Monetary rewards should be issued through the authoritative TITech
 *   transaction / double-entry ledger system using an idempotency key.
 *
 * =============================================================================
 */

const mongoose = require("mongoose");
const crypto = require("crypto");

const { Schema } = mongoose;

/**
 * =============================================================================
 * CONSTANTS
 * =============================================================================
 */

const REFERRAL_STATUSES = [
    "PENDING",
    "ELIGIBLE",
    "COMPLETED",
    "EXPIRED",
    "FRAUD_REVIEW",
    "FRAUDULENT",
    "CANCELLED",
];

const REWARD_TYPES = [
    "BONUS_CREDIT",
    "CASH",
    "POINTS",
    "SAVINGS_BOOST",
];

const REWARD_STATUSES = [
    "NOT_ELIGIBLE",
    "ELIGIBLE",
    "PENDING",
    "PROCESSING",
    "ISSUED",
    "FAILED",
    "CANCELLED",
];

const FRAUD_SEVERITIES = [
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL",
];

const FRAUD_REVIEW_STATUSES = [
    "NOT_REVIEWED",
    "PENDING",
    "UNDER_REVIEW",
    "CLEARED",
    "CONFIRMED",
];

const MAX_CODE_LENGTH = 128;
const MAX_REASON_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 128;

/**
 * =============================================================================
 * MONEY SCHEMA
 * =============================================================================
 *
 * Decimal128 prevents JavaScript floating-point precision problems.
 */

const MoneySchema = new Schema(
    {
        amount: {
            type: Schema.Types.Decimal128,
            required: true,
            default: () =>
                mongoose.Types.Decimal128.fromString("0.00"),
        },

        currency: {
            type: String,
            required: true,
            uppercase: true,
            trim: true,
            maxlength: 10,
        },
    },
    {
        _id: false,
        id: false,
    }
);

/**
 * =============================================================================
 * FRAUD SIGNAL SCHEMA
 * =============================================================================
 */

const FraudSignalSchema = new Schema(
    {
        type: {
            type: String,
            trim: true,
            maxlength: 128,
            required: true,
        },

        severity: {
            type: String,
            enum: FRAUD_SEVERITIES,
            default: "MEDIUM",
        },

        score: {
            type: Number,
            min: 0,
            max: 100,
            default: 0,
        },

        detectedAt: {
            type: Date,
            default: Date.now,
        },

        details: {
            type: Schema.Types.Mixed,
            default: undefined,
        },
    },
    {
        _id: false,
        id: false,
    }
);

/**
 * =============================================================================
 * MAIN REFERRAL SCHEMA
 * =============================================================================
 */

const ReferralSchema = new Schema(
    {
        /**
         * ---------------------------------------------------------------------
         * TENANCY
         * ---------------------------------------------------------------------
         */

        tenantId: {
            type: Schema.Types.ObjectId,
            ref: "Tenant",
            required: true,
            immutable: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * REFERRER
         * ---------------------------------------------------------------------
         */

        referrer: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Referrer is required"],
            immutable: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * REFEREE
         * ---------------------------------------------------------------------
         *
         * A user should normally only be attributed to one referral.
         */

        referee: {
            type: Schema.Types.ObjectId,
            ref: "User",
            required: [true, "Referee is required"],
            immutable: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * REFERRAL CODE
         * ---------------------------------------------------------------------
         */

        referralCode: {
            type: String,
            required: true,
            unique: true,
            immutable: true,
            trim: true,
            uppercase: true,
            minlength: 8,
            maxlength: MAX_CODE_LENGTH,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * CAMPAIGN / ATTRIBUTION
         * ---------------------------------------------------------------------
         */

        campaignId: {
            type: String,
            trim: true,
            maxlength: 256,
            default: null,
            index: true,
        },

        referralSource: {
            type: String,
            trim: true,
            maxlength: MAX_SOURCE_LENGTH,
            default: null,
        },

        attribution: {
            channel: {
                type: String,
                trim: true,
                maxlength: 128,
                default: null,
            },

            medium: {
                type: String,
                trim: true,
                maxlength: 128,
                default: null,
            },

            source: {
                type: String,
                trim: true,
                maxlength: 128,
                default: null,
            },

            campaign: {
                type: String,
                trim: true,
                maxlength: 256,
                default: null,
            },
        },

        /**
         * ---------------------------------------------------------------------
         * LIFECYCLE
         * ---------------------------------------------------------------------
         */

        status: {
            type: String,
            enum: REFERRAL_STATUSES,
            default: "PENDING",
            required: true,
            index: true,
        },

        createdAtSource: {
            type: String,
            trim: true,
            maxlength: 128,
            default: null,
        },

        completedAt: {
            type: Date,
            default: null,
            index: true,
        },

        expiredAt: {
            type: Date,
            default: null,
        },

        cancelledAt: {
            type: Date,
            default: null,
        },

        cancellationReason: {
            type: String,
            trim: true,
            maxlength: MAX_REASON_LENGTH,
            default: null,
        },

        /**
         * ---------------------------------------------------------------------
         * ELIGIBILITY
         * ---------------------------------------------------------------------
         */

        emailVerified: {
            type: Boolean,
            default: false,
        },

        firstContributionAt: {
            type: Date,
            default: null,
        },

        eligibility: {
            qualified: {
                type: Boolean,
                default: false,
            },

            qualifiedAt: {
                type: Date,
                default: null,
            },

            reason: {
                type: String,
                trim: true,
                maxlength: MAX_REASON_LENGTH,
                default: null,
            },

            contributionRequired: {
                type: Boolean,
                default: true,
            },

            minimumContribution: {
                type: MoneySchema,
                default: null,
            },
        },

        /**
         * ---------------------------------------------------------------------
         * REWARD CONFIGURATION
         * ---------------------------------------------------------------------
         */

        rewardAmount: {
            type: Schema.Types.Decimal128,
            default: () =>
                mongoose.Types.Decimal128.fromString("0.00"),
        },

        rewardCurrency: {
            type: String,
            uppercase: true,
            trim: true,
            maxlength: 10,
            default: "UGX",
        },

        rewardType: {
            type: String,
            enum: REWARD_TYPES,
            default: "BONUS_CREDIT",
            required: true,
        },

        rewardStatus: {
            type: String,
            enum: REWARD_STATUSES,
            default: "NOT_ELIGIBLE",
            index: true,
        },

        rewardIssued: {
            type: Boolean,
            default: false,
            index: true,
        },

        rewardIssuedAt: {
            type: Date,
            default: null,
        },

        rewardFailedAt: {
            type: Date,
            default: null,
        },

        rewardFailureReason: {
            type: String,
            trim: true,
            maxlength: MAX_REASON_LENGTH,
            default: null,
        },

        /**
         * ---------------------------------------------------------------------
         * REWARD IDEMPOTENCY
         * ---------------------------------------------------------------------
         *
         * This key should be passed to the transaction/ledger service.
         */

        rewardIdempotencyKey: {
            type: String,
            trim: true,
            maxlength: 256,
            immutable: true,
            default: null,
            index: true,
        },

        rewardTransactionId: {
            type: Schema.Types.ObjectId,
            ref: "Transaction",
            default: null,
        },

        rewardLedgerEntryId: {
            type: Schema.Types.ObjectId,
            ref: "LedgerEntry",
            default: null,
        },

        /**
         * ---------------------------------------------------------------------
         * FRAUD / ANTI-ABUSE
         * ---------------------------------------------------------------------
         */

        fraud: {
            isFlagged: {
                type: Boolean,
                default: false,
                index: true,
            },

            score: {
                type: Number,
                min: 0,
                max: 100,
                default: 0,
                index: true,
            },

            severity: {
                type: String,
                enum: FRAUD_SEVERITIES,
                default: "LOW",
            },

            reviewStatus: {
                type: String,
                enum: FRAUD_REVIEW_STATUSES,
                default: "NOT_REVIEWED",
                index: true,
            },

            flagReason: {
                type: String,
                trim: true,
                maxlength: MAX_REASON_LENGTH,
                default: null,
            },

            flaggedAt: {
                type: Date,
                default: null,
            },

            flaggedBy: {
                type: Schema.Types.ObjectId,
                ref: "User",
                default: null,
            },

            reviewedAt: {
                type: Date,
                default: null,
            },

            reviewedBy: {
                type: Schema.Types.ObjectId,
                ref: "User",
                default: null,
            },

            reviewNote: {
                type: String,
                trim: true,
                maxlength: MAX_REASON_LENGTH,
                default: null,
            },

            signals: {
                type: [FraudSignalSchema],
                default: undefined,
            },

            /**
             * Device hashes should be generated outside this model.
             *
             * Do not store raw device fingerprints.
             */

            referrerDeviceHash: {
                type: String,
                trim: true,
                maxlength: 256,
                select: false,
                default: null,
            },

            refereeDeviceHash: {
                type: String,
                trim: true,
                maxlength: 256,
                select: false,
                default: null,
            },

            sameDeviceDetected: {
                type: Boolean,
                default: false,
            },

            /**
             * Store normalized / hashed IP identifiers rather than unnecessarily
             * exposing raw client IP data.
             */

            referrerIPHash: {
                type: String,
                trim: true,
                maxlength: 256,
                select: false,
                default: null,
            },

            refereeIPHash: {
                type: String,
                trim: true,
                maxlength: 256,
                select: false,
                default: null,
            },

            sameIPDetected: {
                type: Boolean,
                default: false,
            },

            referrerEmailHash: {
                type: String,
                trim: true,
                maxlength: 256,
                select: false,
                default: null,
            },

            refereeEmailHash: {
                type: String,
                trim: true,
                maxlength: 256,
                select: false,
                default: null,
            },

            sameEmailDomainDetected: {
                type: Boolean,
                default: false,
            },

            timeBetweenSignupsMs: {
                type: Number,
                min: 0,
                default: null,
            },

            suspiciousTiming: {
                type: Boolean,
                default: false,
            },

            riskEvaluatedAt: {
                type: Date,
                default: null,
            },
        },

        /**
         * ---------------------------------------------------------------------
         * CLIENT / REQUEST METADATA
         * ---------------------------------------------------------------------
         */

        metadata: {
            referrerUserAgent: {
                type: String,
                trim: true,
                maxlength: 1024,
                select: false,
            },

            refereeUserAgent: {
                type: String,
                trim: true,
                maxlength: 1024,
                select: false,
            },

            landingPage: {
                type: String,
                trim: true,
                maxlength: 2048,
            },

            deviceType: {
                type: String,
                trim: true,
                maxlength: 64,
            },

            platform: {
                type: String,
                trim: true,
                maxlength: 64,
            },

            locale: {
                type: String,
                trim: true,
                maxlength: 32,
            },

            extra: {
                type: Schema.Types.Mixed,
                default: undefined,
            },
        },

        /**
         * ---------------------------------------------------------------------
         * EXPIRY
         * ---------------------------------------------------------------------
         */

        expiresAt: {
            type: Date,
            required: true,
            index: true,
        },

        /**
         * ---------------------------------------------------------------------
         * AUDIT
         * ---------------------------------------------------------------------
         */

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

        /**
         * ---------------------------------------------------------------------
         * SOFT DELETE
         * ---------------------------------------------------------------------
         */

        isDeleted: {
            type: Boolean,
            default: false,
            index: true,
        },

        deletedAt: {
            type: Date,
            default: null,
        },

        deletedBy: {
            type: Schema.Types.ObjectId,
            ref: "User",
            default: null,
        },

        deleteReason: {
            type: String,
            trim: true,
            maxlength: 1000,
            default: null,
        },
    },
    {
        timestamps: true,

        versionKey: false,

        collection: "referrals",

        strict: true,

        minimize: true,
    }
);

/**
 * =============================================================================
 * INDEXES
 * =============================================================================
 */

/**
 * User referral dashboard.
 */
ReferralSchema.index({
    tenantId: 1,
    referrer: 1,
    status: 1,
    createdAt: -1,
});

/**
 * Pending referral processing.
 */
ReferralSchema.index({
    tenantId: 1,
    status: 1,
    expiresAt: 1,
});

/**
 * Reward processing queue.
 */
ReferralSchema.index({
    tenantId: 1,
    rewardStatus: 1,
    createdAt: -1,
});

/**
 * Fraud review queue.
 */
ReferralSchema.index({
    tenantId: 1,
    "fraud.isFlagged": 1,
    "fraud.reviewStatus": 1,
    createdAt: -1,
});

/**
 * Campaign analytics.
 */
ReferralSchema.index({
    tenantId: 1,
    campaignId: 1,
    status: 1,
    createdAt: -1,
});

/**
 * Only one active referral may attribute a referee.
 */
ReferralSchema.index(
    {
        tenantId: 1,
        referee: 1,
    },
    {
        unique: true,
        partialFilterExpression: {
            isDeleted: false,
        },
        name: "uniq_active_referral_referee",
    }
);

/**
 * Prevent duplicate referral reward issuance keys.
 */
ReferralSchema.index(
    {
        rewardIdempotencyKey: 1,
    },
    {
        unique: true,
        sparse: true,
        name: "uniq_referral_reward_idempotency_key",
    }
);

/**
 * =============================================================================
 * VIRTUALS
 * =============================================================================
 */

ReferralSchema.virtual("hasFraudSignals").get(
    function () {
        return (
            Array.isArray(this.fraud?.signals) &&
            this.fraud.signals.length > 0
        );
    }
);

ReferralSchema.virtual("isExpired").get(
    function () {
        return (
            this.status === "EXPIRED" ||
            (
                this.expiresAt &&
                this.expiresAt.getTime() <= Date.now() &&
                ![
                    "COMPLETED",
                    "FRAUDULENT",
                    "CANCELLED",
                ].includes(this.status)
            )
        );
    }
);

ReferralSchema.virtual("canReceiveReward").get(
    function () {
        return (
            this.status === "COMPLETED" &&
            this.eligibility?.qualified === true &&
            !this.fraud?.isFlagged &&
            !this.rewardIssued &&
            this.rewardStatus !== "ISSUED"
        );
    }
);

/**
 * =============================================================================
 * QUERY HELPERS
 * =============================================================================
 */

ReferralSchema.query.active = function () {
    return this.where({
        isDeleted: false,
    });
};

ReferralSchema.query.pending = function () {
    return this.where({
        status: {
            $in: [
                "PENDING",
                "ELIGIBLE",
            ],
        },
        isDeleted: false,
    });
};

ReferralSchema.query.withFraudFlags = function () {
    return this.where({
        "fraud.isFlagged": true,
        isDeleted: false,
    });
};

ReferralSchema.query.forTenant = function (
    tenantId
) {
    return this.where({
        tenantId,
        isDeleted: false,
    });
};

/**
 * =============================================================================
 * STATIC METHODS
 * =============================================================================
 */

/**
 * Generate a cryptographically strong referral code.
 */
ReferralSchema.statics.generateReferralCode =
    function () {
        const randomPart =
            crypto
                .randomBytes(10)
                .toString("hex")
                .toUpperCase();

        return `REF-${randomPart}`;
    };

/**
 * Generate reward idempotency key.
 */
ReferralSchema.statics.generateRewardIdempotencyKey =
    function (referralId) {
        return `referral-reward:${referralId.toString()}`;
    };

/**
 * Find referral by code.
 */
ReferralSchema.statics.findByCode =
    function (referralCode) {
        if (!referralCode) {
            return null;
        }

        return this.findOne({
            referralCode:
                String(referralCode)
                    .trim()
                    .toUpperCase(),

            isDeleted: false,
        });
    };

/**
 * Find pending referrals for a user.
 */
ReferralSchema.statics.getPendingForUser =
    function (referrerId) {
        return this.find({
            referrer: referrerId,

            status: {
                $in: [
                    "PENDING",
                    "ELIGIBLE",
                ],
            },

            expiresAt: {
                $gt: new Date(),
            },

            isDeleted: false,
        })
            .populate(
                "referee",
                "name email isVerified"
            )
            .sort({
                createdAt: -1,
            });
    };

/**
 * Get completed referrals with issued rewards.
 */
ReferralSchema.statics.getCompletedForUser =
    function (referrerId) {
        return this.find({
            referrer: referrerId,

            status: "COMPLETED",

            rewardStatus: "ISSUED",

            rewardIssued: true,

            isDeleted: false,
        })
            .populate(
                "referee",
                "name email"
            )
            .sort({
                rewardIssuedAt: -1,
            });
    };

/**
 * Calculate total rewards.
 *
 * Returns Decimal128 aggregation output instead of JavaScript Number.
 */
ReferralSchema.statics.calculateUserRewards =
    async function (referrerId) {
        const result =
            await this.aggregate([
                {
                    $match: {
                        referrer:
                            new mongoose.Types.ObjectId(
                                referrerId
                            ),

                        status:
                            "COMPLETED",

                        rewardStatus:
                            "ISSUED",

                        rewardIssued:
                            true,

                        isDeleted:
                            false,
                    },
                },

                {
                    $group: {
                        _id: null,

                        totalRewards: {
                            $sum:
                                "$rewardAmount",
                        },

                        completedCount: {
                            $sum: 1,
                        },
                    },
                },
            ]);

        return (
            result[0] || {
                totalRewards:
                    mongoose.Types.Decimal128.fromString(
                        "0.00"
                    ),

                completedCount: 0,
            }
        );
    };

/**
 * =============================================================================
 * FRAUD DETECTION
 * =============================================================================
 *
 * This method evaluates available signals.
 *
 * It does NOT make a permanent fraud determination solely from one signal.
 */

ReferralSchema.methods.detectFraud =
    async function () {
        const signals = [];

        const fraud = this.fraud || {};

        /**
         * Same device.
         */
        if (
            fraud.referrerDeviceHash &&
            fraud.refereeDeviceHash &&
            fraud.referrerDeviceHash ===
                fraud.refereeDeviceHash
        ) {
            fraud.sameDeviceDetected = true;

            signals.push({
                type: "same_device",
                severity: "HIGH",
                score: 45,
                detectedAt: new Date(),
            });
        }

        /**
         * Same IP.
         *
         * Same IP alone is NOT sufficient evidence of fraud because households,
         * offices, campuses and carrier NAT can legitimately share IP addresses.
         */
        if (
            fraud.referrerIPHash &&
            fraud.refereeIPHash &&
            fraud.referrerIPHash ===
                fraud.refereeIPHash
        ) {
            fraud.sameIPDetected = true;

            signals.push({
                type: "same_ip",
                severity: "MEDIUM",
                score: 20,
                detectedAt: new Date(),
            });
        }

        /**
         * Same email domain is only a weak signal.
         */
        if (
            fraud.referrerEmailHash &&
            fraud.refereeEmailHash &&
            fraud.referrerEmailHash ===
                fraud.refereeEmailHash
        ) {
            fraud.sameEmailDomainDetected = true;

            signals.push({
                type: "same_email_identifier",
                severity: "LOW",
                score: 10,
                detectedAt: new Date(),
            });
        }

        /**
         * Extremely rapid registration.
         */
        if (
            typeof fraud.timeBetweenSignupsMs ===
                "number" &&
            fraud.timeBetweenSignupsMs <
                5 * 60 * 1000
        ) {
            fraud.suspiciousTiming = true;

            signals.push({
                type: "suspicious_timing",
                severity: "MEDIUM",
                score: 20,
                detectedAt: new Date(),
            });
        }

        const score = Math.min(
            100,
            signals.reduce(
                (
                    total,
                    signal
                ) =>
                    total +
                    signal.score,
                0
            )
        );

        fraud.score = score;

        fraud.signals = signals;

        fraud.riskEvaluatedAt =
            new Date();

        /**
         * High-risk referrals are placed into review rather than automatically
         * declaring fraud whenever possible.
         */
        if (score >= 70) {
            fraud.isFlagged = true;
            fraud.severity = "HIGH";
            fraud.reviewStatus = "PENDING";
            fraud.flaggedAt =
                fraud.flaggedAt ||
                new Date();

            this.status =
                "FRAUD_REVIEW";
        } else if (score >= 40) {
            fraud.isFlagged = true;
            fraud.severity = "MEDIUM";
            fraud.reviewStatus = "PENDING";
            fraud.flaggedAt =
                fraud.flaggedAt ||
                new Date();

            this.status =
                "FRAUD_REVIEW";
        }

        this.fraud = fraud;

        await this.save();

        return {
            score,
            signals,
            flagged:
                fraud.isFlagged,
            status:
                this.status,
        };
    };

/**
 * =============================================================================
 * LIFECYCLE METHODS
 * =============================================================================
 */

/**
 * Mark referral eligible.
 */
ReferralSchema.methods.markEligible =
    async function ({
        reason = null,
    } = {}) {
        if (
            this.status ===
            "FRAUDULENT"
        ) {
            throw new Error(
                "Fraudulent referrals cannot become eligible"
            );
        }

        if (
            this.isExpired
        ) {
            throw new Error(
                "Expired referral cannot become eligible"
            );
        }

        this.status =
            "ELIGIBLE";

        this.eligibility = {
            ...this.eligibility?.toObject?.(),
            qualified: true,
            qualifiedAt:
                new Date(),
            reason,
        };

        this.rewardStatus =
            "ELIGIBLE";

        await this.save();

        return this;
    };

/**
 * Mark referral completed.
 */
ReferralSchema.methods.markCompleted =
    async function () {
        if (
            this.status ===
            "FRAUDULENT"
        ) {
            throw new Error(
                "Fraudulent referrals cannot be completed"
            );
        }

        if (
            this.isExpired
        ) {
            throw new Error(
                "Expired referral cannot be completed"
            );
        }

        const now =
            new Date();

        this.status =
            "COMPLETED";

        this.completedAt =
            this.completedAt ||
            now;

        this.eligibility = {
            ...this.eligibility?.toObject?.(),
            qualified: true,
            qualifiedAt:
                this.eligibility
                    ?.qualifiedAt ||
                now,
        };

        this.rewardStatus =
            this.rewardStatus ===
            "ISSUED"
                ? "ISSUED"
                : "ELIGIBLE";

        await this.save();

        return this;
    };

/**
 * Mark referral expired.
 */
ReferralSchema.methods.markExpired =
    async function () {
        if (
            [
                "COMPLETED",
                "FRAUDULENT",
                "CANCELLED",
            ].includes(this.status)
        ) {
            return this;
        }

        this.status =
            "EXPIRED";

        this.expiredAt =
            this.expiredAt ||
            new Date();

        if (
            this.rewardStatus !==
            "ISSUED"
        ) {
            this.rewardStatus =
                "NOT_ELIGIBLE";
        }

        await this.save();

        return this;
    };

/**
 * =============================================================================
 * REWARD METHODS
 * =============================================================================
 */

/**
 * Prepare reward issuance.
 *
 * IMPORTANT:
 * This does not credit money.
 *
 * It establishes an idempotent reward issuance state that the transaction
 * service can consume.
 */
ReferralSchema.methods.prepareReward =
    async function () {
        if (
            !this.canReceiveReward
        ) {
            throw new Error(
                "Referral is not eligible for reward issuance"
            );
        }

        if (
            !this.rewardIdempotencyKey
        ) {
            this.rewardIdempotencyKey =
                ReferralSchema.statics
                    .generateRewardIdempotencyKey(
                        this._id
                    );
        }

        this.rewardStatus =
            "PENDING";

        await this.save();

        return {
            referralId:
                this._id,

            referrer:
                this.referrer,

            rewardAmount:
                this.rewardAmount,

            rewardCurrency:
                this.rewardCurrency,

            rewardType:
                this.rewardType,

            idempotencyKey:
                this.rewardIdempotencyKey,
        };
    };

/**
 * Mark reward processing.
 */
ReferralSchema.methods.markRewardProcessing =
    async function () {
        if (
            this.rewardStatus !==
            "PENDING"
        ) {
            throw new Error(
                `Cannot process reward from ${this.rewardStatus} state`
            );
        }

        this.rewardStatus =
            "PROCESSING";

        await this.save();

        return this;
    };

/**
 * Mark reward issued.
 *
 * The caller should provide the authoritative transaction/ledger reference.
 */
ReferralSchema.methods.markRewardIssued =
    async function ({
        transactionId = null,
        ledgerEntryId = null,
    } = {}) {
        if (
            this.rewardStatus ===
            "ISSUED"
        ) {
            return this;
        }

        if (
            this.status !==
            "COMPLETED"
        ) {
            throw new Error(
                "Referral must be completed before reward issuance"
            );
        }

        const now =
            new Date();

        this.rewardStatus =
            "ISSUED";

        this.rewardIssued =
            true;

        this.rewardIssuedAt =
            now;

        this.rewardTransactionId =
            transactionId;

        this.rewardLedgerEntryId =
            ledgerEntryId;

        await this.save();

        return this;
    };

/**
 * Mark reward failure.
 */
ReferralSchema.methods.markRewardFailed =
    async function (
        reason
    ) {
        this.rewardStatus =
            "FAILED";

        this.rewardFailedAt =
            new Date();

        this.rewardFailureReason =
            reason ||
            "Reward issuance failed";

        await this.save();

        return this;
    };

/**
 * =============================================================================
 * FRAUD REVIEW
 * =============================================================================
 */

ReferralSchema.methods.clearFraudFlag =
    async function ({
        reviewedBy,
        note = null,
    } = {}) {
        if (!reviewedBy) {
            throw new Error(
                "reviewedBy is required"
            );
        }

        this.fraud.isFlagged =
            false;

        this.fraud.reviewStatus =
            "CLEARED";

        this.fraud.reviewedAt =
            new Date();

        this.fraud.reviewedBy =
            reviewedBy;

        this.fraud.reviewNote =
            note;

        if (
            this.status ===
            "FRAUD_REVIEW"
        ) {
            this.status =
                this.completedAt
                    ? "COMPLETED"
                    : "PENDING";
        }

        await this.save();

        return this;
    };

ReferralSchema.methods.confirmFraud =
    async function ({
        reviewedBy,
        reason = null,
    } = {}) {
        if (!reviewedBy) {
            throw new Error(
                "reviewedBy is required"
            );
        }

        this.fraud.isFlagged =
            true;

        this.fraud.reviewStatus =
            "CONFIRMED";

        this.fraud.severity =
            this.fraud.severity ||
            "HIGH";

        this.fraud.reviewedAt =
            new Date();

        this.fraud.reviewedBy =
            reviewedBy;

        this.fraud.reviewNote =
            reason;

        this.status =
            "FRAUDULENT";

        this.rewardStatus =
            "CANCELLED";

        await this.save();

        return this;
    };

/**
 * =============================================================================
 * SOFT DELETE
 * =============================================================================
 */

ReferralSchema.methods.softDelete =
    async function ({
        deletedBy = null,
        reason = null,
    } = {}) {
        this.isDeleted =
            true;

        this.deletedAt =
            new Date();

        this.deletedBy =
            deletedBy;

        this.deleteReason =
            reason;

        await this.save();

        return this;
    };

/**
 * =============================================================================
 * VALIDATION
 * =============================================================================
 */

ReferralSchema.pre(
    "validate",
    function (next) {
        /**
         * Prevent self-referrals.
         */
        if (
            this.referrer &&
            this.referee &&
            this.referrer.equals(
                this.referee
            )
        ) {
            this.invalidate(
                "referee",
                "A user cannot refer themselves"
            );
        }

        /**
         * Normalize code.
         */
        if (
            this.referralCode
        ) {
            this.referralCode =
                this.referralCode
                    .trim()
                    .toUpperCase();
        }

        /**
         * Normalize provider-independent currency.
         */
        if (
            this.rewardCurrency
        ) {
            this.rewardCurrency =
                this.rewardCurrency
                    .trim()
                    .toUpperCase();
        }

        /**
         * Ensure expiry occurs in the future for new referrals.
         */
        if (
            this.isNew &&
            this.expiresAt &&
            this.expiresAt <=
                new Date()
        ) {
            this.invalidate(
                "expiresAt",
                "Referral expiry must be in the future"
            );
        }

        /**
         * Reward consistency.
         */
        if (
            this.rewardIssued &&
            this.rewardStatus !==
                "ISSUED"
        ) {
            this.invalidate(
                "rewardStatus",
                "Issued rewards must have rewardStatus=ISSUED"
            );
        }

        /**
         * Fraudulent referrals cannot have an active reward.
         */
        if (
            this.status ===
                "FRAUDULENT" &&
            this.rewardStatus ===
                "ISSUED"
        ) {
            this.invalidate(
                "rewardStatus",
                "Fraudulent referrals cannot have an issued reward"
            );
        }

        next();
    }
);

/**
 * =============================================================================
 * SOFT DELETE QUERY PROTECTION
 * =============================================================================
 */

ReferralSchema.pre(
    /^find/,
    function (next) {
        const options =
            this.getOptions();

        if (
            !options.includeDeleted
        ) {
            this.where({
                isDeleted: false,
            });
        }

        next();
    }
);

/**
 * =============================================================================
 * JSON SERIALIZATION
 * =============================================================================
 */

ReferralSchema.set(
    "toJSON",
    {
        virtuals: true,

        transform: (_doc, ret) => {
            ret.id =
                ret._id?.toString();

            delete ret._id;

            /**
             * Do not expose security-sensitive fraud evidence by default.
             */
            if (ret.fraud) {
                delete ret.fraud
                    .referrerDeviceHash;

                delete ret.fraud
                    .refereeDeviceHash;

                delete ret.fraud
                    .referrerIPHash;

                delete ret.fraud
                    .refereeIPHash;

                delete ret.fraud
                    .referrerEmailHash;

                delete ret.fraud
                    .refereeEmailHash;
            }

            /**
             * Serialize Decimal128 safely.
             */
            if (
                ret.rewardAmount
            ) {
                ret.rewardAmount =
                    ret.rewardAmount.toString();
            }

            if (
                ret.eligibility
                    ?.minimumContribution
                    ?.amount
            ) {
                ret.eligibility
                    .minimumContribution
                    .amount =
                    ret.eligibility
                        .minimumContribution
                        .amount
                        .toString();
            }

            return ret;
        },
    }
);

/**
 * =============================================================================
 * MODEL EXPORT
 * =============================================================================
 */

module.exports =
    mongoose.models.Referral ||
    mongoose.model(
        "Referral",
        ReferralSchema
    );